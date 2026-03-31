#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { randomBytes, scryptSync } from 'crypto';

const KEYLEN = 64;
const USERS_FILE = process.env.USERS_FILE || './users.json';

function load() {
	try {
		return JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
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

const [, , command, ...args] = process.argv;

switch (command) {
	case 'add': {
		const [username, password] = args;
		if (!username || !password) {
			console.error('Usage: manage-users.mjs add <username> <password>');
			process.exit(1);
		}
		const users = load();
		users[username] = hashPassword(password);
		save(users);
		console.log(`Added user "${username}"`);
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
				console.log(`  - ${name}`);
			}
		}
		break;
	}
	case 'passwd': {
		const [username, password] = args;
		if (!username || !password) {
			console.error('Usage: manage-users.mjs passwd <username> <password>');
			process.exit(1);
		}
		const users = load();
		if (!(username in users)) {
			console.error(`User "${username}" not found`);
			process.exit(1);
		}
		users[username] = hashPassword(password);
		save(users);
		console.log(`Updated password for "${username}"`);
		break;
	}
	default:
		console.log(`Usage: manage-users.mjs <command> [args]

Commands:
  add <username> <password>     Add a new user
  remove <username>             Remove a user (invalidates their sessions)
  passwd <username> <password>  Change a user's password
  list                          List all users`);
		if (command) process.exit(1);
}
