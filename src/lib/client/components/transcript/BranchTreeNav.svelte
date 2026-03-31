<script lang="ts">
	import type { BranchTree, BranchLeaf, CheckpointNode } from '$lib/client/utils/branch-tree';
	import { GitBranch, MessageSquare, ChevronRight, ChevronDown, FolderOpen, Folder } from 'lucide-svelte';

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

	// Build a nested tree structure from flat checkpoints using parentCheckpointLabel
	interface TreeItem {
		type: 'checkpoint' | 'branch';
		checkpoint?: CheckpointNode;
		branch?: BranchLeaf;
		children: TreeItem[];
		depth: number;
	}

	const nestedTree = $derived.by((): TreeItem[] => {
		// Build checkpoint → children map
		const cpMap = new Map<string, TreeItem>();

		for (const cp of tree.checkpoints) {
			cpMap.set(cp.label, {
				type: 'checkpoint',
				checkpoint: cp,
				children: [],
				depth: 0,
			});
		}

		// Attach branches as children of their checkpoint
		for (const cp of tree.checkpoints) {
			const cpItem = cpMap.get(cp.label)!;
			const branches = tree.branchesByCheckpoint.get(cp.label) || [];
			for (const branch of branches) {
				cpItem.children.push({
					type: 'branch',
					branch,
					children: [],
					depth: 0,
				});
			}
		}

		// Nest child checkpoints under their parent's baseline branch
		// cp2 (parent=cp1) should appear inside cp1's baseline branch children
		for (const cp of tree.checkpoints) {
			if (cp.parentCheckpointLabel) {
				const parentCpItem = cpMap.get(cp.parentCheckpointLabel);
				if (parentCpItem) {
					// Find the baseline branch of the parent
					const baselineBranch = parentCpItem.children.find(
						c => c.type === 'branch' && c.branch?.isBaseline
					);
					if (baselineBranch) {
						baselineBranch.children.push(cpMap.get(cp.label)!);
					}
				}
			}
		}

		// Collect top-level items: shared prefix + root checkpoints
		const roots: TreeItem[] = [];
		for (const cp of tree.checkpoints) {
			if (!cp.parentCheckpointLabel) {
				roots.push(cpMap.get(cp.label)!);
			}
		}

		// Assign depths recursively
		function assignDepth(items: TreeItem[], depth: number) {
			for (const item of items) {
				item.depth = depth;
				assignDepth(item.children, depth + 1);
			}
		}
		assignDepth(roots, 0);

		return roots;
	});

	// Track expanded state for checkpoint nodes
	let expandedCps = $state<Record<string, boolean>>({});

	// Auto-expand all by default
	$effect(() => {
		const initial: Record<string, boolean> = {};
		for (const cp of tree.checkpoints) {
			if (expandedCps[cp.label] === undefined) {
				initial[cp.label] = true;
			}
		}
		if (Object.keys(initial).length > 0) {
			expandedCps = { ...expandedCps, ...initial };
		}
	});

	function toggleCp(label: string) {
		expandedCps = { ...expandedCps, [label]: !expandedCps[label] };
	}
</script>

<div class="btree">
	<div class="btree-header">
		<GitBranch size={14} strokeWidth={2} />
		<span class="btree-title">Audit Branches</span>
		<span class="btree-count">{totalBranches}</span>
	</div>

	<!-- Setup row -->
	{#if tree.sharedPrefix.length > 0}
		<div class="btree-row setup-row">
			<span class="btree-icon">&#9679;</span>
			<span class="btree-name muted">Setup</span>
			<span class="btree-meta">{tree.sharedPrefix.length} msgs</span>
		</div>
	{/if}

	<!-- Recursive tree rendering -->
	{@render renderItems(nestedTree)}
</div>

{#snippet renderItems(items: TreeItem[])}
	{#each items as item (item.type === 'checkpoint' ? item.checkpoint?.label : item.branch?.id)}
		{#if item.type === 'checkpoint' && item.checkpoint}
			{@const cp = item.checkpoint}
			{@const expanded = expandedCps[cp.label] !== false}
			{@const indent = item.depth}
			<button
				type="button"
				class="btree-row cp-row"
				style="padding-left: {indent * 16 + 4}px"
				onclick={() => toggleCp(cp.label)}
			>
				<span class="btree-chevron">
					{#if expanded}
						<ChevronDown size={12} strokeWidth={2} />
					{:else}
						<ChevronRight size={12} strokeWidth={2} />
					{/if}
				</span>
				<span class="btree-icon cp-icon">&#9670;</span>
				<span class="btree-name cp-name">{cp.label.replace(/-/g, ' ')}</span>
			</button>
			{#if expanded}
				{#each item.children as child (child.type === 'checkpoint' ? child.checkpoint?.label : child.branch?.id)}
					{#if child.type === 'branch' && child.branch}
						{@const branch = child.branch}
						{@const isActive = branch.id === activeBranchId}
						{@const hasChildren = child.children.length > 0}
						<button
							type="button"
							class="btree-row branch-row"
							class:active={isActive}
							style="padding-left: {(indent + 1) * 16 + 4}px"
							onclick={() => onBranchSelect(branch.id)}
						>
							<span class="btree-branch-line">
								{#if hasChildren}
									<span class="btree-branch-connector has-children"></span>
								{:else}
									<span class="btree-branch-connector"></span>
								{/if}
							</span>
							<span class="btree-dot" class:active={isActive} class:baseline={branch.isBaseline}></span>
							<span class="btree-name" class:active={isActive}>
								{branch.label}
								{#if branch.isBaseline}
									<span class="btree-tag">baseline</span>
								{/if}
							</span>
							<span class="btree-meta">
								{branch.messages.length}
								{#if branch.sendMessageCount > 0}
									<span class="btree-sends">
										<MessageSquare size={9} strokeWidth={2} />
										{branch.sendMessageCount}
									</span>
								{/if}
							</span>
						</button>
						<!-- Nested checkpoints under this branch -->
						{#if child.children.length > 0}
							{@render renderItems(child.children)}
						{/if}
					{:else if child.type === 'checkpoint'}
						<!-- Checkpoint nested directly under parent (shouldn't happen with current logic, but safe) -->
						{@render renderItems([child])}
					{/if}
				{/each}
			{/if}
		{/if}
	{/each}
{/snippet}

<style>
	.btree {
		font-size: 0.8rem;
	}

	.btree-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--color-text-muted);
		margin-bottom: 0.4rem;
	}

	.btree-title {
		font-weight: 600;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.btree-count {
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
		border-radius: 999px;
		padding: 0 0.3rem;
		font-size: 0.62rem;
		font-weight: 600;
	}

	/* ---- Rows ---- */
	.btree-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 26px;
		padding: 0.15rem 4px;
		border: none;
		background: transparent;
		width: 100%;
		text-align: left;
		color: inherit;
		font: inherit;
		font-size: 0.78rem;
		border-radius: 4px;
	}

	.btree-row.cp-row {
		cursor: pointer;
	}

	.btree-row.cp-row:hover {
		background: var(--color-bg-alt);
	}

	.btree-row.branch-row {
		cursor: pointer;
	}

	.btree-row.branch-row:hover {
		background: var(--color-bg-alt);
	}

	.btree-row.branch-row.active {
		background: var(--color-accent-bg, #F5EDE4);
	}

	/* ---- Icons ---- */
	.btree-icon {
		flex-shrink: 0;
		font-size: 0.55rem;
		color: var(--color-text-muted);
		width: 12px;
		text-align: center;
	}

	.btree-icon.cp-icon {
		color: #8b5cf6;
		font-size: 0.65rem;
	}

	.btree-chevron {
		flex-shrink: 0;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		width: 14px;
	}

	/* ---- Branch line connector ---- */
	.btree-branch-line {
		flex-shrink: 0;
		width: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btree-branch-connector {
		display: block;
		width: 8px;
		height: 1px;
		background: var(--color-border);
	}

	/* ---- Dot ---- */
	.btree-dot {
		flex-shrink: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-border);
		border: 1.5px solid var(--color-border);
	}

	.btree-dot.baseline {
		background: var(--color-text-muted);
		border-color: var(--color-text-muted);
	}

	.btree-dot.active {
		background: #22c55e;
		border-color: #22c55e;
	}

	/* ---- Text ---- */
	.btree-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		color: var(--color-text);
	}

	.btree-name.muted {
		color: var(--color-text-muted);
	}

	.btree-name.active {
		font-weight: 600;
	}

	.btree-name.cp-name {
		color: #7c3aed;
		font-weight: 600;
		font-size: 0.72rem;
		text-transform: capitalize;
	}

	.btree-tag {
		font-size: 0.58rem;
		font-weight: 500;
		color: var(--color-text-light);
		background: var(--color-bg-alt);
		border-radius: 3px;
		padding: 0 0.2rem;
		margin-left: 0.2rem;
		vertical-align: middle;
	}

	.btree-meta {
		flex-shrink: 0;
		font-size: 0.65rem;
		color: var(--color-text-light);
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.btree-sends {
		display: inline-flex;
		align-items: center;
		gap: 0.1rem;
	}

	.setup-row {
		padding: 0.15rem 4px;
	}
</style>
