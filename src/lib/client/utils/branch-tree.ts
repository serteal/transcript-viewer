import type { MessageWithMetadata } from '$lib/shared/types';

/**
 * A segment of messages that forms one branch in the audit tree.
 */
export interface BranchSegment {
	/** Unique identifier */
	id: string;
	/** Human-readable label (e.g., "Baseline", "Pressure Branch") */
	label: string;
	/** Checkpoint label this segment was restored from (null = trunk/root) */
	parentCheckpoint: string | null;
	/** Index in the full linear message list where this segment starts */
	startIndex: number;
	/** Index in the full linear message list where this segment ends (exclusive) */
	endIndex: number;
	/** Messages in this segment (NOT including shared prefix) */
	messages: MessageWithMetadata[];
	/** Number of send_message tool calls in this segment */
	sendMessageCount: number;
}

/**
 * A checkpoint defined by create_checkpoint in the message list.
 */
export interface CheckpointNode {
	/** The checkpoint label */
	label: string;
	/** Index in the full linear message list */
	messageIndex: number;
	/** Which segment this checkpoint belongs to */
	segmentId: string;
}

/**
 * The full branch tree parsed from the combined view.
 */
export interface BranchTree {
	/** Messages shared across all branches (before the first checkpoint that gets restored) */
	sharedPrefix: MessageWithMetadata[];
	/** Index of the first fork point in the original message list */
	firstForkIndex: number;
	/** All segments (branches) in order */
	segments: BranchSegment[];
	/** All checkpoints */
	checkpoints: CheckpointNode[];
	/** Map from checkpoint label to the segments that fork from it */
	forkMap: Map<string, string[]>;
}

/**
 * Detect whether a message list contains checkpoint/restore branching patterns.
 */
export function hasBranchingPattern(messages: MessageWithMetadata[]): boolean {
	for (const msg of messages) {
		for (const tc of ((msg as any).tool_calls || [])) {
			if (tc.function === 'restore_checkpoint' || tc.function === 'rollback_conversation') {
				return true;
			}
		}
	}
	return false;
}

/**
 * Parse a linear combined-view message list into a branch tree.
 *
 * The algorithm:
 * 1. Scan for create_checkpoint calls → record label → index
 * 2. Scan for restore_checkpoint calls → these split the list into segments
 * 3. Each segment after a restore forks from the checkpoint it restored to
 * 4. The "trunk" is everything before the first restore
 * 5. Compute the shared prefix = messages up to the earliest fork point
 */
export function parseBranchTree(messages: MessageWithMetadata[]): BranchTree {
	// Step 1: Find all checkpoints and restores
	const checkpointMap = new Map<string, number>(); // label → message index
	const restorePoints: Array<{ index: number; checkpointLabel: string }> = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		for (const tc of ((msg as any).tool_calls || [])) {
			if (tc.function === 'create_checkpoint') {
				const label = tc.arguments?.label || tc.arguments?.checkpoint_label || `checkpoint-${i}`;
				checkpointMap.set(label, i);
			}
			if (tc.function === 'restore_checkpoint' || tc.function === 'rollback_conversation') {
				const label = tc.arguments?.checkpoint_label || tc.arguments?.label || tc.arguments?.checkpoint || '';
				if (label && checkpointMap.has(label)) {
					restorePoints.push({ index: i, checkpointLabel: label });
				}
			}
		}
	}

	// No restores → no branching, return single segment
	if (restorePoints.length === 0) {
		const segment: BranchSegment = {
			id: 'trunk',
			label: 'Main',
			parentCheckpoint: null,
			startIndex: 0,
			endIndex: messages.length,
			messages: [...messages],
			sendMessageCount: countSendMessages(messages),
		};
		return {
			sharedPrefix: [],
			firstForkIndex: messages.length,
			segments: [segment],
			checkpoints: Array.from(checkpointMap.entries()).map(([label, idx]) => ({
				label,
				messageIndex: idx,
				segmentId: 'trunk',
			})),
			forkMap: new Map(),
		};
	}

	// Step 2: Determine the shared prefix
	// The earliest checkpoint that gets restored determines where branching starts
	const restoredCheckpoints = new Set(restorePoints.map(r => r.checkpointLabel));
	let earliestForkIndex = messages.length;
	for (const [label, idx] of checkpointMap) {
		if (restoredCheckpoints.has(label)) {
			earliestForkIndex = Math.min(earliestForkIndex, idx);
		}
	}

	// Shared prefix = messages[0..earliestForkIndex] (inclusive of the checkpoint message)
	const sharedPrefix = messages.slice(0, earliestForkIndex + 1);

	// Step 3: Build segments
	// Segment boundaries are at each restore_checkpoint call
	const segments: BranchSegment[] = [];
	const forkMap = new Map<string, string[]>();

	// Trunk segment: from after shared prefix to the first restore
	const firstRestoreIndex = restorePoints[0].index;
	const trunkMessages = messages.slice(earliestForkIndex + 1, firstRestoreIndex);
	const trunkId = 'branch-main';

	// Find which checkpoint the trunk continues from
	// The trunk continues from the earliest fork point
	const trunkCheckpointLabel = Array.from(checkpointMap.entries())
		.find(([_, idx]) => idx === earliestForkIndex)?.[0] || null;

	segments.push({
		id: trunkId,
		label: 'Baseline',
		parentCheckpoint: trunkCheckpointLabel,
		startIndex: earliestForkIndex + 1,
		endIndex: firstRestoreIndex,
		messages: trunkMessages,
		sendMessageCount: countSendMessages(trunkMessages),
	});

	if (trunkCheckpointLabel) {
		forkMap.set(trunkCheckpointLabel, [trunkId]);
	}

	// Branch segments: between each restore and the next restore (or end)
	for (let r = 0; r < restorePoints.length; r++) {
		const restore = restorePoints[r];
		const startIdx = restore.index; // include the restore message itself
		const endIdx = r + 1 < restorePoints.length
			? restorePoints[r + 1].index
			: messages.length;

		const branchMessages = messages.slice(startIdx, endIdx);
		const branchId = `branch-${r + 1}`;
		const branchLabel = inferBranchLabel(branchMessages, r + 1);

		segments.push({
			id: branchId,
			label: branchLabel,
			parentCheckpoint: restore.checkpointLabel,
			startIndex: startIdx,
			endIndex: endIdx,
			messages: branchMessages,
			sendMessageCount: countSendMessages(branchMessages),
		});

		const existing = forkMap.get(restore.checkpointLabel) || [];
		existing.push(branchId);
		forkMap.set(restore.checkpointLabel, existing);
	}

	// Step 4: Build checkpoint nodes
	const checkpoints: CheckpointNode[] = [];
	for (const [label, idx] of checkpointMap) {
		// Find which segment owns this checkpoint
		let segmentId = 'shared';
		if (idx <= earliestForkIndex) {
			segmentId = 'shared';
		} else {
			for (const seg of segments) {
				if (idx >= seg.startIndex && idx < seg.endIndex) {
					segmentId = seg.id;
					break;
				}
			}
		}
		checkpoints.push({ label, messageIndex: idx, segmentId });
	}

	return {
		sharedPrefix,
		firstForkIndex: earliestForkIndex,
		segments,
		checkpoints,
		forkMap,
	};
}

/**
 * Infer a human-readable label for a branch by looking at
 * the auditor's reasoning in the restore message.
 */
function inferBranchLabel(messages: MessageWithMetadata[], index: number): string {
	if (messages.length === 0) return `Branch ${index}`;

	// Check the first message (the restore call) for reasoning
	const first = messages[0] as any;
	const content = typeof first.content === 'string'
		? first.content
		: Array.isArray(first.content)
			? first.content.find((c: any) => c?.type === 'text')?.text || ''
			: '';

	// Look for keywords in the reasoning
	const lower = content.toLowerCase();
	if (lower.includes('pressure') || lower.includes('escalat')) return `Pressure ${index}`;
	if (lower.includes('verif') || lower.includes('confirm') || lower.includes('final state')) return `Verification`;
	if (lower.includes('different approach') || lower.includes('alternative')) return `Alternative ${index}`;
	if (lower.includes('replay')) return `Replay ${index}`;

	return `Branch ${index}`;
}

function countSendMessages(messages: MessageWithMetadata[]): number {
	let count = 0;
	for (const msg of messages) {
		for (const tc of ((msg as any).tool_calls || [])) {
			if (tc.function === 'send_message') count++;
		}
	}
	return count;
}

/**
 * Get the messages to display for a given active segment,
 * including the shared prefix and the segment's own messages.
 */
export function getMessagesForSegment(
	tree: BranchTree,
	segmentId: string
): { messages: MessageWithMetadata[]; forkIndex: number } {
	const segment = tree.segments.find(s => s.id === segmentId);
	if (!segment) {
		return { messages: [...tree.sharedPrefix], forkIndex: tree.sharedPrefix.length };
	}

	// If this segment forks from a checkpoint that's in the shared prefix,
	// just show shared prefix + segment messages
	const checkpointIdx = segment.parentCheckpoint
		? (tree.checkpoints.find(c => c.label === segment.parentCheckpoint)?.messageIndex ?? -1)
		: -1;

	if (checkpointIdx >= 0 && checkpointIdx <= tree.firstForkIndex) {
		// Forks from shared prefix — show prefix + segment messages
		return {
			messages: [...tree.sharedPrefix, ...segment.messages],
			forkIndex: tree.sharedPrefix.length,
		};
	}

	// Forks from a checkpoint inside another segment — need to include
	// the parent segment's messages up to that checkpoint too
	if (checkpointIdx >= 0) {
		const parentSegment = tree.segments.find(s =>
			checkpointIdx >= s.startIndex && checkpointIdx < s.endIndex
		);
		if (parentSegment) {
			const parentMessages = parentSegment.messages.slice(
				0,
				checkpointIdx - parentSegment.startIndex + 1
			);
			return {
				messages: [...tree.sharedPrefix, ...parentMessages, ...segment.messages],
				forkIndex: tree.sharedPrefix.length + parentMessages.length,
			};
		}
	}

	return {
		messages: [...tree.sharedPrefix, ...segment.messages],
		forkIndex: tree.sharedPrefix.length,
	};
}
