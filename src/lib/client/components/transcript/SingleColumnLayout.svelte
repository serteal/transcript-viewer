<script lang="ts">
	import type { ConversationColumn, Event, UserComment, UserHighlight, BranchPoint, Branch, MessageWithMetadata } from '$lib/shared/types';
	import MessageCard from '$lib/client/components/transcript/MessageCard.svelte';
	import BranchPointComponent from '$lib/client/components/transcript/BranchPoint.svelte';
	import { onMount, createEventDispatcher, tick } from 'svelte';
	import { handleCopyAction, type CopyAction } from '$lib/client/utils/copy-utils';
	import { findCommonPrefixLength } from '$lib/client/utils/branching';
	import { buildToolResultMap, getConsumedToolMessageIds, isConsumedMessage } from '$lib/client/utils/tool-pairing';
	import { hasBranchingPattern, parseBranchTree, getMessagesForBranch, type BranchTree } from '$lib/client/utils/branch-tree';

	let {
		columns,
		transcriptEvents,
		showShared = true,
		renderMarkdown = true,
		fullWidth = true,
		filePath,
		transcriptId,
		comments = [],
		highlights = [],
		onAddComment,
		onDeleteComment,
		onAddHighlight,
		onOpenCommentModal,
		messageFilter,
		isCompact = false,
		toolTypeFilter,
		auditorModel,
		targetModel,
	}: {
		columns: ConversationColumn[];
		transcriptEvents?: Event[];
		showShared?: boolean;
		renderMarkdown?: boolean;
		fullWidth?: boolean;
		filePath?: string;
		transcriptId?: string;
		comments?: UserComment[];
		highlights?: UserHighlight[];
		onAddComment?: (messageId: string, text: string, quotedText?: string) => Promise<void>;
		onDeleteComment?: (commentId: string) => Promise<void>;
		onAddHighlight?: (messageId: string, quotedText: string) => void;
		onOpenCommentModal?: (messageId: string, quotedText: string) => void;
		messageFilter?: (msg: any, index: number) => boolean;
		isCompact?: boolean;
		toolTypeFilter?: Set<string>;
		auditorModel?: string;
		targetModel?: string;
	} = $props();

	// Dispatch "ready" when content is rendered
	const dispatch = createEventDispatcher<{ ready: void }>();

	onMount(async () => {
		await tick();
		requestAnimationFrame(() => dispatch('ready'));
	});

	$effect(() => {
		columns;
		queueMicrotask(async () => {
			await tick();
			requestAnimationFrame(() => dispatch('ready'));
		});
	});

	// =========================================================================
	// Branch Tree detection (checkpoint/restore pattern in combined view)
	// =========================================================================

	// Check if the first column has checkpoint/restore branching
	const branchTree = $derived.by((): BranchTree | null => {
		if (columns.length === 0) return null;
		// Use the first (or only) column's messages
		const msgs = columns[0].messages;
		if (!hasBranchingPattern(msgs)) return null;
		return parseBranchTree(msgs);
	});

	const useBranchTree = $derived(branchTree !== null && branchTree.segments.length > 1);

	// Active branch for branch tree mode
	let activeTreeBranchId = $state<string>('');

	// Initialize to first baseline branch when tree changes
	$effect(() => {
		if (branchTree && branchTree.allBranches.length > 0) {
			if (!branchTree.allBranches.find(b => b.id === activeTreeBranchId)) {
				// Default to the first baseline branch
				const firstBaseline = branchTree.allBranches.find(b => b.isBaseline);
				activeTreeBranchId = firstBaseline?.id || branchTree.allBranches[0].id;
			}
		}
	});

	// Messages for the active branch tree leaf
	const treeMessages = $derived.by(() => {
		if (!branchTree) return [];
		const { messages } = getMessagesForBranch(branchTree, activeTreeBranchId);
		return messages;
	});

	const treeForkIndex = $derived.by(() => {
		if (!branchTree) return 0;
		const { forkIndex } = getMessagesForBranch(branchTree, activeTreeBranchId);
		return forkIndex;
	});

	// =========================================================================
	// Snapshot-based branching (existing approach for target view)
	// =========================================================================

	let activeBranches = $state<Record<string, string>>({});

	const branchData = $derived.by(() => {
		if (useBranchTree) {
			// When using branch tree, no snapshot-based branching
			return { sharedMessages: [] as MessageWithMetadata[], branchPoints: [] as BranchPoint[] };
		}

		if (columns.length === 0) {
			return { sharedMessages: [], branchPoints: [] };
		}

		if (columns.length === 1) {
			return {
				sharedMessages: columns[0].messages,
				branchPoints: []
			};
		}

		let sharedCount = columns[0].messages.length;
		for (let i = 1; i < columns.length; i++) {
			const prefixLen = findCommonPrefixLength(
				columns[0].messages as any[],
				columns[i].messages as any[]
			);
			sharedCount = Math.min(sharedCount, prefixLen);
		}

		const sharedMessages = columns[0].messages.slice(0, sharedCount);

		const branches: Branch[] = columns.map((col, i) => {
			const label = String.fromCharCode(65 + i);
			const branchMessages = col.messages.slice(sharedCount);
			return {
				id: `branch-0-${label.toLowerCase()}`,
				label,
				name: col.title || `Branch ${label}`,
				description: '',
				messageCount: branchMessages.length,
				messages: branchMessages
			};
		});

		const branchPoint: BranchPoint = {
			id: 'branch-0',
			type: 'branch_point',
			afterMessageIndex: sharedCount,
			sharedMessages,
			branches
		};

		return {
			sharedMessages,
			branchPoints: [branchPoint]
		};
	});

	// =========================================================================
	// Tool result pairing (works for both modes)
	// =========================================================================

	const allVisibleMessages = $derived.by(() => {
		if (useBranchTree) return treeMessages;

		const msgs: MessageWithMetadata[] = [];
		msgs.push(...branchData.sharedMessages);
		for (const bp of branchData.branchPoints) {
			const activeBranchId = activeBranches[bp.id] || bp.branches[0]?.id;
			const activeBranch = bp.branches.find(b => b.id === activeBranchId);
			if (activeBranch) {
				msgs.push(...activeBranch.messages);
			}
		}
		return msgs;
	});

	const toolResultMap = $derived(buildToolResultMap(allVisibleMessages));
	const consumedToolIds = $derived(getConsumedToolMessageIds(allVisibleMessages));

	// =========================================================================
	// Snapshot branch management
	// =========================================================================

	$effect(() => {
		if (useBranchTree) return; // skip when using tree mode
		const newActiveBranches: Record<string, string> = {};
		for (const bp of branchData.branchPoints) {
			if (!activeBranches[bp.id] && bp.branches.length > 0) {
				const defaultBranch = bp.branches.reduce((best, current) =>
					current.messages.length > best.messages.length ? current : best
				);
				newActiveBranches[bp.id] = defaultBranch.id;
			} else if (activeBranches[bp.id]) {
				newActiveBranches[bp.id] = activeBranches[bp.id];
			}
		}
		if (JSON.stringify(newActiveBranches) !== JSON.stringify(activeBranches)) {
			activeBranches = newActiveBranches;
		}
	});

	function handleBranchChange(branchPointId: string, branchId: string) {
		activeBranches = { ...activeBranches, [branchPointId]: branchId };
	}

	// =========================================================================
	// Filtering helpers
	// =========================================================================

	function shouldShowMessage(msg: MessageWithMetadata, index: number): boolean {
		if (isConsumedMessage(msg, consumedToolIds, index)) return false;
		return true;
	}

	function matchesToolTypeFilter(msg: MessageWithMetadata): boolean {
		if (!toolTypeFilter || toolTypeFilter.size === 0) return true;
		if (msg.role === 'assistant' && (msg as any).tool_calls?.length > 0) {
			return (msg as any).tool_calls.some((tc: any) => toolTypeFilter!.has(tc.function));
		}
		if (msg.role === 'tool' && (msg as any).function) {
			return toolTypeFilter.has((msg as any).function);
		}
		return true;
	}

	// =========================================================================
	// Visible messages (unified for both modes)
	// =========================================================================

	const visibleMessages = $derived.by(() => {
		if (useBranchTree) {
			// Tree mode: flat list from shared prefix + active segment
			return treeMessages.map((msg, i) => ({
				type: 'message' as const,
				message: msg,
				index: i,
				isForkPoint: i === treeForkIndex && treeForkIndex > 0,
			}));
		}

		// Snapshot mode (existing)
		const result: Array<{ type: 'message'; message: MessageWithMetadata; index: number; isForkPoint?: boolean } | { type: 'branch_point'; branchPoint: BranchPoint }> = [];

		branchData.sharedMessages.forEach((msg, i) => {
			result.push({ type: 'message', message: msg, index: i });
		});

		for (const bp of branchData.branchPoints) {
			result.push({ type: 'branch_point', branchPoint: bp });

			const activeBranchId = activeBranches[bp.id] || bp.branches[0]?.id;
			const activeBranch = bp.branches.find(b => b.id === activeBranchId);

			if (activeBranch) {
				activeBranch.messages.forEach((msg, i) => {
					result.push({
						type: 'message',
						message: msg,
						index: branchData.sharedMessages.length + i
					});
				});
			}
		}

		return result;
	});

	// =========================================================================
	// Message helpers
	// =========================================================================

	function getCommentsForMessage(msg: any, msgIdx: number): UserComment[] {
		const byId = msg.id ? comments.filter(c => c.message_id === msg.id) : [];
		const indexId = `col0:msg${msgIdx}`;
		const byIndex = comments.filter(c => c.message_id === indexId);
		return [...byId, ...byIndex];
	}

	function getHighlightsForMessage(msg: any, msgIdx: number): UserHighlight[] {
		const byId = msg.id ? highlights.filter(h => h.message_id === msg.id) : [];
		const indexId = `col0:msg${msgIdx}`;
		const byIndex = highlights.filter(h => h.message_id === indexId);
		return [...byId, ...byIndex];
	}

	function getActorLabel(msg: MessageWithMetadata): string | undefined {
		if (msg.role !== 'assistant') return undefined;
		const model = (msg as any).model;
		if (!model) return undefined;
		if (auditorModel && model === auditorModel) return 'AUDITOR';
		if (targetModel && model === targetModel) return 'TARGET';
		return undefined;
	}

	let openByKey: Record<string, boolean> = $state({});

	function getMessageKey(msg: any): string {
		if (msg && typeof msg.id === 'string' && msg.id) return msg.id;
		const role = msg?.role || '';
		let text = '';
		if (typeof msg?.content === 'string') text = msg.content;
		else if (Array.isArray(msg?.content)) {
			const t = msg.content.find((c: any) => c?.type === 'text');
			text = t?.text || '';
		}
		return role + ':' + text.substring(0, 64);
	}

	function isOpenFor(msg: any): boolean {
		const key = getMessageKey(msg);
		return openByKey[key] !== false;
	}

	function toggleOpenFor(msg: any) {
		const key = getMessageKey(msg);
		openByKey[key] = openByKey[key] === false ? true : false;
	}

	async function handleCopy(action: CopyAction) {
		const result = await handleCopyAction(action, columns, transcriptEvents);
		console.log(result.message);
		if (result.isError) {
			console.error('Copy failed:', result.message);
		}
	}

	// =========================================================================
	// Exported API
	// =========================================================================

	export function getBranchData() {
		return branchData;
	}

	export function getActiveBranches() {
		return activeBranches;
	}

	export function switchToBranch(branchPointId: string, branchId: string) {
		handleBranchChange(branchPointId, branchId);
	}

	/** Get the branch tree (if checkpoint/restore pattern detected) */
	export function getBranchTree(): BranchTree | null {
		return branchTree;
	}

	/** Get the active branch ID for branch tree mode */
	export function getActiveTreeBranchId(): string {
		return activeTreeBranchId;
	}

	/** Switch to a specific branch in the branch tree */
	export function switchToTreeBranch(branchId: string) {
		activeTreeBranchId = branchId;
	}

	export async function switchToBranchContainingMessage(messageId: string): Promise<boolean> {
		if (useBranchTree && branchTree) {
			// Check shared prefix
			if (branchTree.sharedPrefix.some(m => (m as any).id === messageId)) {
				await tick();
				return true;
			}
			// Check each branch leaf
			for (const branch of branchTree.allBranches) {
				if (branch.messages.some(m => (m as any).id === messageId)) {
					activeTreeBranchId = branch.id;
					await tick();
					return true;
				}
			}
			return false;
		}

		// Snapshot mode
		const inShared = branchData.sharedMessages.some(m => (m as any).id === messageId);
		if (inShared) {
			await tick();
			return true;
		}

		for (const bp of branchData.branchPoints) {
			for (const branch of bp.branches) {
				const found = branch.messages.some(m => (m as any).id === messageId);
				if (found) {
					activeBranches = { ...activeBranches, [bp.id]: branch.id };
					await tick();
					return true;
				}
			}
		}

		return false;
	}
</script>

<div class="single-column-layout" class:constrained={!fullWidth} class:full-width={fullWidth}>
	<div class="messages-container">
		{#each visibleMessages as item, i (item.type === 'message' ? `msg-${item.index}-${getMessageKey(item.message)}` : `bp-${'branchPoint' in item ? item.branchPoint.id : ''}`)}
			{#if item.type === 'branch_point' && 'branchPoint' in item}
				<BranchPointComponent
					branchPoint={item.branchPoint}
					activeBranchId={activeBranches[item.branchPoint.id] || item.branchPoint.branches[0]?.id || ''}
					onBranchChange={handleBranchChange}
				/>
			{:else if item.type === 'message'}
				{#if 'isForkPoint' in item && item.isForkPoint}
					<!-- Fork point indicator for branch tree mode -->
					<div class="fork-point-indicator">
						<div class="fork-line"></div>
						<div class="fork-badge">
							<span class="fork-icon">&#9670;</span>
							<span class="fork-label">
								{branchTree?.allBranches.find(b => b.id === activeTreeBranchId)?.checkpoint.label.replace(/-/g, ' ') || 'Branch point'}
							</span>
							<span class="fork-viewing">
								viewing: <strong>{branchTree?.allBranches.find(b => b.id === activeTreeBranchId)?.label || activeTreeBranchId}</strong>
							</span>
						</div>
						<div class="fork-line"></div>
					</div>
				{/if}
				{#if shouldShowMessage(item.message, item.index) && matchesToolTypeFilter(item.message) && (!messageFilter || messageFilter(item.message, item.index))}
					<MessageCard
						msg={item.message}
						isVisible={showShared || !item.message.isShared}
						isOpen={isOpenFor(item.message)}
						onToggle={() => toggleOpenFor(item.message)}
						messageIndex={item.index}
						columnIndex={0}
						{renderMarkdown}
						{filePath}
						{transcriptId}
						onCopy={(action) => handleCopy(action)}
						comments={getCommentsForMessage(item.message, item.index)}
						highlights={getHighlightsForMessage(item.message, item.index)}
						{onAddComment}
						{onDeleteComment}
						{onAddHighlight}
						{onOpenCommentModal}
						{toolResultMap}
						{isCompact}
						actorLabel={getActorLabel(item.message)}
					/>
				{/if}
			{/if}
		{/each}
	</div>
</div>

<style>
	.single-column-layout {
		width: 100%;
		padding: 0 16px;
	}

	.single-column-layout.constrained {
		max-width: 900px;
		margin: 0 auto;
	}

	.single-column-layout.full-width {
		padding: 0;
	}

	.messages-container {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* Fork point indicator (branch tree mode) */
	.fork-point-indicator {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0;
		margin: 0.25rem 0;
	}

	.fork-line {
		flex: 1;
		height: 2px;
		background: linear-gradient(90deg, transparent, #8b5cf6, transparent);
	}

	.fork-badge {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.75rem;
		background: linear-gradient(135deg, #faf5ff 0%, #eef2ff 100%);
		border: 1px solid #c4b5fd;
		border-radius: 999px;
		white-space: nowrap;
	}

	:global(.dark) .fork-badge {
		background: linear-gradient(135deg, #2e1065 0%, #1e1b4b 100%);
		border-color: #6d28d9;
	}

	.fork-icon {
		color: #8b5cf6;
		font-size: 0.7rem;
	}

	.fork-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #7c3aed;
		text-transform: capitalize;
	}

	.fork-viewing {
		font-size: 0.7rem;
		color: #a78bfa;
	}

	.fork-viewing strong {
		color: #7c3aed;
	}
</style>
