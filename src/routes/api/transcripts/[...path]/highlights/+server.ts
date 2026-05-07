/**
 * API endpoint for transcript highlights
 * POST /api/transcripts/[...path]/highlights - Add a highlight
 * DELETE /api/transcripts/[...path]/highlights - Remove a highlight by ID
 */

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { join } from 'node:path';
import { getGlobalConfig } from '$lib/server/config/app-config';
import { getGlobalCache } from '$lib/server/cache/transcript-cache';
import { extractMetadata } from '$lib/shared/utils/transcript-utils';
import { openTranscriptFile } from '$lib/server/loaders/transcript-file-io';
import { validateLenient } from '$lib/shared/validation/transcript-validator';
import { assertAccess } from '$lib/server/access';
import type { UserHighlight } from '$lib/shared/types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	try {
		const config = getGlobalConfig();
		const filePath = params.path;

		if (!filePath) {
			throw error(400, 'File path is required');
		}

		// Decode and validate the file path
		const decodedPath = decodeURIComponent(filePath);

		// Security check
		if (decodedPath.includes('..') || decodedPath.startsWith('/')) {
			throw error(400, 'Invalid file path');
		}

		// Access control
		assertAccess(locals.username, decodedPath);

		const fullPath = join(config.transcriptRootDir, decodedPath);

		// Parse request body
		const { message_id, quoted_text, position, description, author } = await request.json();

		if (!message_id || !quoted_text || !description) {
			throw error(400, 'message_id, quoted_text, and description are required');
		}

		// Read current transcript (format-aware)
		const file = await openTranscriptFile(fullPath);

		// Initialize highlights array if needed
		if (!file.get('user_highlights')) {
			file.set('user_highlights', []);
		}

		// Create new highlight
		const newHighlight: UserHighlight = {
			id: crypto.randomUUID(),
			message_id,
			quoted_text,
			position: position || undefined,
			description,
			author: author || undefined,
			created_at: new Date().toISOString()
		};

		file.get('user_highlights').push(newHighlight);

		// Write back to disk
		await file.save(fullPath);

		// Update cache
		const cache = getGlobalCache({
			fullTranscriptCacheSize: config.cache.fullTranscriptCacheSize,
			enableWatching: config.cache.enableWatching,
			watchDirectory: config.transcriptRootDir
		});
		const normalized = validateLenient(file.raw, decodedPath);
		const updatedMetadata = extractMetadata(normalized, decodedPath);
		cache.updateTranscriptMetadata(updatedMetadata);
		cache.invalidateFullTranscript(decodedPath);

		return json({ success: true, highlight: newHighlight });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		console.error('❌ Highlight POST error:', err);
		throw error(500, 'Failed to add highlight: ' + (err instanceof Error ? err.message : 'Unknown error'));
	}
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	try {
		const config = getGlobalConfig();
		const filePath = params.path;

		if (!filePath) {
			throw error(400, 'File path is required');
		}

		const decodedPath = decodeURIComponent(filePath);

		if (decodedPath.includes('..') || decodedPath.startsWith('/')) {
			throw error(400, 'Invalid file path');
		}

		assertAccess(locals.username, decodedPath);

		const fullPath = join(config.transcriptRootDir, decodedPath);

		// Parse request body
		const { highlight_id } = await request.json();

		if (!highlight_id) {
			throw error(400, 'highlight_id is required');
		}

		// Read current transcript (format-aware)
		const file = await openTranscriptFile(fullPath);

		// Find and remove highlight
		const highlights = file.get('user_highlights');
		if (!highlights) {
			throw error(404, 'Highlight not found');
		}

		const initialLength = highlights.length;
		const filtered = highlights.filter((h: UserHighlight) => h.id !== highlight_id);

		if (filtered.length === initialLength) {
			throw error(404, 'Highlight not found');
		}

		file.set('user_highlights', filtered);

		// Write back to disk
		await file.save(fullPath);

		// Update cache
		const cache = getGlobalCache({
			fullTranscriptCacheSize: config.cache.fullTranscriptCacheSize,
			enableWatching: config.cache.enableWatching,
			watchDirectory: config.transcriptRootDir
		});
		const normalized = validateLenient(file.raw, decodedPath);
		const updatedMetadata = extractMetadata(normalized, decodedPath);
		cache.updateTranscriptMetadata(updatedMetadata);
		cache.invalidateFullTranscript(decodedPath);

		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		console.error('❌ Highlight DELETE error:', err);
		throw error(500, 'Failed to delete highlight: ' + (err instanceof Error ? err.message : 'Unknown error'));
	}
};
