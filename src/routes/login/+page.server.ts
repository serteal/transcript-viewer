import type { Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import {
	verifyPassword,
	createSession,
	isAuthEnabled,
	SESSION_COOKIE,
	SESSION_MAX_AGE_SECONDS,
} from '$lib/server/auth';

export function load() {
	// If auth is not enabled, redirect to home
	if (!isAuthEnabled()) {
		throw redirect(303, '/');
	}
}

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		if (!isAuthEnabled()) {
			throw redirect(303, '/');
		}

		const data = await request.formData();
		const password = data.get('password');

		if (typeof password !== 'string' || !password) {
			return fail(400, { error: 'Password is required' });
		}

		if (!verifyPassword(password)) {
			return fail(401, { error: 'Invalid password' });
		}

		// Create session and set cookie
		const sessionId = createSession();
		cookies.set(SESSION_COOKIE, sessionId, {
			path: '/',
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE_SECONDS,
		});

		throw redirect(303, '/');
	},
};
