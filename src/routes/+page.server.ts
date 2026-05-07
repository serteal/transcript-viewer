/**
 * Server-side load function for the home page
 * Following SvelteKit best practices from https://svelte.dev/docs/kit/load
 * 
 * Using +page.server.ts instead of client-side fetching for:
 * - Better SSR and SEO
 * - Access to server-only modules  
 * - Proper caching and cache invalidation
 * - Security (no API keys exposed to client)
 */

import type { PageServerLoad } from './$types';
import { loadTranscriptMetadata } from '$lib/server/services/transcript-metadata-service';
import { filterTranscripts, filterFolderTree } from '$lib/server/access';

export const load: PageServerLoad = async ({ url, depends, locals }) => {
	// Declare dependency for cache invalidation
	depends('app:transcripts');

	const subPath = url.searchParams.get('path') || '';

	try {
		const { data } = await loadTranscriptMetadata({ subPath });

		// Filter by user's allowed paths
		data.transcripts = filterTranscripts(locals.username, data.transcripts);
		data.folderTree = filterFolderTree(locals.username, data.folderTree);
		data.count = data.transcripts.length;

		return data;
		
	} catch (error) {
		console.error('❌ [SSR] Load error:', error);
		
		return {
			transcripts: [],
			folderTree: [],
			errors: [error instanceof Error ? error.message : 'Unknown error loading transcripts'],
			count: 0,
			timestamp: new Date().toISOString(),
			currentPath: subPath
		};
	}
};
