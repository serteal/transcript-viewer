<script lang="ts">
	import type { BranchTree, BranchSegment, CheckpointNode } from '$lib/client/utils/branch-tree';
	import { GitBranch, Circle, Diamond, MessageSquare } from 'lucide-svelte';

	let {
		tree,
		activeSegmentId,
		onSegmentSelect,
	}: {
		tree: BranchTree;
		activeSegmentId: string;
		onSegmentSelect: (segmentId: string) => void;
	} = $props();

	// Build a display-friendly tree structure
	interface TreeNode {
		type: 'checkpoint' | 'segment';
		checkpoint?: CheckpointNode;
		segment?: BranchSegment;
		children: TreeNode[];
		depth: number;
	}

	const displayTree = $derived.by(() => {
		const nodes: TreeNode[] = [];

		// Shared prefix node
		if (tree.sharedPrefix.length > 0) {
			nodes.push({
				type: 'segment',
				segment: {
					id: 'shared',
					label: 'Setup',
					parentCheckpoint: null,
					startIndex: 0,
					endIndex: tree.firstForkIndex + 1,
					messages: tree.sharedPrefix,
					sendMessageCount: 0,
				},
				children: [],
				depth: 0,
			});
		}

		// Find checkpoints in the shared prefix that have forks
		const forkedCheckpoints = tree.checkpoints.filter(
			cp => tree.forkMap.has(cp.label) && (tree.forkMap.get(cp.label)?.length ?? 0) > 0
		);

		// For each forked checkpoint, add it and its branches
		for (const cp of forkedCheckpoints) {
			const cpNode: TreeNode = {
				type: 'checkpoint',
				checkpoint: cp,
				children: [],
				depth: 0,
			};

			const branchIds = tree.forkMap.get(cp.label) || [];
			for (const branchId of branchIds) {
				const segment = tree.segments.find(s => s.id === branchId);
				if (segment) {
					cpNode.children.push({
						type: 'segment',
						segment,
						children: [],
						depth: 1,
					});
				}
			}

			nodes.push(cpNode);
		}

		return nodes;
	});
</script>

<div class="branch-tree">
	<div class="tree-header">
		<GitBranch size={14} strokeWidth={2} />
		<span class="tree-title">Audit Branches</span>
		<span class="tree-count">{tree.segments.length}</span>
	</div>

	<div class="tree-body">
		<!-- Shared prefix -->
		{#if tree.sharedPrefix.length > 0}
			<div class="tree-row">
				<div class="tree-graph">
					<div class="tree-dot trunk"></div>
					<div class="tree-line"></div>
				</div>
				<div class="tree-info">
					<span class="tree-label muted">Setup</span>
					<span class="tree-meta">{tree.sharedPrefix.length} msgs</span>
				</div>
			</div>
		{/if}

		<!-- For each forked checkpoint and its branches -->
		{#each displayTree.filter(n => n.type === 'checkpoint') as cpNode}
			{@const cp = cpNode.checkpoint}
			{@const branches = cpNode.children}

			<!-- Checkpoint node -->
			<div class="tree-row checkpoint-row">
				<div class="tree-graph">
					<div class="tree-dot checkpoint"></div>
					{#if branches.length > 0}
						<div class="tree-line"></div>
					{/if}
				</div>
				<div class="tree-info">
					<span class="tree-label checkpoint-label">{cp?.label.replace(/-/g, ' ')}</span>
				</div>
			</div>

			<!-- Branch segments from this checkpoint -->
			{#each branches as branchNode, bi}
				{@const seg = branchNode.segment}
				{@const isActive = seg?.id === activeSegmentId}
				{@const isLast = bi === branches.length - 1}
				<button
					type="button"
					class="tree-row branch-row"
					class:active={isActive}
					onclick={() => seg && onSegmentSelect(seg.id)}
				>
					<div class="tree-graph branched">
						<div class="tree-fork-line" class:last={isLast}></div>
						<div class="tree-fork-horizontal"></div>
						<div class="tree-dot branch" class:active={isActive}></div>
					</div>
					<div class="tree-info">
						<span class="tree-label" class:active={isActive}>{seg?.label}</span>
						<span class="tree-meta">
							{seg?.messages.length} msgs
							{#if seg && seg.sendMessageCount > 0}
								<span class="tree-sends">
									<MessageSquare size={10} strokeWidth={2} />
									{seg.sendMessageCount}
								</span>
							{/if}
						</span>
					</div>
				</button>
			{/each}
		{/each}
	</div>
</div>

<style>
	.branch-tree {
		font-size: 0.82rem;
	}

	.tree-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}

	.tree-title {
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.tree-count {
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
		border-radius: 999px;
		padding: 0 0.35rem;
		font-size: 0.65rem;
		font-weight: 600;
	}

	.tree-body {
		display: flex;
		flex-direction: column;
	}

	.tree-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0;
		min-height: 28px;
	}

	.tree-row.branch-row {
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		border-radius: 4px;
		padding: 0.25rem 0.35rem;
		width: 100%;
		color: inherit;
		font: inherit;
	}

	.tree-row.branch-row:hover {
		background: var(--color-bg-alt);
	}

	.tree-row.branch-row.active {
		background: var(--color-accent-bg, #F5EDE4);
	}

	/* Graph column */
	.tree-graph {
		position: relative;
		width: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		align-self: stretch;
	}

	.tree-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		z-index: 1;
		flex-shrink: 0;
	}

	.tree-dot.trunk {
		background: var(--color-text-muted);
	}

	.tree-dot.checkpoint {
		background: #8b5cf6;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		transform: rotate(45deg);
	}

	.tree-dot.branch {
		background: var(--color-border);
		border: 2px solid var(--color-border);
	}

	.tree-dot.branch.active {
		background: #22c55e;
		border-color: #22c55e;
	}

	.tree-line {
		position: absolute;
		left: 50%;
		top: 50%;
		bottom: -1px;
		width: 2px;
		background: var(--color-border);
		transform: translateX(-50%);
	}

	/* Branched graph lines */
	.tree-graph.branched {
		position: relative;
	}

	.tree-fork-line {
		position: absolute;
		left: 50%;
		top: -1px;
		bottom: -1px;
		width: 2px;
		background: var(--color-border);
		transform: translateX(-50%);
	}

	.tree-fork-line.last {
		bottom: 50%;
	}

	.tree-fork-horizontal {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 8px;
		height: 2px;
		background: var(--color-border);
		transform: translateY(-50%);
	}

	.tree-dot.branch {
		margin-left: 8px;
	}

	/* Info column */
	.tree-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}

	.tree-label {
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tree-label.muted {
		color: var(--color-text-muted);
	}

	.tree-label.active {
		color: var(--color-text);
		font-weight: 600;
	}

	.tree-label.checkpoint-label {
		color: #7c3aed;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.tree-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		color: var(--color-text-light);
	}

	.tree-sends {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
	}
</style>
