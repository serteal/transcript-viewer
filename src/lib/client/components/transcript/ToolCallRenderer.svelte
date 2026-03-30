<script lang="ts">
	import type { ToolCall, MessageWithMetadata } from '$lib/shared/types';
	import type { PairedToolResult } from '$lib/client/utils/tool-pairing';
	import { categorizeToolCall, getCompactArgs, getCompactResult, type ToolCategory } from '$lib/client/utils/tool-pairing';
	import HighlightedMarkdown from '$lib/client/components/citations/HighlightedMarkdown.svelte';
	import HighlightedText from '$lib/client/components/citations/HighlightedText.svelte';

	let {
		toolCall,
		result,
		message,
		renderMarkdown = true,
		isCompact = false,
		comments = [],
		highlights = [],
	}: {
		toolCall: ToolCall;
		result?: PairedToolResult;
		message: MessageWithMetadata;
		renderMarkdown?: boolean;
		isCompact?: boolean;
		comments?: any[];
		highlights?: any[];
	} = $props();

	const category = $derived(categorizeToolCall(toolCall));
	let collapsed = $state(false);
	let resultExpanded = $state(false);

	const MAX_RESULT_LINES = 25;
	const MAX_RESULT_CHARS = 3000;

	const resultContent = $derived(result?.content || '');
	const resultLines = $derived(resultContent.split('\n'));
	const isLongResult = $derived(
		resultLines.length > MAX_RESULT_LINES || resultContent.length > MAX_RESULT_CHARS
	);
	const visibleResultContent = $derived(
		isLongResult && !resultExpanded
			? resultLines.slice(0, MAX_RESULT_LINES).join('\n') +
				(resultLines.length > MAX_RESULT_LINES ? '' : '')
			: resultContent
	);
	const hiddenLineCount = $derived(
		isLongResult ? resultLines.length - MAX_RESULT_LINES : 0
	);

	// For terminal tool calls: extract command and description
	const terminalCommand = $derived.by(() => {
		if (category !== 'terminal') return '';
		const args = toolCall.arguments as any;
		return args?.command || args?.cmd || '';
	});
	const terminalDescription = $derived.by(() => {
		if (category !== 'terminal') return '';
		const args = toolCall.arguments as any;
		return args?.description || '';
	});

	// For file read: extract path
	const filePath = $derived.by(() => {
		if (category !== 'file_read' && category !== 'file_edit' && category !== 'file_list') return '';
		const args = toolCall.arguments as any;
		return args?.path || args?.file_path || '';
	});

	// For file edit: extract diff/old_str/new_str
	const editDiff = $derived.by(() => {
		if (category !== 'file_edit') return null;
		const args = toolCall.arguments as any;
		if (args?.diff) return { type: 'diff' as const, content: args.diff };
		if (args?.old_str !== undefined) return { type: 'replacement' as const, old_str: args.old_str, new_str: args.new_str || '' };
		return null;
	});

	// For send_message: extract message content
	const sentMessage = $derived.by(() => {
		if (category !== 'send_message') return '';
		const args = toolCall.arguments as any;
		return args?.message || '';
	});

	// For search: extract pattern and path
	const searchPattern = $derived.by(() => {
		if (category !== 'search') return '';
		const args = toolCall.arguments as any;
		return args?.pattern || args?.query || '';
	});

	// For subagent: extract description + prompt
	const subagentInfo = $derived.by(() => {
		if (category !== 'subagent') return null;
		const args = toolCall.arguments as any;
		return { description: args?.description || '', prompt: args?.prompt || '', type: args?.subagent_type || '' };
	});

	// For lane_marker: extract label
	const markerLabel = $derived.by(() => {
		if (category !== 'lane_marker') return '';
		const args = toolCall.arguments as any;
		return args?.label || args?.reason || toolCall.function;
	});

	// Generic YAML renderer (same as MessageCard's toYaml)
	function toYaml(value: unknown, indent: number = 0): string {
		const pad = (n: number) => '  '.repeat(n);
		const isPlainObject = (v: unknown) => Object.prototype.toString.call(v) === '[object Object]';

		if (value === null || value === undefined) return 'null';
		if (typeof value === 'string') {
			let unescaped: string;
			try { unescaped = JSON.parse('"' + value.replace(/"/g, '\\"') + '"'); } catch { unescaped = value; }
			if (unescaped.includes('\n')) {
				return unescaped.split('\n').map((l) => pad(indent + 1) + l).join('\n');
			}
			const needsQuotes = /^[\s]*$|^[>|]|[:#\[\]{}*&!%@`]/.test(unescaped) || unescaped.startsWith('-') || /^\d/.test(unescaped) || ['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(unescaped.toLowerCase());
			return needsQuotes ? JSON.stringify(unescaped) : unescaped;
		}
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		if (Array.isArray(value)) {
			if (value.length === 0) return '[]';
			return value.map((item) => {
				const rendered = toYaml(item, indent + 1);
				if (rendered.includes('\n')) { return `${pad(indent)}-\n${rendered.split('\n').map((l) => pad(indent + 1) + l).join('\n')}`; }
				return `${pad(indent)}- ${rendered}`;
			}).join('\n');
		}
		if (isPlainObject(value)) {
			const entries = Object.entries(value as Record<string, unknown>);
			if (entries.length === 0) return '{}';
			return entries.map(([k, v]) => {
				const rendered = toYaml(v, indent + 1);
				if (rendered.includes('\n')) { return `${pad(indent)}${k}:\n${rendered.split('\n').map((l) => pad(indent + 1) + l).join('\n')}`; }
				return `${pad(indent)}${k}: ${rendered}`;
			}).join('\n');
		}
		try { return JSON.stringify(value, null, 2); } catch { return String(value); }
	}

	// Parse diff lines for color coding
	function parseDiffLines(diff: string): Array<{ text: string; type: 'add' | 'remove' | 'header' | 'context' }> {
		return diff.split('\n').map(line => {
			if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('***')) {
				return { text: line, type: 'header' as const };
			}
			if (line.startsWith('+')) return { text: line, type: 'add' as const };
			if (line.startsWith('-')) return { text: line, type: 'remove' as const };
			return { text: line, type: 'context' as const };
		});
	}

	function getCategoryIcon(cat: ToolCategory): string {
		switch (cat) {
			case 'terminal': return '$';
			case 'file_read': return '\u{1F4C4}'; // page
			case 'file_edit': return '\u270F'; // pencil
			case 'file_list': return '\u{1F4C1}'; // folder
			case 'search': return '\u{1F50D}'; // magnifying glass
			case 'send_message': return '\u{1F4E8}'; // envelope
			case 'lane_marker': return '\u{1F6A9}'; // flag
			case 'subagent': return '\u{1F916}'; // robot
			case 'scaffold_log': return '\u{1F4CB}'; // clipboard
			default: return '\u{1F527}'; // wrench
		}
	}

	function getCategoryLabel(cat: ToolCategory): string {
		switch (cat) {
			case 'terminal': return 'TERMINAL';
			case 'file_read': return 'READ';
			case 'file_edit': return 'EDIT';
			case 'file_list': return 'FILES';
			case 'search': return 'SEARCH';
			case 'send_message': return 'MESSAGE';
			case 'lane_marker': return 'EVENT';
			case 'subagent': return 'AGENT';
			case 'scaffold_log': return 'LOG';
			default: return 'TOOL';
		}
	}
</script>

<!-- ===== COMPACT MODE ===== -->
{#if isCompact && category !== 'send_message' && category !== 'lane_marker'}
	<button
		type="button"
		class="tc-compact tc-compact-{category}"
		onclick={() => collapsed = !collapsed}
	>
		<span class="tc-compact-icon">{getCategoryIcon(category)}</span>
		<span class="tc-compact-fn">{toolCall.function}</span>
		<span class="tc-compact-args">{getCompactArgs(toolCall)}</span>
		{#if result}
			<span class="tc-compact-arrow">\u2192</span>
			<span class="tc-compact-result" class:error={!!result.error}>
				{getCompactResult(result)}
			</span>
		{/if}
	</button>
	{#if collapsed}
		<!-- Show full view when compact row is clicked -->
		<div class="tc-compact-expanded">
			{@render fullToolCall()}
		</div>
	{/if}

<!-- ===== LANE MARKER (checkpoint, end_audit) ===== -->
{:else if category === 'lane_marker'}
	<div class="tc-lane-marker">
		<div class="tc-lane-line"></div>
		<div class="tc-lane-badge">
			<span class="tc-lane-icon">{getCategoryIcon(category)}</span>
			<span class="tc-lane-label">{toolCall.function.replace(/_/g, ' ').toUpperCase()}</span>
			{#if markerLabel && markerLabel !== toolCall.function}
				<span class="tc-lane-detail">{markerLabel}</span>
			{/if}
		</div>
		<div class="tc-lane-line"></div>
	</div>

<!-- ===== SEND MESSAGE (visually prominent) ===== -->
{:else if category === 'send_message'}
	<div class="tc-send-message">
		<div class="tc-send-header">
			<span class="tc-send-badge">SENT TO TARGET</span>
			{#if toolCall.id}
				<span class="tc-send-id">ID: {toolCall.id}</span>
			{/if}
		</div>
		<div class="tc-send-body">
			{#if renderMarkdown}
				<HighlightedMarkdown {message} text={sentMessage} class="prose" {comments} {highlights} />
			{:else}
				<p class="text-pre-wrap"><HighlightedText {message} text={sentMessage} {comments} {highlights} /></p>
			{/if}
		</div>
	</div>

<!-- ===== FULL MODE (all other tools) ===== -->
{:else}
	{@render fullToolCall()}
{/if}

<!-- ===================================================================
     SNIPPETS
     =================================================================== -->

{#snippet fullToolCall()}
<div class="tc-full tc-cat-{category}">
	<div class="tc-grid">
		<div class="tc-col-toggle">
			<button
				type="button"
				class="tc-toggle-btn"
				aria-label="Toggle tool call"
				aria-expanded={!collapsed}
				onclick={(e) => { e.stopPropagation(); collapsed = !collapsed; }}
			>
				<svg class={`tc-caret ${collapsed ? 'rot-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
		</div>
		<div class="tc-col-content">
			<div class="tc-hdr">
				<span class="tc-badge tc-badge-{category}">{getCategoryLabel(category)}</span>
				<span class="tc-name">{toolCall.function}</span>
				{#if category === 'terminal' && terminalDescription}
					<span class="tc-description">{terminalDescription}</span>
				{/if}
				{#if category === 'file_read' || category === 'file_edit' || category === 'file_list'}
					<span class="tc-filepath">{filePath}</span>
				{/if}
				{#if category === 'search' && searchPattern}
					<span class="tc-search-pattern">/{searchPattern}/</span>
				{/if}
				{#if toolCall.id}
					<span class="tc-id">ID: {toolCall.id}</span>
				{/if}
			</div>
		</div>
		{#if !collapsed}
			<div class="tc-col-stick" aria-hidden="true"></div>
			<div class="tc-col-body">
				<!-- Tool-specific argument rendering -->
				{#if category === 'terminal'}
					{@render terminalBlock()}
				{:else if category === 'file_read'}
					<!-- file_read: just show path (already in header), nothing else needed for args -->
					{#if toolCall.arguments && Object.keys(toolCall.arguments).length > 1}
						<pre class="tc-pre tc-args-pre">{toYaml(Object.fromEntries(Object.entries(toolCall.arguments as any).filter(([k]) => k !== 'path' && k !== 'file_path')))}</pre>
					{/if}
				{:else if category === 'file_edit'}
					{@render fileEditBlock()}
				{:else if category === 'search'}
					{#if toolCall.arguments && Object.keys(toolCall.arguments).length > 1}
						<pre class="tc-pre tc-args-pre">{toYaml(Object.fromEntries(Object.entries(toolCall.arguments as any).filter(([k]) => k !== 'pattern' && k !== 'query')))}</pre>
					{/if}
				{:else if category === 'subagent'}
					{@render subagentBlock()}
				{:else if toolCall.view}
					{#if renderMarkdown}
						<HighlightedMarkdown {message} text={toolCall.view.content} class="prose" {comments} {highlights} />
					{:else}
						<p class="text-pre-wrap"><HighlightedText {message} text={toolCall.view.content} {comments} {highlights} /></p>
					{/if}
				{:else}
					<pre class="tc-pre tc-args-pre">{toYaml(toolCall.arguments)}</pre>
				{/if}

				<!-- Inline result -->
				{#if result}
					<div class="tc-result" class:tc-result-error={!!result.error}>
						<div class="tc-result-header">
							<span class="tc-result-badge" class:error={!!result.error}>
								{result.error ? 'ERROR' : 'OUTPUT'}
							</span>
							{#if result.error?.type}
								<span class="tc-result-error-type">{result.error.type}</span>
							{/if}
						</div>
						{@render resultBlock()}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
{/snippet}

{#snippet terminalBlock()}
	<div class="tc-terminal">
		<div class="tc-terminal-cmd">
			<span class="tc-terminal-prompt">$</span>
			<code class="tc-terminal-code">{terminalCommand}</code>
		</div>
	</div>
{/snippet}

{#snippet fileEditBlock()}
	{#if editDiff}
		{#if editDiff.type === 'diff'}
			<div class="tc-diff">
				{#each parseDiffLines(editDiff.content) as line}
					<div class="tc-diff-line tc-diff-{line.type}">
						<code>{line.text}</code>
					</div>
				{/each}
			</div>
		{:else}
			<div class="tc-replacement">
				<div class="tc-replacement-section tc-replacement-old">
					<span class="tc-replacement-label">OLD</span>
					<pre class="tc-pre">{editDiff.old_str}</pre>
				</div>
				<div class="tc-replacement-section tc-replacement-new">
					<span class="tc-replacement-label">NEW</span>
					<pre class="tc-pre">{editDiff.new_str}</pre>
				</div>
			</div>
		{/if}
	{:else}
		<pre class="tc-pre tc-args-pre">{toYaml(toolCall.arguments)}</pre>
	{/if}
{/snippet}

{#snippet subagentBlock()}
	<div class="tc-subagent">
		{#if subagentInfo}
			{#if subagentInfo.type}
				<span class="tc-subagent-type">{subagentInfo.type}</span>
			{/if}
			{#if subagentInfo.description}
				<div class="tc-subagent-desc">{subagentInfo.description}</div>
			{/if}
			{#if subagentInfo.prompt}
				<details class="tc-subagent-prompt-details">
					<summary>Prompt ({subagentInfo.prompt.length} chars)</summary>
					<pre class="tc-pre">{subagentInfo.prompt}</pre>
				</details>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet resultBlock()}
	{#if result}
		{#if result.error}
			<div class="tc-result-content tc-result-error-content">
				{#if result.error.message}
					<pre class="tc-pre tc-error-pre">{result.error.message}</pre>
				{/if}
				{#if resultContent}
					<pre class="tc-pre tc-error-pre">{visibleResultContent}</pre>
				{/if}
			</div>
		{:else if category === 'terminal'}
			<div class="tc-terminal-output">
				<pre class="tc-terminal-stdout">{visibleResultContent}</pre>
			</div>
		{:else if category === 'file_read'}
			<div class="tc-file-content">
				<pre class="tc-pre tc-code-pre">{visibleResultContent}</pre>
			</div>
		{:else if category === 'file_list'}
			<div class="tc-file-tree">
				<pre class="tc-pre tc-tree-pre">{visibleResultContent}</pre>
			</div>
		{:else if category === 'search'}
			<div class="tc-search-results">
				<pre class="tc-pre tc-code-pre">{visibleResultContent}</pre>
			</div>
		{:else}
			<div class="tc-result-content">
				<pre class="tc-pre">{visibleResultContent}</pre>
			</div>
		{/if}

		{#if isLongResult && !resultExpanded}
			<button
				type="button"
				class="tc-expand-btn"
				onclick={(e) => { e.stopPropagation(); resultExpanded = true; }}
			>
				Show {hiddenLineCount > 0 ? `${hiddenLineCount} more lines` : 'full output'}
				({resultContent.length.toLocaleString()} chars total)
			</button>
		{:else if isLongResult && resultExpanded}
			<button
				type="button"
				class="tc-expand-btn"
				onclick={(e) => { e.stopPropagation(); resultExpanded = false; }}
			>
				Collapse output
			</button>
		{/if}
	{/if}
{/snippet}

<style>
	/* =========================================================================
	   COMPACT MODE
	   ========================================================================= */
	.tc-compact {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.25rem 0.4rem;
		background: transparent;
		border: 1px solid var(--color-border-light);
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.78rem;
		line-height: 1.3;
		text-align: left;
		color: var(--color-text);
		overflow: hidden;
	}
	.tc-compact:hover {
		background: var(--color-bg-alt);
		border-color: var(--color-border);
	}
	.tc-compact-icon {
		flex-shrink: 0;
		font-size: 0.7rem;
		width: 1.2em;
		text-align: center;
	}
	.tc-compact-fn {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--color-text);
	}
	.tc-compact-args {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}
	.tc-compact-arrow {
		flex-shrink: 0;
		color: var(--color-text-light);
	}
	.tc-compact-result {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.tc-compact-result.error {
		color: var(--color-error);
	}
	.tc-compact-expanded {
		margin-top: 0.25rem;
	}

	/* =========================================================================
	   LANE MARKER (checkpoint, end_audit)
	   ========================================================================= */
	.tc-lane-marker {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0;
	}
	.tc-lane-line {
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}
	.tc-lane-badge {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.6rem;
		background: var(--color-bg-alt);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.tc-lane-icon {
		font-size: 0.7rem;
	}
	.tc-lane-label {
		letter-spacing: 0.03em;
	}
	.tc-lane-detail {
		color: var(--color-text-light);
		font-weight: 400;
	}

	/* =========================================================================
	   SEND MESSAGE (visually prominent)
	   ========================================================================= */
	.tc-send-message {
		border: 2px solid #22c55e;
		border-radius: 8px;
		overflow: hidden;
		margin: 0.2rem 0;
	}
	.tc-send-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.6rem;
		background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
		border-bottom: 1px solid #bbf7d0;
	}
	:global(.dark) .tc-send-header {
		background: linear-gradient(135deg, #14532d20 0%, #16a34a10 100%);
		border-bottom-color: #16a34a40;
	}
	.tc-send-badge {
		display: inline-block;
		background: #22c55e;
		color: #fff;
		border-radius: 999px;
		padding: 0 0.4rem;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.03em;
	}
	.tc-send-id {
		color: var(--color-text-light);
		font-size: 0.7rem;
		font-family: var(--font-mono);
	}
	.tc-send-body {
		padding: 0.5rem 0.6rem;
		background: var(--color-surface);
	}

	/* =========================================================================
	   FULL TOOL CALL (standard view)
	   ========================================================================= */
	.tc-full {
		margin: 0;
	}
	.tc-grid {
		display: grid;
		grid-template-columns: 16px 1fr;
		column-gap: 8px;
		row-gap: 0;
		align-items: start;
	}
	.tc-col-toggle {
		display: flex;
		align-items: start;
		justify-content: center;
	}
	.tc-toggle-btn {
		width: 16px;
		height: 16px;
		padding: 0;
		margin: 2px 0 0 0;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.tc-caret {
		width: 12px;
		height: 12px;
		transition: transform 0.12s ease;
	}
	.tc-caret.rot-90 { transform: rotate(-90deg); }
	.tc-col-stick {
		width: 1px;
		background: rgba(0, 0, 0, 0.12);
		justify-self: center;
		align-self: stretch;
	}
	:global(.dark) .tc-col-stick {
		background: rgba(255, 255, 255, 0.12);
	}
	.tc-col-content { min-width: 0; }
	.tc-col-body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.tc-col-body > :first-child { margin-top: 0 !important; }
	.tc-col-body > :last-child { margin-bottom: 0 !important; }

	/* Header */
	.tc-hdr {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		margin-bottom: 0.12rem;
		overflow-x: auto;
		overflow-y: hidden;
		white-space: nowrap;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.tc-hdr::-webkit-scrollbar { display: none; }
	.tc-hdr > * { white-space: nowrap; flex: 0 0 auto; }

	/* Badges by category */
	.tc-badge {
		display: inline-block;
		color: #fff;
		border-radius: 999px;
		padding: 0 0.35rem;
		font-size: 0.62rem;
		font-weight: 600;
	}
	.tc-badge-terminal { background: #374151; }
	.tc-badge-file_read { background: #0ea5e9; }
	.tc-badge-file_edit { background: #f59e0b; }
	.tc-badge-file_list { background: #8b5cf6; }
	.tc-badge-search { background: #ec4899; }
	.tc-badge-send_message { background: #22c55e; }
	.tc-badge-lane_marker { background: #6b7280; }
	.tc-badge-subagent { background: #6366f1; }
	.tc-badge-scaffold_log { background: #64748b; }
	.tc-badge-generic { background: #0ea5e9; }

	.tc-name { font-family: var(--font-mono); font-weight: 500; }
	.tc-filepath {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.tc-search-pattern {
		color: #ec4899;
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.tc-description {
		color: var(--color-text-light);
		font-size: 0.75rem;
		font-style: italic;
	}
	.tc-id {
		color: var(--color-text-light);
		font-size: 0.7rem;
		margin-left: 0.25rem;
	}

	/* =========================================================================
	   TERMINAL BLOCK
	   ========================================================================= */
	.tc-terminal {
		background: #1e1e1e;
		border-radius: 6px;
		overflow: hidden;
	}
	.tc-terminal-cmd {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.4rem 0.5rem;
	}
	.tc-terminal-prompt {
		color: #4ade80;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 700;
		flex-shrink: 0;
		user-select: none;
	}
	.tc-terminal-code {
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		white-space: pre-wrap;
		word-break: break-all;
		background: transparent;
		padding: 0;
	}
	.tc-terminal-output {
		border-top: 1px solid #333;
	}
	.tc-terminal-stdout {
		background: #1e1e1e;
		color: #cbd5e1;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		padding: 0.4rem 0.5rem;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: anywhere;
		border: 0;
		border-radius: 0 0 6px 6px;
	}

	/* =========================================================================
	   DIFF / FILE EDIT BLOCK
	   ========================================================================= */
	.tc-diff {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}
	.tc-diff-line {
		padding: 0 0.5rem;
		white-space: pre-wrap;
		word-break: break-all;
	}
	.tc-diff-add {
		background: #dcfce7;
		color: #166534;
	}
	:global(.dark) .tc-diff-add {
		background: #14532d30;
		color: #86efac;
	}
	.tc-diff-remove {
		background: #fee2e2;
		color: #991b1b;
	}
	:global(.dark) .tc-diff-remove {
		background: #7f1d1d30;
		color: #fca5a5;
	}
	.tc-diff-header {
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.tc-diff-context {
		background: transparent;
		color: var(--color-text-muted);
	}
	.tc-diff-line code {
		font-family: inherit;
		background: transparent;
		padding: 0;
		font-size: inherit;
	}

	/* Replacement (old_str / new_str) */
	.tc-replacement {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.tc-replacement-section {
		border-radius: 4px;
		overflow: hidden;
	}
	.tc-replacement-old {
		border: 1px solid #fecaca;
		background: #fef2f2;
	}
	:global(.dark) .tc-replacement-old {
		border-color: #7f1d1d50;
		background: #7f1d1d20;
	}
	.tc-replacement-new {
		border: 1px solid #bbf7d0;
		background: #f0fdf4;
	}
	:global(.dark) .tc-replacement-new {
		border-color: #14532d50;
		background: #14532d20;
	}
	.tc-replacement-label {
		display: inline-block;
		padding: 0 0.35rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		border-radius: 0 0 4px 0;
	}
	.tc-replacement-old .tc-replacement-label {
		background: #dc2626;
		color: #fff;
	}
	.tc-replacement-new .tc-replacement-label {
		background: #22c55e;
		color: #fff;
	}

	/* =========================================================================
	   SUBAGENT BLOCK
	   ========================================================================= */
	.tc-subagent {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.tc-subagent-type {
		display: inline-block;
		padding: 0 0.3rem;
		background: #6366f120;
		color: #6366f1;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		font-family: var(--font-mono);
		width: fit-content;
	}
	.tc-subagent-desc {
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--color-text);
	}
	.tc-subagent-prompt-details {
		font-size: 0.78rem;
	}
	.tc-subagent-prompt-details summary {
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	/* =========================================================================
	   RESULT BLOCK (inline paired results)
	   ========================================================================= */
	.tc-result {
		margin-top: 0.2rem;
		border-top: 1px solid var(--color-border-light);
		padding-top: 0.2rem;
	}
	.tc-result-error {
		border-top-color: var(--color-error-border);
	}
	.tc-result-header {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-bottom: 0.15rem;
	}
	.tc-result-badge {
		display: inline-block;
		background: #64748b;
		color: #fff;
		border-radius: 999px;
		padding: 0 0.3rem;
		font-size: 0.58rem;
		font-weight: 600;
	}
	.tc-result-badge.error {
		background: #dc2626;
	}
	.tc-result-error-type {
		color: #991b1b;
		font-family: var(--font-mono);
		font-size: 0.7rem;
	}

	/* =========================================================================
	   SHARED PRE / CODE STYLES
	   ========================================================================= */
	.tc-pre {
		background: transparent;
		padding: 0.2rem 0;
		border: 0;
		border-radius: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		margin: 0;
		color: var(--color-text);
	}
	.tc-code-pre {
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: 4px;
		padding: 0.3rem 0.4rem;
	}
	.tc-tree-pre {
		color: var(--color-text-muted);
	}
	.tc-error-pre {
		color: var(--color-error);
	}
	.tc-args-pre {
		color: var(--color-text-muted);
	}

	/* File content with subtle code-viewer feel */
	.tc-file-content {
		border-radius: 4px;
		overflow: hidden;
	}

	/* =========================================================================
	   EXPAND / COLLAPSE BUTTON
	   ========================================================================= */
	.tc-expand-btn {
		display: block;
		width: 100%;
		padding: 0.3rem 0.5rem;
		margin-top: 0.15rem;
		background: var(--color-bg-alt);
		border: 1px solid var(--color-border-light);
		border-radius: 4px;
		color: var(--color-accent);
		font-size: 0.72rem;
		font-weight: 500;
		cursor: pointer;
		text-align: center;
		transition: all 0.15s ease;
	}
	.tc-expand-btn:hover {
		background: var(--color-accent-bg);
		border-color: var(--color-accent);
	}
</style>
