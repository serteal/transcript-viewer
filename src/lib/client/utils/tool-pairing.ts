import type { MessageWithMetadata, ToolCall, ToolCallError } from '$lib/shared/types';

/**
 * Paired tool result — a tool response matched to its originating tool call.
 */
export interface PairedToolResult {
	toolCallId: string;
	content: string;
	error?: ToolCallError | null;
	function?: string | null;
	messageId?: string | null;
}

/**
 * Tool categories for specialized rendering.
 */
export type ToolCategory =
	| 'terminal'       // bash, Bash, observe, sandbox_exec
	| 'file_read'      // read_file, Read
	| 'file_edit'      // edit_file, Edit
	| 'file_list'      // list_files, Glob
	| 'search'         // grep_search, Grep
	| 'send_message'   // send_message
	| 'lane_marker'    // create_checkpoint, end_audit, end_conversation
	| 'subagent'       // Task, Agent
	| 'scaffold_log'   // get_scaffold_log
	| 'generic';       // everything else

const TERMINAL_TOOLS = new Set(['bash', 'Bash', 'observe', 'sandbox_exec']);
const FILE_READ_TOOLS = new Set(['read_file', 'Read']);
const FILE_EDIT_TOOLS = new Set(['edit_file', 'Edit']);
const FILE_LIST_TOOLS = new Set(['list_files', 'Glob']);
const SEARCH_TOOLS = new Set(['grep_search', 'Grep']);
const SEND_MESSAGE_TOOLS = new Set(['send_message']);
const LANE_MARKER_TOOLS = new Set(['create_checkpoint', 'end_audit', 'end_conversation']);
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);
const SCAFFOLD_LOG_TOOLS = new Set(['get_scaffold_log']);

/**
 * Classify a tool call into a rendering category.
 */
export function categorizeToolCall(tc: ToolCall): ToolCategory {
	const fn = tc.function;
	if (TERMINAL_TOOLS.has(fn)) return 'terminal';
	if (FILE_READ_TOOLS.has(fn)) return 'file_read';
	if (FILE_EDIT_TOOLS.has(fn)) return 'file_edit';
	if (FILE_LIST_TOOLS.has(fn)) return 'file_list';
	if (SEARCH_TOOLS.has(fn)) return 'search';
	if (SEND_MESSAGE_TOOLS.has(fn)) return 'send_message';
	if (LANE_MARKER_TOOLS.has(fn)) return 'lane_marker';
	if (SUBAGENT_TOOLS.has(fn)) return 'subagent';
	if (SCAFFOLD_LOG_TOOLS.has(fn)) return 'scaffold_log';
	return 'generic';
}

/**
 * Build a map from tool_call_id → PairedToolResult from a list of messages.
 */
export function buildToolResultMap(messages: MessageWithMetadata[]): Map<string, PairedToolResult> {
	const map = new Map<string, PairedToolResult>();
	for (const msg of messages) {
		if (msg.role === 'tool' && (msg as any).tool_call_id) {
			const toolMsg = msg as any;
			map.set(toolMsg.tool_call_id, {
				toolCallId: toolMsg.tool_call_id,
				content: typeof toolMsg.content === 'string'
					? toolMsg.content
					: JSON.stringify(toolMsg.content),
				error: toolMsg.error ?? null,
				function: toolMsg.function ?? null,
				messageId: toolMsg.id ?? null,
			});
		}
	}
	return map;
}

/**
 * Get the set of message IDs for tool result messages that have been paired
 * with a tool call (and should be hidden from the main feed).
 * Also hides relay user messages that duplicate send_message arguments.
 */
export function getConsumedToolMessageIds(messages: MessageWithMetadata[]): Set<string> {
	// Collect all tool_call IDs from assistant messages
	const toolCallIds = new Set<string>();
	for (const msg of messages) {
		if (msg.role === 'assistant' && (msg as any).tool_calls) {
			for (const tc of (msg as any).tool_calls) {
				if (tc.id) toolCallIds.add(tc.id);
			}
		}
	}

	// Find tool result messages that match those IDs
	const consumed = new Set<string>();
	for (const msg of messages) {
		if (msg.role === 'tool') {
			const toolMsg = msg as any;
			if (toolMsg.tool_call_id && toolCallIds.has(toolMsg.tool_call_id)) {
				const key = toolMsg.id ?? `toolresult:${toolMsg.tool_call_id}`;
				consumed.add(key);
			}
		}
	}

	// Detect relay user messages that duplicate send_message arguments.
	// Pattern: assistant msg has send_message(message=X), next user msg content === X
	for (let i = 0; i < messages.length - 1; i++) {
		const msg = messages[i];
		if (msg.role !== 'assistant') continue;
		const toolCalls = (msg as any).tool_calls;
		if (!toolCalls) continue;
		for (const tc of toolCalls) {
			if (tc.function !== 'send_message') continue;
			const sentText = tc.arguments?.message;
			if (typeof sentText !== 'string') continue;
			// Look ahead for matching user message (may skip tool results)
			for (let j = i + 1; j < Math.min(i + 5, messages.length); j++) {
				const next = messages[j];
				if (next.role === 'tool') continue; // skip tool results
				if (next.role === 'user') {
					const nextContent = typeof next.content === 'string'
						? next.content
						: null;
					if (nextContent && normalizeWhitespace(nextContent) === normalizeWhitespace(sentText)) {
						const key = (next as any).id ?? `relay:${j}`;
						consumed.add(key);
					}
				}
				break; // only check the first non-tool message
			}
		}
	}

	return consumed;
}

function normalizeWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

/**
 * Check if a message should be hidden from the feed (consumed tool result or relay duplicate).
 */
export function isConsumedMessage(msg: MessageWithMetadata, consumedIds: Set<string>, messageIndex?: number): boolean {
	const anyMsg = msg as any;
	// Check by message id first
	if (anyMsg.id && consumedIds.has(anyMsg.id)) return true;
	// Check tool results by tool_call_id
	if (msg.role === 'tool' && anyMsg.tool_call_id && consumedIds.has(`toolresult:${anyMsg.tool_call_id}`)) return true;
	// Check relay messages by index
	if (messageIndex !== undefined && consumedIds.has(`relay:${messageIndex}`)) return true;
	return false;
}

/**
 * Extract a one-line preview of tool call arguments for compact mode.
 */
export function getCompactArgs(tc: ToolCall): string {
	const args = tc.arguments;
	if (!args || typeof args !== 'object') return '';

	const category = categorizeToolCall(tc);
	switch (category) {
		case 'terminal': {
			const cmd = (args as any).command || (args as any).cmd || '';
			return typeof cmd === 'string' ? truncate(cmd, 80) : '';
		}
		case 'file_read': {
			const path = (args as any).path || (args as any).file_path || '';
			return typeof path === 'string' ? path : '';
		}
		case 'file_edit': {
			const path = (args as any).path || (args as any).file_path || '';
			return typeof path === 'string' ? path : '';
		}
		case 'file_list': {
			const path = (args as any).path || '.';
			return typeof path === 'string' ? path : '';
		}
		case 'search': {
			const pattern = (args as any).pattern || (args as any).query || '';
			return typeof pattern === 'string' ? truncate(pattern, 60) : '';
		}
		case 'send_message': {
			const message = (args as any).message || '';
			return typeof message === 'string' ? truncate(message, 80) : '';
		}
		case 'lane_marker': {
			const label = (args as any).label || '';
			return typeof label === 'string' ? label : '';
		}
		case 'subagent': {
			const desc = (args as any).description || '';
			return typeof desc === 'string' ? truncate(desc, 60) : '';
		}
		default: {
			const keys = Object.keys(args as any);
			if (keys.length === 0) return '';
			const firstKey = keys[0];
			const firstVal = (args as any)[firstKey];
			return truncate(`${firstKey}=${typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal)}`, 80);
		}
	}
}

/**
 * Extract a one-line preview of a tool result for compact mode.
 */
export function getCompactResult(result: PairedToolResult): string {
	if (result.error) return `ERROR: ${truncate(result.error.message, 60)}`;
	return truncate(result.content.replace(/\n/g, ' '), 80);
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

/**
 * Collect all unique tool function names from messages.
 */
export function collectToolFunctions(messages: MessageWithMetadata[]): string[] {
	const fns = new Set<string>();
	for (const msg of messages) {
		if (msg.role === 'assistant' && (msg as any).tool_calls) {
			for (const tc of (msg as any).tool_calls) {
				if (tc.function) fns.add(tc.function);
			}
		}
	}
	return Array.from(fns).sort();
}
