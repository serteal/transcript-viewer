/**
 * API endpoint for listing transcript metadata
 * GET /api/transcripts - Returns all transcript metadata and folder tree
 * Query params:
 * - path: optional subdirectory path to scan
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { loadTranscriptMetadata, hasTranscriptMetadataChanged } from '$lib/server/services/transcript-metadata-service';
import { filterTranscripts, filterFolderTree } from '$lib/server/access';

export const GET: RequestHandler = async ({ url, request, locals }) => {
	try {
		const subPath = url.searchParams.get('path') || '';
		
		// Check for conditional requests (caching)
		const ifNoneMatch = request.headers.get('if-none-match');
		if (!hasTranscriptMetadataChanged(ifNoneMatch || undefined)) {
			return new Response(null, { status: 304 });
		}

		// Load transcript metadata with ETag support
		const { data, etag } = await loadTranscriptMetadata({ 
			subPath: subPath || undefined,
			includeETag: true 
		});
		
		// Filter by user's allowed paths
		data.transcripts = filterTranscripts(locals.username, data.transcripts);
		data.folderTree = filterFolderTree(locals.username, data.folderTree);
		data.count = data.transcripts.length;

		// Remove currentPath from API response (only needed for SSR)
		const { currentPath, ...response } = data;
		
		return json(response, {
			headers: {
				'ETag': etag || '',
				'Cache-Control': 'public, max-age=60'
			}
		});
		
	} catch (error) {
		console.error('❌ API error:', error);
		return json({ 
			error: 'Failed to load transcripts',
			details: error instanceof Error ? error.message : 'Unknown error'
		}, { 
			status: 500 
		});
	}
};
