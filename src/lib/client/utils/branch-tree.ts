import type { MessageWithMetadata } from '$lib/shared/types';

/**
 * A checkpoint node in the branch tree.
 * Each checkpoint can have multiple branches (the baseline continuation + restores).
 */
export interface CheckpointNode {
	/** Checkpoint label */
	label: string;
	/** Index in the full message list where create_checkpoint was called */
	messageIndex: number;
	/** Parent checkpoint label (null if top-level, i.e. in shared prefix) */
	parentCheckpointLabel: string | null;
}

/**
 * A branch (leaf) under a checkpoint.
 * Represents a contiguous run of messages from a checkpoint fork point.
 */
export interface BranchLeaf {
	/** Unique identifier */
	id: string;
	/** Human-readable label */
	label: string;
	/** Whether this is the baseline (original continuation) or a restore branch */
	isBaseline: boolean;
	/** The checkpoint this branches from */
	checkpoint: CheckpointNode;
	/** Start index in the full message list (inclusive) */
	startIndex: number;
	/** End index in the full message list (exclusive) */
	endIndex: number;
	/** Messages in this branch */
	messages: MessageWithMetadata[];
	/** Number of send_message tool calls */
	sendMessageCount: number;
}

/**
 * The full branch tree.
 */
export interface BranchTree {
	/** Messages before the first checkpoint (setup/environment exploration) */
	sharedPrefix: MessageWithMetadata[];
	/** Ordered list of checkpoints */
	checkpoints: CheckpointNode[];
	/** All branches grouped by checkpoint label */
	branchesByCheckpoint: Map<string, BranchLeaf[]>;
	/** Flat list of all branch leaves for easy iteration */
	allBranches: BranchLeaf[];
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
 * Model:
 * - Each checkpoint is a parent node
 * - Under each checkpoint: the baseline continuation + any restore branches
 * - The baseline from checkpoint C runs from C+1 until the first restore
 *   that targets C (or the end of the list / next restore to any checkpoint)
 * - Each restore_checkpoint(C) creates a new branch leaf from C
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

	// No restores → no branching
	if (restorePoints.length === 0) {
		const checkpoints = Array.from(checkpointMap.entries())
			.sort((a, b) => a[1] - b[1])
			.map(([label, idx]) => ({ label, messageIndex: idx, parentCheckpointLabel: null }));

		return {
			sharedPrefix: [...messages],
			checkpoints,
			branchesByCheckpoint: new Map(),
			allBranches: [],
		};
	}

	// Step 2: Build restore boundaries — sorted by index
	const sortedRestores = [...restorePoints].sort((a, b) => a.index - b.index);

	// Step 3: Determine shared prefix (before the first checkpoint that gets restored)
	const restoredLabels = new Set(restorePoints.map(r => r.checkpointLabel));
	let firstRestoredCpIndex = messages.length;
	for (const [label, idx] of checkpointMap) {
		if (restoredLabels.has(label)) {
			firstRestoredCpIndex = Math.min(firstRestoredCpIndex, idx);
		}
	}
	const sharedPrefix = messages.slice(0, firstRestoredCpIndex + 1);

	// Step 4: Build checkpoint nodes (only those that get restored) with parent info
	// A checkpoint's parent is the preceding checkpoint whose baseline contains it.
	// Since checkpoints are ordered by index, cp[i]'s parent is the latest cp[j<i]
	// whose baseline range covers cp[i].messageIndex.
	const restoredCheckpointsSorted = Array.from(checkpointMap.entries())
		.filter(([label]) => restoredLabels.has(label))
		.sort((a, b) => a[1] - b[1]);

	const checkpoints: CheckpointNode[] = [];
	for (let ci = 0; ci < restoredCheckpointsSorted.length; ci++) {
		const [label, idx] = restoredCheckpointsSorted[ci];
		// Parent is the previous checkpoint if this one is inside its baseline range
		let parentLabel: string | null = null;
		for (let pi = ci - 1; pi >= 0; pi--) {
			const [pLabel, pIdx] = restoredCheckpointsSorted[pi];
			// cp[pi]'s baseline runs from pIdx+1 until first restore after pIdx
			let pBaselineEnd = messages.length;
			for (const ri of sortedRestores) {
				if (ri.index > pIdx) {
					pBaselineEnd = ri.index;
					break;
				}
			}
			if (idx > pIdx && idx < pBaselineEnd) {
				parentLabel = pLabel;
				break;
			}
		}
		checkpoints.push({ label, messageIndex: idx, parentCheckpointLabel: parentLabel });
	}

	// Step 5: For each checkpoint, find its branches
	const branchesByCheckpoint = new Map<string, BranchLeaf[]>();
	const allBranches: BranchLeaf[] = [];

	// All restore indices as boundaries
	const restoreIndices = sortedRestores.map(r => r.index);

	for (const cp of checkpoints) {
		const branches: BranchLeaf[] = [];

		// Baseline branch: from cp+1 until the first restore (to ANY checkpoint) after cp
		const baselineStart = cp.messageIndex + 1;
		let baselineEnd = messages.length;
		for (const ri of restoreIndices) {
			if (ri > cp.messageIndex) {
				baselineEnd = ri;
				break;
			}
		}

		if (baselineStart < baselineEnd) {
			const baselineMsgs = messages.slice(baselineStart, baselineEnd);
			const baselineLeaf: BranchLeaf = {
				id: `${cp.label}:baseline`,
				label: 'Baseline',
				isBaseline: true,
				checkpoint: cp,
				startIndex: baselineStart,
				endIndex: baselineEnd,
				messages: baselineMsgs,
				sendMessageCount: countSendMessages(baselineMsgs),
			};
			branches.push(baselineLeaf);
			allBranches.push(baselineLeaf);
		}

		// Restore branches: each restore_checkpoint targeting this checkpoint
		const cpRestores = sortedRestores.filter(r => r.checkpointLabel === cp.label);
		for (let ri = 0; ri < cpRestores.length; ri++) {
			const restore = cpRestores[ri];
			const branchStart = restore.index;
			// End at the next restore (to ANY checkpoint) or end of messages
			let branchEnd = messages.length;
			const globalRestoreIdx = restoreIndices.indexOf(restore.index);
			if (globalRestoreIdx >= 0 && globalRestoreIdx + 1 < restoreIndices.length) {
				branchEnd = restoreIndices[globalRestoreIdx + 1];
			}

			const branchMsgs = messages.slice(branchStart, branchEnd);
			const branchLabel = inferBranchLabel(branchMsgs, ri + 1);
			const branchLeaf: BranchLeaf = {
				id: `${cp.label}:branch-${ri + 1}`,
				label: branchLabel,
				isBaseline: false,
				checkpoint: cp,
				startIndex: branchStart,
				endIndex: branchEnd,
				messages: branchMsgs,
				sendMessageCount: countSendMessages(branchMsgs),
			};
			branches.push(branchLeaf);
			allBranches.push(branchLeaf);
		}

		branchesByCheckpoint.set(cp.label, branches);
	}

	return {
		sharedPrefix,
		checkpoints,
		branchesByCheckpoint,
		allBranches,
	};
}

/**
 * Get the messages to display for a given active branch leaf.
 * Returns: shared prefix + baseline chain up to the fork + branch messages.
 */
export function getMessagesForBranch(
	tree: BranchTree,
	branchId: string
): { messages: MessageWithMetadata[]; forkIndex: number } {
	const branch = tree.allBranches.find(b => b.id === branchId);
	if (!branch) {
		return { messages: [...tree.sharedPrefix], forkIndex: tree.sharedPrefix.length };
	}

	if (branch.isBaseline) {
		// For a baseline branch, show shared prefix + this branch's messages
		// But also include any parent baseline messages if this checkpoint is nested
		const parentMessages = getBaselineChainTo(tree, branch.checkpoint);
		return {
			messages: [...tree.sharedPrefix, ...parentMessages, ...branch.messages],
			forkIndex: tree.sharedPrefix.length + parentMessages.length,
		};
	} else {
		// For a restore branch, show shared prefix + baseline chain up to checkpoint + branch
		const parentMessages = getBaselineChainTo(tree, branch.checkpoint);
		return {
			messages: [...tree.sharedPrefix, ...parentMessages, ...branch.messages],
			forkIndex: tree.sharedPrefix.length + parentMessages.length,
		};
	}
}

/**
 * Get the baseline messages from the first checkpoint up to (but not including)
 * the given checkpoint. This handles the nested checkpoint case:
 * if cp2 is inside cp1's baseline, we need cp1's baseline messages up to cp2.
 */
function getBaselineChainTo(tree: BranchTree, targetCp: CheckpointNode): MessageWithMetadata[] {
	const result: MessageWithMetadata[] = [];

	// Walk through checkpoints in order, collecting baseline messages
	// that fall between the shared prefix and the target checkpoint
	for (const cp of tree.checkpoints) {
		if (cp.messageIndex >= targetCp.messageIndex) break;

		const branches = tree.branchesByCheckpoint.get(cp.label);
		const baseline = branches?.find(b => b.isBaseline);
		if (baseline) {
			// Include baseline messages up to target checkpoint (or end of baseline)
			const endAt = Math.min(baseline.endIndex, targetCp.messageIndex + 1);
			const slice = baseline.messages.slice(0, endAt - baseline.startIndex);
			result.push(...slice);
		}
	}

	return result;
}

/**
 * Infer a human-readable label for a branch.
 */
function inferBranchLabel(messages: MessageWithMetadata[], index: number): string {
	if (messages.length === 0) return `Branch ${index}`;

	const first = messages[0] as any;
	const content = typeof first.content === 'string'
		? first.content
		: Array.isArray(first.content)
			? first.content.find((c: any) => c?.type === 'text')?.text || ''
			: '';

	const lower = content.toLowerCase();
	if (lower.includes('pressure') || lower.includes('escalat')) return `Pressure ${index}`;
	if (lower.includes('verif') || lower.includes('confirm') || lower.includes('final state')) return 'Verification';
	if (lower.includes('different approach') || lower.includes('alternative')) return `Alternative ${index}`;
	if (lower.includes('replay')) return `Replay ${index}`;

	return `Branch ${index}`;
}

/**
 * Map a tree branch ID to a snapshot column index.
 * Used for target view where branches are separate columns, not checkpoint/restore.
 *
 * Baseline branches → column 0 (the "main" snapshot)
 * Nth non-baseline branch (sorted by startIndex) → column N
 */
export function mapBranchToColumnIndex(tree: BranchTree, branchId: string): number {
	const branch = tree.allBranches.find(b => b.id === branchId);
	if (!branch || branch.isBaseline) return 0;

	// Get all non-baseline branches sorted by start index
	const restoreBranches = tree.allBranches
		.filter(b => !b.isBaseline)
		.sort((a, b) => a.startIndex - b.startIndex);

	const restoreIndex = restoreBranches.findIndex(b => b.id === branchId);
	return restoreIndex >= 0 ? restoreIndex + 1 : 0;
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
