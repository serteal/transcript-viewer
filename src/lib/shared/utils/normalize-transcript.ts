/**
 * Normalizes "v2" flat-format transcripts into the canonical Transcript shape
 * that the rest of the app expects (metadata + events + messages + target_messages).
 *
 * New format (v2):
 *   { id, title, auditor_model, target_model, seed_instruction, created_at, completed_at,
 *     judge: { scores, summary, highlights, ... },
 *     branches: [{ index, label, start_event_id, end_event_id, ... }],
 *     events: [{ id, branch, role, content, tool_calls?, reasoning?, ... }] }
 *
 * Old format (v3.0 / canonical):
 *   { metadata: { transcript_id, ... , judge_output }, events: TranscriptEvent[], messages: [], target_messages: [] }
 */

import type {
	Transcript,
	TranscriptMetadata,
	JudgeOutput,
	Citation,
	CitationPart,
	Event as OldEvent,
	TranscriptEvent,
	Message,
	Content,
	ContentText,
	ContentReasoning,
	ToolCall,
} from '../types';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Returns true if the raw JSON object uses the new flat format */
export function isNewFormat(data: any): boolean {
	if (!data || typeof data !== 'object') return false;
	// New format has top-level `branches` array and no `metadata` wrapper
	return Array.isArray(data.branches) && Array.isArray(data.events) && !data.metadata;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Convert a new-format transcript object in-place into the canonical shape */
export function normalizeTranscript(data: any): Transcript {
	const metadata = buildMetadata(data);
	const { events, messageIdByEventId } = buildEvents(data);

	// Patch highlight event_ids → message_ids, fix wrong refs, remove unmatched
	if (metadata.judge_output?.highlights) {
		metadata.judge_output.highlights = patchHighlights(
			metadata.judge_output.highlights,
			messageIdByEventId,
			data.events
		);
		// Re-index after filtering
		for (let i = 0; i < metadata.judge_output.highlights.length; i++) {
			metadata.judge_output.highlights[i].index = i + 1;
		}
	}

	// Enrich per-source summaries with citation references (only matched ones)
	if (metadata.judge_output?.summaries && metadata.judge_output.highlights) {
		metadata.judge_output.summaries = enrichSummariesWithCitations(
			metadata.judge_output.summaries,
			metadata.judge_output.highlights,
			data.judge?.highlights ?? []
		);
	}

	return {
		metadata,
		events,
		messages: [],         // legacy — UI reconstructs from events
		target_messages: [],  // legacy
	};
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function buildMetadata(data: any): TranscriptMetadata {
	const judge = data.judge;
	let judgeOutput: JudgeOutput | undefined;

	if (judge && typeof judge === 'object') {
		// Pick the best summary: use the merged `summary` field, else first entry in `summaries`
		let summary = judge.summary ?? '';
		if (!summary && judge.summaries && typeof judge.summaries === 'object') {
			const firstKey = Object.keys(judge.summaries)[0];
			if (firstKey) summary = judge.summaries[firstKey];
		}

		judgeOutput = {
			response: '',
			summary,
			scores: judge.scores ?? {},
			score_descriptions: judge.score_descriptions ?? undefined,
			// highlights are converted later (need event→message id map)
			highlights: (judge.highlights ?? []).map((h: any, i: number) => rawHighlightToCitation(h, i)),
			summaries: judge.summaries ?? undefined,
		};
	}

	return {
		transcript_id: data.id ?? '',
		auditor_model: data.auditor_model,
		target_model: data.target_model,
		created_at: data.created_at ?? new Date().toISOString(),
		updated_at: data.completed_at ?? data.created_at ?? new Date().toISOString(),
		version: 'v3.0',
		seed_instruction: data.seed_instruction,
		tags: data.tags,
		judge_output: judgeOutput,
		// Preserve fields the UI might write back
		user_comments: data.user_comments,
		user_highlights: data.user_highlights,
		summary_versions: data.summary_versions,
		active_summary_version: data.active_summary_version,
	};
}

// ---------------------------------------------------------------------------
// Highlights  (event_id + quoted_text + note  →  Citation)
// ---------------------------------------------------------------------------

function rawHighlightToCitation(h: any, index: number): Citation {
	const citation: Citation = {
		parts: [{
			message_id: h.event_id ?? '',  // placeholder — patched later
			quoted_text: h.quoted_text ?? '',
			position: null,
			tool_call_id: null,
			tool_arg: null,
		}],
		description: h.note ?? h.description ?? '',
		index: index + 1,  // 1-based, re-indexed after filtering
	};
	// Store source for enrichSummariesWithCitations (not part of Citation type)
	(citation as any)._source = h.source;
	return citation;
}

function patchHighlights(
	highlights: Citation[],
	messageIdByEventId: Map<string, string>,
	rawEvents?: any[]
): Citation[] {
	// Build content index for fallback search
	const contentByEventId = new Map<string, string>();
	if (rawEvents) {
		for (const ev of rawEvents) {
			if (ev.id && ev.content) contentByEventId.set(ev.id, ev.content);
		}
	}

	const normalizeWs = (s: string) => s.replace(/\s+/g, ' ');

	for (const h of highlights) {
		for (const part of h.parts) {
			const mapped = messageIdByEventId.get(part.message_id);
			if (mapped) part.message_id = mapped;

			// Verify the quoted_text exists in the referenced event's content
			// If not, search all events to find the correct one
			if (part.quoted_text && rawEvents) {
				const refContent = contentByEventId.get(part.message_id) ?? '';
				const normQuote = normalizeWs(part.quoted_text);
				const normRef = normalizeWs(refContent);
				if (!normRef.includes(normQuote)) {
					// Search all events for the quoted text
					let found = false;
					for (const ev of rawEvents) {
						if (!ev.content) continue;
						if (normalizeWs(ev.content).includes(normQuote)) {
							const correctId = messageIdByEventId.get(ev.id) ?? ev.id;
							part.message_id = correctId;
							found = true;
							break;
						}
					}
					if (!found) {
						// Mark as unmatched so we can filter it out
						(part as any)._unmatched = true;
					}
				}
			}
		}
	}

	// Remove highlights where all parts are unmatched
	return highlights.filter(h =>
		h.parts.some(p => !(p as any)._unmatched)
	);
}

// ---------------------------------------------------------------------------
// Events  (flat events → TranscriptEvent[] with add/reset edits)
// ---------------------------------------------------------------------------

interface BuildEventsResult {
	events: OldEvent[];
	messageIdByEventId: Map<string, string>;
}

function buildEvents(data: any): BuildEventsResult {
	const rawEvents: any[] = data.events ?? [];
	const branches: any[] = data.branches ?? [];
	const messageIdByEventId = new Map<string, string>();

	// Group raw events by branch index
	const byBranch = new Map<number, any[]>();
	for (const ev of rawEvents) {
		const b = ev.branch ?? 1;
		if (!byBranch.has(b)) byBranch.set(b, []);
		byBranch.get(b)!.push(ev);
	}

	// Sort branch keys to process in order
	const branchKeys = [...byBranch.keys()].sort((a, b) => a - b);

	const oldEvents: OldEvent[] = [];
	let eventCounter = 0;

	for (const branchIdx of branchKeys) {
		const branchEvents = byBranch.get(branchIdx)!;
		const branchMeta = branches.find((b: any) => b.index === branchIdx);
		const branchLabel = branchMeta?.label ?? `Branch ${branchIdx}`;

		for (let i = 0; i < branchEvents.length; i++) {
			const ev = branchEvents[i];
			const message = convertEventToMessage(ev, messageIdByEventId);
			const timestamp = deriveTimestamp(data, ev, eventCounter);

			if (i === 0) {
				// First message of a branch → reset (triggers new column in branching.ts)
				const te: TranscriptEvent = {
					type: 'transcript_event',
					id: ev.id ?? `synth-${eventCounter}`,
					timestamp,
					view: 'combined',
					edit: {
						operation: 'reset',
						new_messages: [message],
						name: branchLabel,
					} as any,
				};
				oldEvents.push(te);
			} else {
				// Subsequent messages → add
				const te: TranscriptEvent = {
					type: 'transcript_event',
					id: ev.id ?? `synth-${eventCounter}`,
					timestamp,
					view: 'combined',
					edit: {
						operation: 'add',
						message,
					} as any,
				};
				oldEvents.push(te);
			}
			eventCounter++;
		}
	}

	return { events: oldEvents, messageIdByEventId };
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function convertEventToMessage(
	ev: any,
	messageIdByEventId: Map<string, string>
): Message {
	const messageId = ev.id ?? crypto.randomUUID();
	if (ev.id) messageIdByEventId.set(ev.id, messageId);

	const role: string = ev.role ?? 'user';

	if (role === 'assistant') {
		return buildAssistantMessage(ev, messageId);
	}

	if (role === 'tool') {
		return {
			id: messageId,
			role: 'tool',
			content: ev.content ?? '',
			tool_call_id: ev.tool_call_id ?? null,
			function: ev.tool_name ?? null,
			error: ev.error ? { type: 'unknown', message: String(ev.error) } : null,
			source: 'generate',
		} as any;
	}

	// user / system / other
	return {
		id: messageId,
		role: role as any,
		content: ev.content ?? '',
		source: role === 'user' ? 'input' : 'generate',
	} as any;
}

function buildAssistantMessage(ev: any, messageId: string): Message {
	const contentParts: Content[] = [];

	// Reasoning (if present)
	if (ev.reasoning) {
		contentParts.push({
			type: 'reasoning',
			reasoning: ev.reasoning,
			redacted: false,
		} as ContentReasoning);
	} else if (ev.redacted_reasoning_chars && ev.redacted_reasoning_chars > 0) {
		contentParts.push({
			type: 'reasoning',
			reasoning: '',
			redacted: true,
			summary: `[${ev.redacted_reasoning_chars} characters of reasoning redacted]`,
		} as ContentReasoning);
	}

	// Text content
	if (ev.content) {
		contentParts.push({
			type: 'text',
			text: ev.content,
		} as ContentText);
	}

	// Tool calls → ToolCall[] for the message, plus ContentToolUse entries
	const toolCalls: ToolCall[] = [];
	if (Array.isArray(ev.tool_calls)) {
		for (const tc of ev.tool_calls) {
			toolCalls.push({
				id: tc.id ?? crypto.randomUUID(),
				function: tc.function ?? tc.name ?? 'unknown',
				arguments: tc.arguments ?? {},
				type: 'function',
			});
		}
	}

	// If there are content parts, use Content[]; otherwise fall back to plain string
	const content = contentParts.length > 0 ? contentParts : (ev.content ?? '');

	return {
		id: messageId,
		role: 'assistant',
		content,
		tool_calls: toolCalls.length > 0 ? toolCalls : null,
		source: 'generate',
	} as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Append "Key Evidence" citation references to each per-source summary.
 * Matches highlights to their source and adds [N] references.
 */
function enrichSummariesWithCitations(
	summaries: Record<string, string>,
	normalizedHighlights: Citation[],
	_rawHighlights: any[]
): Record<string, string> {
	// Build mapping: source → list of {index, description}
	const bySource = new Map<string, Array<{ index: number; description: string }>>();

	for (const citation of normalizedHighlights) {
		const source = (citation as any)._source;
		if (!source || !citation.index) continue;
		if (!bySource.has(source)) bySource.set(source, []);
		bySource.get(source)!.push({
			index: citation.index,
			description: citation.description || '',
		});
	}

	const enriched: Record<string, string> = {};
	for (const [source, text] of Object.entries(summaries)) {
		const refs = bySource.get(source);
		if (refs && refs.length > 0) {
			const citationLines = refs.map(r => `- [${r.index}] ${r.description}`).join('\n');
			enriched[source] = `${text}\n\n**Key Evidence:**\n${citationLines}`;
		} else {
			enriched[source] = text;
		}
	}
	return enriched;
}

function deriveTimestamp(data: any, ev: any, index: number): string {
	// Use event-level created_at if available
	if (ev.created_at) return ev.created_at;
	if (ev.timestamp) return ev.timestamp;

	// Fall back to transcript created_at + index offset
	const base = data.created_at ?? data.started_at;
	if (base) {
		const d = new Date(base);
		d.setSeconds(d.getSeconds() + index);
		return d.toISOString();
	}
	return new Date().toISOString();
}
