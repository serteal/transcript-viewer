import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { validateSession, isAuthEnabled, SESSION_COOKIE } from '$lib/server/auth';

/** Paths that are always accessible (no auth required) */
const PUBLIC_PATHS = () => [`${base}/login`];

/** Prefixes that are always accessible (SvelteKit internals, static assets) */
const PUBLIC_PREFIXES = () => [
	`${base}/_app/`,     // SvelteKit generated JS/CSS bundles
	`${base}/favicon`,   // favicon
];

export const handle: Handle = async ({ event, resolve }) => {
	// If auth is not configured, skip all checks
	if (!isAuthEnabled()) {
		return resolve(event);
	}

	const { pathname } = event.url;

	// Allow public paths
	if (PUBLIC_PATHS().includes(pathname)) {
		return resolve(event);
	}

	// Allow public prefixes (static assets needed for login page to render)
	if (PUBLIC_PREFIXES().some(p => pathname.startsWith(p))) {
		return resolve(event);
	}

	// Check for valid session
	const sessionId = event.cookies.get(SESSION_COOKIE);
	if (!sessionId || !validateSession(sessionId)) {
		// API routes get 401
		if (pathname.startsWith(`${base}/api/`)) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		// Everything else redirects to login
		throw redirect(303, `${base}/login`);
	}

	// Resolve the request
	const response = await resolve(event);

	// Add anti-scraping headers to all authenticated responses
	response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('Cache-Control', 'private, no-store');

	return response;
};
