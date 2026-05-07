#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { randomBytes, scryptSync } from 'crypto';

const KEYLEN = 64;
const USERS_FILE = process.env.USERS_FILE || './users.json';

function load() {
	try {
		const raw = JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
		// Normalize: migrate legacy "user": "hash" to new format
		const users = {};
		for (const [name, value] of Object.entries(raw)) {
			if (typeof value === 'string') {
				users[name] = { hash: value, paths: ['*'] };
			} else {
				users[name] = value;
			}
		}
		return users;
	} catch {
		return {};
	}
}

function save(users) {
	writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + '\n');
}

function hashPassword(password) {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, KEYLEN).toString('hex');
	return `${salt}:${hash}`;
}

/** Parse --paths flag from args: --paths "file1.json,file2.json" or --paths "*" */
function parsePaths(args) {
	const idx = args.indexOf('--paths');
	if (idx === -1) return ['*'];
	const val = args[idx + 1];
	if (!val) {
		console.error('--paths requires a value (comma-separated filenames, or "*" for full access)');
		process.exit(1);
	}
	if (val === '*') return ['*'];
	return val.split(',').map(p => p.trim()).filter(Boolean);
}

const [, , command, ...args] = process.argv;

switch (command) {
	case 'add': {
		const positional = args.filter(a => !a.startsWith('--') && (args.indexOf(a) === 0 || !args[args.indexOf(a) - 1]?.startsWith('--')));
		// Simpler: first two non-flag args
		const nonFlags = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--paths') { i++; continue; }
			if (args[i].startsWith('--')) continue;
			nonFlags.push(args[i]);
		}
		const [username, password] = nonFlags;
		if (!username || !password) {
			console.error('Usage: manage-users.mjs add <username> <password> [--paths "file1.json,file2.json"]');
			process.exit(1);
		}
		const paths = parsePaths(args);
		const users = load();
		users[username] = { hash: hashPassword(password), paths };
		save(users);
		const access = paths.includes('*') ? 'full access' : `access to ${paths.length} transcript(s)`;
		console.log(`Added user "${username}" (${access})`);
		break;
	}
	case 'remove': {
		const [username] = args;
		if (!username) {
			console.error('Usage: manage-users.mjs remove <username>');
			process.exit(1);
		}
		const users = load();
		if (!(username in users)) {
			console.error(`User "${username}" not found`);
			process.exit(1);
		}
		delete users[username];
		save(users);
		console.log(`Removed user "${username}" (their active sessions are now invalid)`);
		break;
	}
	case 'list': {
		const users = load();
		const names = Object.keys(users);
		if (names.length === 0) {
			console.log('No users configured');
		} else {
			console.log(`Users (${names.length}):`);
			for (const name of names) {
				const u = users[name];
				const paths = u.paths || ['*'];
				const access = paths.includes('*') ? 'full access' : `${paths.length} transcript(s)`;
				console.log(`  - ${name} (${access})`);
			}
		}
		break;
	}
	case 'show': {
		const [username] = args;
		if (!username) {
			console.error('Usage: manage-users.mjs show <username>');
			process.exit(1);
		}
		const users = load();
		if (!(username in users)) {
			console.error(`User "${username}" not found`);
			process.exit(1);
		}
		const u = users[username];
		const paths = u.paths || ['*'];
		console.log(`User: ${username}`);
		if (paths.includes('*')) {
			console.log('  Access: full (all transcripts)');
		} else {
			console.log(`  Access: ${paths.length} transcript(s)`);
			for (const p of paths) {
				console.log(`    - ${p}`);
			}
		}
		break;
	}
	case 'passwd': {
		const nonFlags = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--paths') { i++; continue; }
			if (args[i].startsWith('--')) continue;
			nonFlags.push(args[i]);
		}
		const [username, password] = nonFlags;
		if (!username || !password) {
			console.error('Usage: manage-users.mjs passwd <username> <password>');
			process.exit(1);
		}
		const users = load();
		if (!(username in users)) {
			console.error(`User "${username}" not found`);
			process.exit(1);
		}
		users[username].hash = hashPassword(password);
		save(users);
		console.log(`Updated password for "${username}"`);
		break;
	}
	case 'set-paths': {
		const [username] = args.filter(a => !a.startsWith('--'));
		if (!username) {
			console.error('Usage: manage-users.mjs set-paths <username> --paths "file1.json,file2.json"');
			process.exit(1);
		}
		const paths = parsePaths(args);
		const users = load();
		if (!(username in users)) {
			console.error(`User "${username}" not found`);
			process.exit(1);
		}
		users[username].paths = paths;
		save(users);
		const access = paths.includes('*') ? 'full access' : `access to ${paths.length} transcript(s)`;
		console.log(`Updated paths for "${username}" (${access})`);
		break;
	}
	default:
		console.log(`Usage: manage-users.mjs <command> [args]

Commands:
  add <username> <password> [--paths "f1.json,f2.json"]   Add a new user
  remove <username>                                        Remove a user
  passwd <username> <password>                             Change password
  set-paths <username> --paths "f1.json,f2.json"           Set allowed transcripts
  show <username>                                          Show user details
  list                                                     List all users

Paths: comma-separated filenames, or "*" for full access (default).`);
		if (command) process.exit(1);
}
