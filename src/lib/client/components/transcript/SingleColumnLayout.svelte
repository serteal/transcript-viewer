<script lang="ts">
	import type { ConversationColumn, Event, UserComment, UserHighlight, BranchPoint, Branch, MessageWithMetadata } from '$lib/shared/types';
	import MessageCard from '$lib/client/components/transcript/MessageCard.svelte';
	import { onMount, createEventDispatcher, tick } from 'svelte';
	import { handleCopyAction, type CopyAction } from '$lib/client/utils/copy-utils';
	import { findCommonPrefixLength } from '$lib/client/utils/branching';
	import { buildToolResultMap, getConsumedToolMessageIds, isConsumedMessage } from '$lib/client/utils/tool-pairing';
	import { hasBranchingPattern, parseBranchTree, getMessagesForBranch, mapBranchToColumnIndex, type BranchTree } from '$lib/client/utils/branch-tree';

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
		// Branch tree props (managed at page level)
		globalBranchTree = null,
		activeTreeBranchId = '',
		onTreeBranchChange,
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
		globalBranchTree?: BranchTree | null;
		activeTreeBranchId?: string;
		onTreeBranchChange?: (branchId: string) => void;
	} = $props();

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
	// Is branching active? (globalBranchTree provided with >1 branches)
	// =========================================================================

	const hasBranching = $derived(
		globalBranchTree !== null && globalBranchTree.allBranches.length > 1
	);

	// =========================================================================
	// View-local branch tree (for message resolution)
	// Combined/Auditor views have checkpoint/restore → own tree
	// Target view has multiple columns → map via column index
	// =========================================================================

	const localBranchTree = $derived.by((): BranchTree | null => {
		if (!hasBranching) return null;
		if (columns.length === 0) return null;
		const msgs = columns[0].messages;
		if (hasBranchingPattern(msgs)) {
			return parseBranchTree(msgs);
		}
		return null;
	});

	// Does this view have multiple columns (target view snapshot branching)?
	const hasMultipleColumns = $derived(columns.length > 1);

	// =========================================================================
	// Message resolution: get messages for the active branch
	// =========================================================================

	const resolvedMessages = $derived.by((): { messages: MessageWithMetadata[]; forkIndex: number } => {
		if (!hasBranching || !activeTreeBranchId) {
			// No branching — show all messages from first column
			return {
				messages: columns.length > 0 ? columns[0].messages : [],
				forkIndex: 0,
			};
		}

		// Case 1: View has its own checkpoint/restore tree (combined/auditor)
		if (localBranchTree && localBranchTree.allBranches.length > 1) {
			// Find matching branch by ID (IDs use checkpoint labels, same across views)
			const localBranch = localBranchTree.allBranches.find(b => b.id === activeTreeBranchId);
			if (localBranch) {
				return getMessagesForBranch(localBranchTree, activeTreeBranchId);
			}
			// Fallback: if ID doesn't match (shouldn't happen), show first branch
			return getMessagesForBranch(localBranchTree, localBranchTree.allBranches[0].id);
		}

		// Case 2: View has multiple columns but no checkpoint/restore (target)
		if (hasMultipleColumns && globalBranchTree) {
			const colIndex = mapBranchToColumnIndex(globalBranchTree, activeTreeBranchId);
			const safeIndex = Math.min(colIndex, columns.length - 1);
			return {
				messages: columns[safeIndex].messages,
				forkIndex: 0,
			};
		}

		// Case 3: Single column, no local tree — show all messages
		return {
			messages: columns.length > 0 ? columns[0].messages : [],
			forkIndex: 0,
		};
	});

	// Fork switcher data — always from globalBranchTree for consistency
	const forkSiblings = $derived.by(() => {
		if (!globalBranchTree || !activeTreeBranchId) return [];
		const activeBranch = globalBranchTree.allBranches.find(b => b.id === activeTreeBranchId);
		if (!activeBranch) return [];
		return globalBranchTree.branchesByCheckpoint.get(activeBranch.checkpoint.label) || [];
	});

	const forkCheckpointLabel = $derived.by(() => {
		if (!globalBranchTree || !activeTreeBranchId) return '';
		const activeBranch = globalBranchTree.allBranches.find(b => b.id === activeTreeBranchId);
		return activeBranch?.checkpoint.label.replace(/-/g, ' ') || '';
	});

	// =========================================================================
	// Tool result pairing
	// =========================================================================

	const allVisibleMessages = $derived(resolvedMessages.messages);
	const toolResultMap = $derived(buildToolResultMap(allVisibleMessages));
	const consumedToolIds = $derived(getConsumedToolMessageIds(allVisibleMessages));

	// =========================================================================
	// Visible message items for rendering
	// =========================================================================

	const visibleItems = $derived.by(() => {
		const msgs = resolvedMessages.messages;
		const forkIdx = resolvedMessages.forkIndex;

		return msgs.map((msg, i) => ({
			message: msg,
			index: i,
			isForkPoint: hasBranching && i === forkIdx && forkIdx > 0,
		}));
	});

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
		return { sharedMessages: [] as MessageWithMetadata[], branchPoints: [] as BranchPoint[] };
	}

	export function getActiveBranches() {
		return {} as Record<string, string>;
	}

	export function switchToBranch(_branchPointId: string, _branchId: string) {
		// No-op — branching is now managed at page level
	}

	export async function switchToBranchContainingMessage(messageId: string): Promise<boolean> {
		// Check current resolved messages
		const found = resolvedMessages.messages.some(m => (m as any).id === messageId);
		if (found) {
			await tick();
			return true;
		}

		// If branching is active, search all branches
		if (globalBranchTree) {
			for (const branch of globalBranchTree.allBranches) {
				if (branch.messages.some(m => (m as any).id === messageId)) {
					onTreeBranchChange?.(branch.id);
					await tick();
					return true;
				}
			}
			// Also check shared prefix
			if (globalBranchTree.sharedPrefix.some(m => (m as any).id === messageId)) {
				await tick();
				return true;
			}
		}

		return false;
	}
</script>

<div class="single-column-layout" class:constrained={!fullWidth} class:full-width={fullWidth}>
	<div class="messages-container">
		{#each visibleItems as item, i (`msg-${item.index}-${getMessageKey(item.message)}`)}
			{#if item.isForkPoint && forkSiblings.length > 0}
				<!-- Inline branch switcher (sticky) -->
				<div class="fork-switcher-wrapper">
					<div class="fork-switcher">
						<div class="fork-switcher-header">
							<span class="fork-icon">&#9670;</span>
							<span class="fork-label">{forkCheckpointLabel}</span>
							<span class="fork-count">{forkSiblings.length} branches</span>
						</div>
						<div class="fork-tabs">
							{#each forkSiblings as sibling (sibling.id)}
								{@const isActive = sibling.id === activeTreeBranchId}
								<button
									type="button"
									class="fork-tab"
									class:active={isActive}
									onclick={() => onTreeBranchChange?.(sibling.id)}
								>
									<span class="fork-tab-dot" class:active={isActive} class:baseline={sibling.isBaseline}></span>
									<span class="fork-tab-name">
										{sibling.label}
										{#if sibling.isBaseline}
											<span class="fork-tab-tag">baseline</span>
										{/if}
									</span>
									<span class="fork-tab-meta">
										{sibling.messages.length} msgs
										{#if sibling.sendMessageCount > 0}
											&middot; {sibling.sendMessageCount} sent
										{/if}
									</span>
								</button>
							{/each}
						</div>
					</div>
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

	/* ---- Inline branch switcher (sticky) ---- */
	.fork-switcher-wrapper {
		position: sticky;
		top: 0;
		z-index: 100;
		margin: 0.25rem 0;
	}

	.fork-switcher {
		background: var(--color-surface);
		border: 2px solid #c4b5fd;
		border-radius: 10px;
		padding: 0.5rem 0.65rem;
		box-shadow: 0 2px 12px rgba(139, 92, 246, 0.08);
	}

	:global(.dark) .fork-switcher {
		border-color: #6d28d9;
		box-shadow: 0 2px 12px rgba(139, 92, 246, 0.15);
	}

	.fork-switcher-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.4rem;
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

	.fork-count {
		font-size: 0.65rem;
		color: #a78bfa;
		margin-left: auto;
	}

	.fork-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.fork-tab {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.55rem;
		background: var(--color-bg-alt);
		border: 1.5px solid var(--color-border);
		border-radius: 6px;
		cursor: pointer;
		font: inherit;
		font-size: 0.75rem;
		color: var(--color-text);
		transition: all 0.12s ease;
	}

	.fork-tab:hover {
		border-color: #a78bfa;
		background: var(--color-surface);
	}

	.fork-tab.active {
		background: linear-gradient(135deg, #faf5ff 0%, #eef2ff 100%);
		border-color: #8b5cf6;
		box-shadow: 0 1px 4px rgba(139, 92, 246, 0.12);
	}

	:global(.dark) .fork-tab.active {
		background: linear-gradient(135deg, #2e106540 0%, #1e1b4b40 100%);
		border-color: #7c3aed;
	}

	.fork-tab-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-border);
		flex-shrink: 0;
	}

	.fork-tab-dot.baseline {
		background: var(--color-text-muted);
	}

	.fork-tab-dot.active {
		background: #22c55e;
	}

	.fork-tab-name {
		font-weight: 500;
	}

	.fork-tab.active .fork-tab-name {
		font-weight: 600;
		color: #581c87;
	}

	:global(.dark) .fork-tab.active .fork-tab-name {
		color: #c4b5fd;
	}

	.fork-tab-tag {
		font-size: 0.58rem;
		font-weight: 500;
		color: var(--color-text-light);
		background: var(--color-bg-alt);
		border-radius: 3px;
		padding: 0 0.15rem;
		margin-left: 0.15rem;
	}

	.fork-tab-meta {
		font-size: 0.65rem;
		color: var(--color-text-light);
		margin-left: 0.15rem;
	}
</style>
