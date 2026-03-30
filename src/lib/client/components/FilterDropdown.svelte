<script lang="ts">
	import { X } from 'lucide-svelte';

	type Filter = { type: string; value: string };

	let {
		activeFilters = [],
		onToggleFilter,
		onClearAll,
		availableToolTypes = [],
	}: {
		activeFilters: Filter[];
		onToggleFilter: (type: string, value: string) => void;
		onClearAll: () => void;
		availableToolTypes?: string[];
	} = $props();

	const roleOptions = ['system', 'user', 'assistant', 'tool'];
	const hasOptions = [
		{ value: 'comments', label: 'Comments' },
		{ value: 'highlights', label: 'Highlights' },
		{ value: 'errors', label: 'Errors' },
		{ value: 'tool_calls', label: 'Tool Calls' }
	];

	function isActive(type: string, value: string): boolean {
		return activeFilters.some(f => f.type === type && f.value === value);
	}

	function handleToggle(type: string, value: string) {
		onToggleFilter(type, value);
	}
</script>

<div class="filter-dropdown">
	<div class="dropdown-header">Add Filter</div>

	<div class="filter-section">
		<div class="section-label">Role</div>
		<div class="filter-chips">
			{#each roleOptions as role}
				<button
					type="button"
					class="filter-chip"
					class:active={isActive('role', role)}
					onclick={() => handleToggle('role', role)}
				>
					{role}
				</button>
			{/each}
		</div>
	</div>

	<div class="filter-section">
		<div class="section-label">Has</div>
		<div class="filter-chips">
			{#each hasOptions as option}
				<button
					type="button"
					class="filter-chip"
					class:active={isActive('has', option.value)}
					onclick={() => handleToggle('has', option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>

	{#if availableToolTypes.length > 0}
		<div class="filter-section">
			<div class="section-label">Tool Type</div>
			<div class="filter-chips">
				{#each availableToolTypes as toolType}
					<button
						type="button"
						class="filter-chip tool-chip"
						class:active={isActive('tool', toolType)}
						onclick={() => handleToggle('tool', toolType)}
					>
						{toolType}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if activeFilters.length > 0}
		<div class="dropdown-footer">
			<button type="button" class="clear-all-btn" onclick={onClearAll}>
				<X size={12} />
				Clear all filters
			</button>
		</div>
	{/if}
</div>

<style>
	.filter-dropdown {
		padding: var(--space-2);
		min-width: 240px;
	}

	.dropdown-header {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-2) var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-2);
	}

	.filter-section {
		padding: var(--space-2);
	}

	.section-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
	}

	.filter-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.filter-chip {
		padding: 4px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.filter-chip:hover {
		background: var(--color-bg-alt);
		border-color: var(--color-text-muted);
	}

	.filter-chip.active {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.filter-chip.tool-chip {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.7rem;
	}

	.dropdown-footer {
		padding: var(--space-2);
		border-top: 1px solid var(--color-border);
		margin-top: var(--space-2);
	}

	.clear-all-btn {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		padding: var(--space-2);
		font-size: 0.8rem;
		color: var(--color-error);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.clear-all-btn:hover {
		background: var(--color-error-bg);
	}
</style>
