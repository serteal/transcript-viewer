import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { readFileSync, watchFile } from 'fs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SCRYPT_KEYLEN = 64;

/** Cookie name for the session ID */
export const SESSION_COOKIE = 'tv_session';

/** Max age in seconds, for the Set-Cookie header */
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_MAX_AGE_MS / 1000);

// ---------------------------------------------------------------------------
// Users file
// ---------------------------------------------------------------------------

/**
 * New format: { "user": { "hash": "salt:hex", "paths": ["*"] } }
 * Legacy format (auto-migrated on read): { "user": "salt:hex" }
 */
interface UserRecord {
	hash: string;
	/** Allowed transcript paths. ["*"] = full access. Otherwise list of filenames. */
	paths: string[];
}

let users: Record<string, UserRecord> = {};

const USERS_FILE = process.env.USERS_FILE || '/data/users.json';

function loadUsers(): void {
	try {
		const raw = readFileSync(USERS_FILE, 'utf-8');
		const parsed = JSON.parse(raw);
		users = {};
		for (const [name, value] of Object.entries(parsed)) {
			if (typeof value === 'string') {
				// Legacy format: plain hash string → full access
				users[name] = { hash: value, paths: ['*'] };
			} else if (value && typeof value === 'object' && 'hash' in value) {
				const v = value as any;
				users[name] = { hash: v.hash, paths: Array.isArray(v.paths) ? v.paths : ['*'] };
			}
		}
	} catch {
		users = {};
	}
}

loadUsers();

// Re-read users file on change (handles add/remove without restart)
try {
	watchFile(USERS_FILE, { interval: 2000 }, () => {
		console.log('[auth] users file changed, reloading');
		loadUsers();
	});
} catch {
	// file may not exist yet
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
	return `${salt}:${hash}`;
}

function verifyHash(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const inputHash = scryptSync(password, salt, SCRYPT_KEYLEN);
	const expectedHash = Buffer.from(hash, 'hex');
	if (inputHash.length !== expectedHash.length) return false;
	return timingSafeEqual(inputHash, expectedHash);
}

// ---------------------------------------------------------------------------
// Session store (in-memory — fine for single-container deployment)
// ---------------------------------------------------------------------------

interface Session {
	id: string;
	username: string;
	createdAt: number;
	expiresAt: number;
}

const sessions = new Map<string, Session>();

// Periodically clean expired sessions
setInterval(() => {
	const now = Date.now();
	for (const [id, session] of sessions) {
		if (session.expiresAt < now) sessions.delete(id);
	}
}, CLEANUP_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a username/password pair against the users file.
 */
export function verifyPassword(username: string, password: string): boolean {
	const user = users[username];
	if (!user) return false;
	return verifyHash(password, user.hash);
}

/**
 * Create a new session for a user and return the session ID.
 */
export function createSession(username: string): string {
	const id = randomBytes(32).toString('hex');
	const now = Date.now();
	sessions.set(id, {
		id,
		username,
		createdAt: now,
		expiresAt: now + SESSION_MAX_AGE_MS,
	});
	return id;
}

/**
 * Resolve a session ID to the username. Returns null if invalid/expired.
 */
export function getSessionUser(sessionId: string): string | null {
	const session = sessions.get(sessionId);
	if (!session) return null;
	if (session.expiresAt < Date.now()) {
		sessions.delete(sessionId);
		return null;
	}
	if (!(session.username in users)) {
		sessions.delete(sessionId);
		return null;
	}
	return session.username;
}

/**
 * Check if a session ID is valid (exists, not expired, user still exists).
 */
export function validateSession(sessionId: string): boolean {
	return getSessionUser(sessionId) !== null;
}

/**
 * Get allowed transcript paths for a user. Returns ["*"] for full access.
 */
export function getUserAllowedPaths(username: string): string[] {
	return users[username]?.paths ?? [];
}

/**
 * Check if a user can access a specific transcript path.
 * Deny-by-default: returns false unless explicitly allowed.
 */
export function canAccessTranscript(username: string, transcriptPath: string): boolean {
	const allowed = getUserAllowedPaths(username);
	if (allowed.includes('*')) return true;
	// Match against the filename (with or without leading directory components)
	const filename = transcriptPath.split('/').pop() ?? transcriptPath;
	return allowed.some(p => {
		const pFilename = p.split('/').pop() ?? p;
		return pFilename === filename || p === transcriptPath;
	});
}

/**
 * Delete a session (logout).
 */
export function deleteSession(sessionId: string): void {
	sessions.delete(sessionId);
}

/**
 * Check whether auth is enabled (users file has at least one user).
 */
export function isAuthEnabled(): boolean {
	return Object.keys(users).length > 0;
}
