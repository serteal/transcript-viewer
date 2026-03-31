<script lang="ts">
	import type { BranchTree, BranchLeaf } from '$lib/client/utils/branch-tree';
	import { GitBranch, MessageSquare } from 'lucide-svelte';

	let {
		tree,
		activeBranchId,
		onBranchSelect,
	}: {
		tree: BranchTree;
		activeBranchId: string;
		onBranchSelect: (branchId: string) => void;
	} = $props();

	const totalBranches = $derived(tree.allBranches.length);
</script>

<div class="branch-tree">
	<div class="tree-header">
		<GitBranch size={14} strokeWidth={2} />
		<span class="tree-title">Audit Branches</span>
		<span class="tree-count">{totalBranches}</span>
	</div>

	<div class="tree-body">
		<!-- Shared prefix (setup) -->
		{#if tree.sharedPrefix.length > 0}
			<div class="tree-row">
				<div class="tree-graph">
					<div class="tree-dot trunk"></div>
					<div class="tree-vline full"></div>
				</div>
				<div class="tree-info">
					<span class="tree-label muted">Setup</span>
					<span class="tree-meta">{tree.sharedPrefix.length} msgs</span>
				</div>
			</div>
		{/if}

		<!-- For each checkpoint: parent node + branch leaves -->
		{#each tree.checkpoints as cp, ci (cp.label)}
			{@const branches = tree.branchesByCheckpoint.get(cp.label) || []}
			{@const isLastCheckpoint = ci === tree.checkpoints.length - 1}

			<!-- Checkpoint parent node -->
			<div class="tree-row">
				<div class="tree-graph">
					<div class="tree-dot checkpoint"></div>
					{#if branches.length > 0}
						<div class="tree-vline full"></div>
					{/if}
				</div>
				<div class="tree-info">
					<span class="tree-label checkpoint-label">{cp.label.replace(/-/g, ' ')}</span>
				</div>
			</div>

			<!-- Branch leaves from this checkpoint -->
			{#each branches as branch, bi (branch.id)}
				{@const isActive = branch.id === activeBranchId}
				{@const isLast = bi === branches.length - 1}
				<button
					type="button"
					class="tree-row branch-row"
					class:active={isActive}
					onclick={() => onBranchSelect(branch.id)}
				>
					<div class="tree-graph branched">
						<!-- Vertical line through the fork -->
						{#if !isLast}
							<div class="tree-vline full"></div>
						{:else}
							<div class="tree-vline half"></div>
						{/if}
						<!-- Horizontal fork line -->
						<div class="tree-hline"></div>
						<!-- Branch dot -->
						<div class="tree-dot branch" class:active={isActive} class:baseline={branch.isBaseline}></div>
					</div>
					<div class="tree-info">
						<span class="tree-label" class:active={isActive}>
							{branch.label}
							{#if branch.isBaseline}
								<span class="tree-baseline-tag">baseline</span>
							{/if}
						</span>
						<span class="tree-meta">
							{branch.messages.length} msgs
							{#if branch.sendMessageCount > 0}
								<span class="tree-sends">
									<MessageSquare size={10} strokeWidth={2} />
									{branch.sendMessageCount}
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

	/* ---- Row layout ---- */
	.tree-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 28px;
		padding: 0.15rem 0;
	}

	.tree-row.branch-row {
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		border-radius: 4px;
		padding: 0.2rem 0.35rem;
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

	/* ---- Graph column (dots + lines) ---- */
	.tree-graph {
		position: relative;
		width: 20px;
		min-height: 24px;
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

	.tree-dot.branch.baseline {
		background: var(--color-text-muted);
		border-color: var(--color-text-muted);
	}

	.tree-dot.branch.active {
		background: #22c55e;
		border-color: #22c55e;
	}

	/* Vertical lines */
	.tree-vline {
		position: absolute;
		left: 50%;
		width: 2px;
		background: var(--color-border);
		transform: translateX(-50%);
	}

	.tree-vline.full {
		top: 0;
		bottom: 0;
	}

	.tree-vline.half {
		top: 0;
		bottom: 50%;
	}

	/* Branched graph: shift dot right, add horizontal line */
	.tree-graph.branched {
		justify-content: flex-end;
		padding-right: 0;
	}

	.tree-hline {
		position: absolute;
		left: 50%;
		right: 2px;
		top: 50%;
		height: 2px;
		background: var(--color-border);
		transform: translateY(-50%);
	}

	.tree-dot.branch {
		margin-right: -2px;
	}

	/* ---- Info column ---- */
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

	.tree-baseline-tag {
		font-size: 0.6rem;
		font-weight: 500;
		color: var(--color-text-light);
		background: var(--color-bg-alt);
		border-radius: 3px;
		padding: 0 0.2rem;
		margin-left: 0.25rem;
		vertical-align: middle;
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
