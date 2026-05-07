<script lang="ts">
	import { ChevronDown, ChevronRight, Play, X, GitBranch, ArrowUp } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { UserComment, UserHighlight, Citation } from '$lib/shared/types';
	import type { BranchTree } from '$lib/client/utils/branch-tree';
	import SidebarCommentCard from './SidebarCommentCard.svelte';
	import SidebarHighlightCard from './SidebarHighlightCard.svelte';
	import BranchTreeNav from './BranchTreeNav.svelte';

	// Scroll to top function - fast but smooth
	function scrollToTop() {
		const start = window.scrollY;
		const duration = Math.min(300, start / 10); // Max 300ms, scales with distance
		const startTime = performance.now();

		function animate(currentTime: number) {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			// Ease out cubic for snappy feel
			const eased = 1 - Math.pow(1 - progress, 3);
			window.scrollTo(0, start * (1 - eased));
			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		}

		requestAnimationFrame(animate);
	}


	// Sidebar width constants
	const MIN_WIDTH = 280;
	const DEFAULT_WIDTH = 320;
	const STORAGE_KEY = 'petri-sidebar-width';

	// Compute max width dynamically (65% of viewport)
	const getMaxWidth = () => typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.65) : 800;

	// Sidebar width state
	let sidebarWidth = $state(DEFAULT_WIDTH);
	let isResizing = $state(false);

	// Load saved width on mount
	onMount(() => {
		if (browser) {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = parseInt(saved, 10);
				const maxWidth = getMaxWidth();
				if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= maxWidth) {
					sidebarWidth = parsed;
				}
			}
		}
	});

	// Save width when it changes
	$effect(() => {
		if (browser && sidebarWidth !== DEFAULT_WIDTH) {
			localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
		}
	});

	// Resize handlers
	function startResize(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		document.addEventListener('mousemove', handleResize);
		document.addEventListener('mouseup', stopResize);
		document.body.style.cursor = 'ew-resize';
		document.body.style.userSelect = 'none';
	}

	function handleResize(e: MouseEvent) {
		if (!isResizing) return;
		const newWidth = window.innerWidth - e.clientX;
		const maxWidth = getMaxWidth();
		sidebarWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
	}

	function stopResize() {
		isResizing = false;
		document.removeEventListener('mousemove', handleResize);
		document.removeEventListener('mouseup', stopResize);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	// Message info type for highlight display
	type MessageInfo = { messageNumber: number; sourceLabel: string | null };

	let {
		comments = [],
		highlights = [],
		judgeCitations = [],
		messageInfoMap = new Map<string, MessageInfo>(),
		currentUser = '',
		// Metadata props
		auditorModel,
		targetModel,
		judgeModel,
		startTime,
		endTime,
		duration,
		// Branch tree props
		branchTree,
		activeSegmentId,
		onSegmentSelect,
		onClose,
		onCommentClick,
		onHighlightClick,
		onJudgeCitationClick,
		onPlaySlideshow,
		onDeleteComment,
		onDeleteHighlight
	}: {
		comments?: UserComment[];
		highlights?: UserHighlight[];
		judgeCitations?: Citation[];
		messageInfoMap?: Map<string, MessageInfo>;
		currentUser?: string;
		// Metadata props
		auditorModel?: string;
		targetModel?: string;
		judgeModel?: string;
		startTime?: string;
		endTime?: string;
		duration?: string;
		// Branch tree props
		branchTree?: BranchTree | null;
		activeSegmentId?: string;
		onSegmentSelect?: (segmentId: string) => void;
		onClose: () => void;
		onCommentClick: (comment: UserComment) => void;
		onHighlightClick: (index: number) => void;
		onJudgeCitationClick?: (messageId: string) => void;
		onPlaySlideshow: () => void;
		onDeleteComment?: (id: string) => void;
		onDeleteHighlight?: (id: string) => void;
	} = $props();

	let infoExpanded = $state(true);
	let branchesExpanded = $state(true);
	let commentsExpanded = $state(true);
	let judgeCitationsExpanded = $state(true);
	let highlightsExpanded = $state(true);

	// Sort comments by date (oldest first)
	const sortedComments = $derived(
		[...comments].sort((a, b) =>
			new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
		)
	);

	// Count new comments (user not in viewed_by)
	const newCommentCount = $derived(
		comments.filter(c =>
			currentUser && c.viewed_by && !c.viewed_by.includes(currentUser)
		).length
	);

	function isNewComment(comment: UserComment): boolean {
		if (!currentUser) return false;
		return comment.viewed_by !== undefined && !comment.viewed_by.includes(currentUser);
	}
</script>

<aside class="right-sidebar" style="width: {sidebarWidth}px;">
	<!-- Resize handle -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="resize-handle"
		class:resizing={isResizing}
		onmousedown={startResize}
	></div>

	<header class="sidebar-header">
		<button type="button" class="back-to-top-btn" onclick={scrollToTop} aria-label="Back to top">
			<ArrowUp size={16} />
			<span>Top</span>
		</button>
		<div class="header-spacer"></div>
		<button type="button" class="close-btn" onclick={onClose} aria-label="Close sidebar">
			<X size={18} />
		</button>
	</header>

	<div class="sidebar-content">
		<!-- Info Section -->
		<section class="sidebar-section">
			<button
				type="button"
				class="section-header"
				onclick={() => infoExpanded = !infoExpanded}
				aria-expanded={infoExpanded}
			>
				{#if infoExpanded}
					<ChevronDown size={16} />
				{:else}
					<ChevronRight size={16} />
				{/if}
				<span class="section-title">Info</span>
			</button>

			{#if infoExpanded}
				<div class="section-content">
					<div class="info-grid">
						{#if auditorModel}
							<div class="info-row">
								<span class="info-label">Auditor</span>
								<span class="info-value" title={auditorModel}>{auditorModel}</span>
							</div>
						{/if}
						{#if targetModel}
							<div class="info-row">
								<span class="info-label">Target</span>
								<span class="info-value" title={targetModel}>{targetModel}</span>
							</div>
						{/if}
						{#if judgeModel}
							<div class="info-row">
								<span class="info-label">Judge</span>
								<span class="info-value" title={judgeModel}>{judgeModel}</span>
							</div>
						{/if}
						{#if duration}
							<div class="info-row">
								<span class="info-label">Duration</span>
								<span class="info-value">{duration}</span>
							</div>
						{/if}
						{#if startTime}
							<div class="info-row">
								<span class="info-label">Start</span>
								<span class="info-value">{startTime}</span>
							</div>
						{/if}
						{#if endTime}
							<div class="info-row">
								<span class="info-label">End</span>
								<span class="info-value">{endTime}</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</section>

		<!-- Branch Tree Section (checkpoint/restore pattern) -->
		{#if branchTree && branchTree.allBranches.length > 1}
			<section class="sidebar-section">
				<button
					type="button"
					class="section-header"
					onclick={() => branchesExpanded = !branchesExpanded}
					aria-expanded={branchesExpanded}
				>
					{#if branchesExpanded}
						<ChevronDown size={16} />
					{:else}
						<ChevronRight size={16} />
					{/if}
					<span class="section-title">Branches ({branchTree.allBranches.length})</span>
				</button>

				{#if branchesExpanded}
					<div class="section-content">
						<BranchTreeNav
							tree={branchTree}
							activeBranchId={activeSegmentId || branchTree.allBranches[0]?.id || ''}
							onBranchSelect={(id) => onSegmentSelect?.(id)}
						/>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Comments Section -->
		<section class="sidebar-section">
			<button
				type="button"
				class="section-header"
				onclick={() => commentsExpanded = !commentsExpanded}
				aria-expanded={commentsExpanded}
			>
				{#if commentsExpanded}
					<ChevronDown size={16} />
				{:else}
					<ChevronRight size={16} />
				{/if}
				<span class="section-title">Comments ({comments.length})</span>
				{#if newCommentCount > 0}
					<span class="new-count">{newCommentCount} new</span>
				{/if}
			</button>

			{#if commentsExpanded}
				<div class="section-content">
					{#if sortedComments.length === 0}
						<p class="empty-message">No comments yet</p>
					{:else}
						<div class="cards-list">
							{#each sortedComments as comment}
								{@const msgInfo = messageInfoMap.get(comment.message_id)}
								<SidebarCommentCard
									{comment}
									isNew={isNewComment(comment)}
									messageNumber={msgInfo?.messageNumber}
									sourceLabel={msgInfo?.sourceLabel}
									onClick={() => onCommentClick(comment)}
									onDelete={onDeleteComment}
								/>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Judge Citations Section -->
		{#if judgeCitations.length > 0}
			<section class="sidebar-section">
				<button
					type="button"
					class="section-header"
					onclick={() => judgeCitationsExpanded = !judgeCitationsExpanded}
					aria-expanded={judgeCitationsExpanded}
				>
					{#if judgeCitationsExpanded}
						<ChevronDown size={16} />
					{:else}
						<ChevronRight size={16} />
					{/if}
					<span class="section-title">Judge Citations ({judgeCitations.length})</span>
				</button>

				{#if judgeCitationsExpanded}
					<div class="section-content">
						<div class="cards-list">
							{#each judgeCitations as citation, i}
								{@const messageId = citation.parts?.[0]?.message_id}
								{@const msgInfo = messageId ? messageInfoMap.get(messageId) : undefined}
								<button
									type="button"
									class="judge-citation-card"
									onclick={() => {
										if (messageId && onJudgeCitationClick) onJudgeCitationClick(messageId);
									}}
								>
									<div class="jc-header">
										{#if msgInfo}
											<span class="jc-msg-num">Msg {msgInfo.messageNumber}</span>
										{/if}
										{#if msgInfo?.sourceLabel}
											<span class="jc-source">{msgInfo.sourceLabel}</span>
										{/if}
									</div>
									<div class="jc-description">{citation.description}</div>
									{#if citation.parts?.[0]?.quoted_text}
										<div class="jc-quote">{citation.parts[0].quoted_text.length > 150 ? citation.parts[0].quoted_text.slice(0, 150) + '...' : citation.parts[0].quoted_text}</div>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</section>
		{/if}

		<!-- User Highlights Section -->
		<section class="sidebar-section">
			<button
				type="button"
				class="section-header"
				onclick={() => highlightsExpanded = !highlightsExpanded}
				aria-expanded={highlightsExpanded}
			>
				{#if highlightsExpanded}
					<ChevronDown size={16} />
				{:else}
					<ChevronRight size={16} />
				{/if}
				<span class="section-title">Highlights ({highlights.length})</span>
			</button>

			{#if highlightsExpanded}
				<div class="section-content">
					{#if highlights.length > 0}
						<button type="button" class="play-slideshow-btn" onclick={onPlaySlideshow}>
							<Play size={14} />
							<span>Play Slideshow</span>
						</button>
					{/if}

					{#if highlights.length === 0}
						<p class="empty-message">No highlights yet</p>
					{:else}
						<div class="cards-list">
							{#each highlights as highlight, i}
								{@const msgInfo = messageInfoMap.get(highlight.message_id)}
								<SidebarHighlightCard
									{highlight}
									index={i}
									messageNumber={msgInfo?.messageNumber}
									sourceLabel={msgInfo?.sourceLabel}
									onClick={() => onHighlightClick(i)}
									onDelete={onDeleteHighlight}
								/>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</section>
	</div>
</aside>

<style>
	.right-sidebar {
		position: sticky;
		top: 0;
		right: 0;
		height: 100vh;
		flex-shrink: 0;
		background: var(--color-surface);
		border-left: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		z-index: var(--z-sidebar);
		overflow: hidden;
		margin-left: 0.33rem;
	}

	/* Resize handle */
	.resize-handle {
		position: absolute;
		top: 0;
		left: -4px;
		width: 8px;
		height: 100%;
		cursor: ew-resize;
		background: transparent;
		z-index: 10;
	}

	/* Visible grip indicator */
	.resize-handle::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 4px;
		height: 48px;
		background: var(--color-border);
		border-radius: 2px;
		transition: all var(--transition-fast);
	}

	.resize-handle:hover::after,
	.resize-handle.resizing::after {
		background: var(--color-accent);
		height: 64px;
		box-shadow: 0 0 8px rgba(var(--color-accent-rgb, 37, 99, 235), 0.3);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	.header-spacer {
		flex: 1;
	}

	.back-to-top-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		border-radius: 6px;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.back-to-top-btn:hover {
		background: var(--color-bg-alt);
		border-color: var(--color-text-muted);
		color: var(--color-text);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		background: transparent;
		border-radius: 6px;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.close-btn:hover {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.sidebar-content {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
	}

	.sidebar-section {
		margin-bottom: 0.5rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		padding: 0.6rem 0.5rem;
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.section-header:hover {
		background: var(--color-bg-alt);
	}

	.section-title {
		flex: 1;
		text-align: left;
	}

	.new-count {
		background: var(--color-new);
		color: white;
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
	}

	.section-content {
		padding: 0.25rem 0 0.5rem 0;
	}

	.cards-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.empty-message {
		font-size: 0.8rem;
		color: var(--color-text-light);
		text-align: center;
		padding: 1rem;
		margin: 0;
	}

	.play-slideshow-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.5rem;
		margin-bottom: 0.75rem;
		background: var(--color-accent);
		border: none;
		border-radius: 6px;
		color: white;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.play-slideshow-btn:hover {
		background: var(--color-accent-hover);
	}

	/* Info section styles */
	.info-grid {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.info-label {
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.info-value {
		color: var(--color-text);
		font-weight: 500;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 180px;
	}

	/* Branches section styles */

	/* Judge citation cards */
	.judge-citation-card {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--color-bg, #FAF7F2);
		border: 1px solid rgb(187 247 208);
		border-left: 3px solid rgb(34 197 94);
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.35rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
		font-family: inherit;
	}

	.judge-citation-card:hover {
		background: rgb(240 253 244);
		border-color: rgb(134 239 172);
	}

	:global(.dark) .judge-citation-card {
		background: var(--color-surface-alt, #2a2a2a);
		border-color: rgb(20 83 45);
	}

	:global(.dark) .judge-citation-card:hover {
		background: rgb(20 83 45 / 0.3);
	}

	.jc-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.25rem;
	}

	.jc-msg-num {
		font-size: 0.7rem;
		font-weight: 600;
		color: rgb(22 163 74);
		background: rgb(220 252 231);
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
	}

	:global(.dark) .jc-msg-num {
		color: rgb(134 239 172);
		background: rgb(20 83 45);
	}

	.jc-source {
		font-size: 0.65rem;
		color: var(--color-text-muted, #8B7E6A);
		text-transform: uppercase;
	}

	.jc-description {
		font-size: 0.78rem;
		color: var(--color-text, #3D3328);
		line-height: 1.35;
		margin-bottom: 0.2rem;
	}

	.jc-quote {
		font-size: 0.72rem;
		color: var(--color-text-muted, #8B7E6A);
		font-style: italic;
		line-height: 1.3;
		border-left: 2px solid var(--color-border, #E8E0D5);
		padding-left: 0.5rem;
	}
</style>
