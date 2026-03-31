<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Login — Transcript Viewer</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="login-page">
	<div class="login-card">
		<h1 class="login-title">Transcript Viewer</h1>
		<p class="login-subtitle">Sign in to continue.</p>

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			{#if form?.error}
				<div class="login-error">{form.error}</div>
			{/if}

			<label class="login-label" for="username">Username</label>
			<input
				id="username"
				name="username"
				type="text"
				class="login-input"
				autocomplete="username"
				autofocus
				required
				disabled={submitting}
			/>

			<label class="login-label password-label" for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				class="login-input"
				autocomplete="current-password"
				required
				disabled={submitting}
			/>

			<button type="submit" class="login-btn" disabled={submitting}>
				{submitting ? 'Signing in\u2026' : 'Sign in'}
			</button>
		</form>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg, #FAF7F2);
		padding: 1rem;
	}

	.login-card {
		width: 100%;
		max-width: 380px;
		background: var(--color-surface, #fff);
		border: 1px solid var(--color-border, #E8E0D5);
		border-radius: 12px;
		padding: 2rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
	}

	.login-title {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--color-text, #3D3328);
		margin: 0 0 0.25rem 0;
	}

	.login-subtitle {
		font-size: 0.85rem;
		color: var(--color-text-muted, #8B7E6A);
		margin: 0 0 1.5rem 0;
	}

	.login-error {
		background: var(--color-error-bg, #FDF0F0);
		border: 1px solid var(--color-error-border, #E8B4B5);
		color: var(--color-error, #BC4749);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		font-size: 0.82rem;
		margin-bottom: 1rem;
	}

	.login-label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text, #3D3328);
		margin-bottom: 0.35rem;
	}

	.login-label.password-label {
		margin-top: 0.75rem;
	}

	.login-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		font-size: 0.9rem;
		border: 1px solid var(--color-border, #E8E0D5);
		border-radius: 6px;
		background: var(--color-bg, #FAF7F2);
		color: var(--color-text, #3D3328);
		box-sizing: border-box;
		outline: none;
		transition: border-color 0.15s;
	}

	.login-input:focus {
		border-color: var(--color-accent, #9C6644);
		box-shadow: 0 0 0 2px rgba(156, 102, 68, 0.15);
	}

	.login-btn {
		width: 100%;
		margin-top: 1rem;
		padding: 0.6rem;
		font-size: 0.9rem;
		font-weight: 600;
		border: none;
		border-radius: 6px;
		background: var(--color-accent, #9C6644);
		color: #fff;
		cursor: pointer;
		transition: background 0.15s;
	}

	.login-btn:hover:not(:disabled) {
		background: var(--color-accent-hover, #7D5236);
	}

	.login-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
