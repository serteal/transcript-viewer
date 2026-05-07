/**
 * Transcript access control helpers.
 * Centralizes permission checks to avoid scattered logic.
 */

import { error } from '@sveltejs/kit';
import { canAccessTranscript, getUserAllowedPaths } from './auth';
import type { TranscriptTableData, TranscriptMetadata, FolderNode } from '$lib/shared/types';

/**
 * Assert that a user can access a transcript path.
 * Returns 404 (not 403) to avoid leaking existence of restricted transcripts.
 */
export function assertAccess(username: string | undefined, transcriptPath: string): void {
	if (!username) throw error(404, 'Not found');
	if (!canAccessTranscript(username, transcriptPath)) {
		throw error(404, 'Not found');
	}
}

/**
 * Filter transcript table data to only include transcripts the user can access.
 */
export function filterTranscripts(
	username: string | undefined,
	transcripts: TranscriptTableData[]
): TranscriptTableData[] {
	if (!username) return [];
	const allowed = getUserAllowedPaths(username);
	if (allowed.includes('*')) return transcripts;
	return transcripts.filter(t => canAccessTranscript(username, t._filePath));
}

/**
 * Filter metadata array to only include transcripts the user can access.
 */
export function filterMetadata(
	username: string | undefined,
	metadata: TranscriptMetadata[]
): TranscriptMetadata[] {
	if (!username) return [];
	const allowed = getUserAllowedPaths(username);
	if (allowed.includes('*')) return metadata;
	return metadata.filter(m => canAccessTranscript(username, m._filePath ?? ''));
}

/**
 * Filter folder tree to remove nodes the user can't access.
 */
export function filterFolderTree(
	username: string | undefined,
	tree: FolderNode[]
): FolderNode[] {
	if (!username) return [];
	const allowed = getUserAllowedPaths(username);
	if (allowed.includes('*')) return tree;

	function filterNode(node: FolderNode): FolderNode | null {
		if (node.type === 'file') {
			return canAccessTranscript(username!, node.path) ? node : null;
		}
		// Folder: recurse and keep if any children survive
		const filteredChildren = (node.children ?? [])
			.map(filterNode)
			.filter((n): n is FolderNode => n !== null);
		if (filteredChildren.length === 0) return null;
		return { ...node, children: filteredChildren };
	}

	return tree.map(filterNode).filter((n): n is FolderNode => n !== null);
}
