/**
 * API endpoint for transcript comments
 * POST /api/transcripts/[...path]/comments - Add a comment
 * PATCH /api/transcripts/[...path]/comments - Mark comment as read (add user to viewed_by)
 * DELETE /api/transcripts/[...path]/comments - Remove a comment by ID
 */

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { join } from 'node:path';
import { getGlobalConfig } from '$lib/server/config/app-config';
import { getGlobalCache } from '$lib/server/cache/transcript-cache';
import { extractMetadata } from '$lib/shared/utils/transcript-utils';
import { openTranscriptFile } from '$lib/server/loaders/transcript-file-io';
import { validateLenient } from '$lib/shared/validation/transcript-validator';
import { assertAccess } from '$lib/server/access';
import type { UserComment } from '$lib/shared/types';

function getCache() {
	const config = getGlobalConfig();
	return getGlobalCache({
		fullTranscriptCacheSize: config.cache.fullTranscriptCacheSize,
		enableWatching: config.cache.enableWatching,
		watchDirectory: config.transcriptRootDir
	});
}

function validatePath(filePath: string | undefined) {
	if (!filePath) throw error(400, 'File path is required');
	const decoded = decodeURIComponent(filePath);
	if (decoded.includes('..') || decoded.startsWith('/')) throw error(400, 'Invalid file path');
	return decoded;
}

async function updateCache(file: any, decodedPath: string) {
	const cache = getCache();
	const normalized = validateLenient(file.raw, decodedPath);
	const updatedMetadata = extractMetadata(normalized, decodedPath);
	cache.updateTranscriptMetadata(updatedMetadata);
	cache.invalidateFullTranscript(decodedPath);
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	try {
		const config = getGlobalConfig();
		const decodedPath = validatePath(params.path);
		assertAccess(locals.username, decodedPath);
		const fullPath = join(config.transcriptRootDir, decodedPath);

		const { message_id, text, author, quoted_text, parent_id } = await request.json();

		if (!message_id || !text) {
			throw error(400, 'message_id and text are required');
		}

		const file = await openTranscriptFile(fullPath);

		if (!file.get('user_comments')) {
			file.set('user_comments', []);
		}

		const newComment: UserComment = {
			id: crypto.randomUUID(),
			message_id,
			text,
			quoted_text: quoted_text || undefined,
			author: author || undefined,
			created_at: new Date().toISOString(),
			viewed_by: author ? [author] : [],
			parent_id: parent_id || undefined
		};

		file.get('user_comments').push(newComment);
		await file.save(fullPath);
		await updateCache(file, decodedPath);

		return json({ success: true, comment: newComment });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('❌ Comment POST error:', err);
		throw error(500, 'Failed to add comment: ' + (err instanceof Error ? err.message : 'Unknown error'));
	}
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	try {
		const config = getGlobalConfig();
		const decodedPath = validatePath(params.path);
		assertAccess(locals.username, decodedPath);
		const fullPath = join(config.transcriptRootDir, decodedPath);

		const { comment_id, username } = await request.json();

		if (!comment_id || !username) {
			throw error(400, 'comment_id and username are required');
		}

		const file = await openTranscriptFile(fullPath);

		const comments = file.get('user_comments');
		if (!comments) throw error(404, 'Comment not found');

		const comment = comments.find((c: UserComment) => c.id === comment_id);
		if (!comment) throw error(404, 'Comment not found');

		if (!comment.viewed_by) comment.viewed_by = [];

		if (!comment.viewed_by.includes(username)) {
			comment.viewed_by.push(username);
			await file.save(fullPath);
			await updateCache(file, decodedPath);
		}

		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('❌ Comment PATCH error:', err);
		throw error(500, 'Failed to mark comment as read: ' + (err instanceof Error ? err.message : 'Unknown error'));
	}
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	try {
		const config = getGlobalConfig();
		const decodedPath = validatePath(params.path);
		assertAccess(locals.username, decodedPath);
		const fullPath = join(config.transcriptRootDir, decodedPath);

		const { comment_id } = await request.json();

		if (!comment_id) {
			throw error(400, 'comment_id is required');
		}

		const file = await openTranscriptFile(fullPath);

		const comments = file.get('user_comments');
		if (!comments) throw error(404, 'Comment not found');

		const initialLength = comments.length;
		const filtered = comments.filter((c: UserComment) => c.id !== comment_id);

		if (filtered.length === initialLength) throw error(404, 'Comment not found');

		file.set('user_comments', filtered);
		await file.save(fullPath);
		await updateCache(file, decodedPath);

		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('❌ Comment DELETE error:', err);
		throw error(500, 'Failed to delete comment: ' + (err instanceof Error ? err.message : 'Unknown error'));
	}
};
