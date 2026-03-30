import { randomBytes, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** Cookie name for the session ID */
export const SESSION_COOKIE = 'tv_session';

// ---------------------------------------------------------------------------
// Session store (in-memory — fine for single-container deployment)
// ---------------------------------------------------------------------------

interface Session {
	id: string;
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
 * Verify a password against AUTH_PASSWORD env var.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyPassword(input: string): boolean {
	const expected = process.env.AUTH_PASSWORD;
	if (!expected) {
		console.error('AUTH_PASSWORD environment variable is not set');
		return false;
	}

	const inputBuf = Buffer.from(input);
	const expectedBuf = Buffer.from(expected);

	if (inputBuf.length !== expectedBuf.length) return false;
	return timingSafeEqual(inputBuf, expectedBuf);
}

/**
 * Create a new session and return the session ID.
 */
export function createSession(): string {
	const id = randomBytes(32).toString('hex');
	const now = Date.now();
	sessions.set(id, {
		id,
		createdAt: now,
		expiresAt: now + SESSION_MAX_AGE_MS,
	});
	return id;
}

/**
 * Check if a session ID is valid (exists and not expired).
 */
export function validateSession(sessionId: string): boolean {
	const session = sessions.get(sessionId);
	if (!session) return false;
	if (session.expiresAt < Date.now()) {
		sessions.delete(sessionId);
		return false;
	}
	return true;
}

/**
 * Delete a session (logout).
 */
export function deleteSession(sessionId: string): void {
	sessions.delete(sessionId);
}

/**
 * Check whether auth is enabled (AUTH_PASSWORD is set).
 */
export function isAuthEnabled(): boolean {
	return !!process.env.AUTH_PASSWORD;
}

/** Max age in seconds, for the Set-Cookie header */
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_MAX_AGE_MS / 1000);
