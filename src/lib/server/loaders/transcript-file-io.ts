/**
 * Helpers for reading/writing user data (comments, highlights, summary versions)
 * to transcript files in either old or new format.
 *
 * New-format files store user data at the top level.
 * Old-format files store it under `metadata`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { isNewFormat } from '$lib/shared/utils/normalize-transcript';

export interface TranscriptFileHandle {
	raw: any;
	/** Read a user-data field (e.g. 'user_comments') */
	get(field: string): any;
	/** Set a user-data field */
	set(field: string, value: any): void;
	/** Write back to disk */
	save(path: string): Promise<void>;
}

export async function openTranscriptFile(path: string): Promise<TranscriptFileHandle> {
	const content = await readFile(path, 'utf-8');
	const raw = JSON.parse(content);
	const newFmt = isNewFormat(raw);

	return {
		raw,
		get(field: string): any {
			if (newFmt) return raw[field];
			return raw.metadata?.[field];
		},
		set(field: string, value: any): void {
			if (newFmt) {
				raw[field] = value;
			} else {
				if (!raw.metadata) raw.metadata = {};
				raw.metadata[field] = value;
			}
		},
		async save(path: string): Promise<void> {
			await writeFile(path, JSON.stringify(raw, null, 2));
		},
	};
}
