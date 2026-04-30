import {homedir} from 'node:os';
import path from 'node:path';
import {readFile, writeFile, mkdir, rename, chmod} from 'node:fs/promises';
import {randomBytes, randomUUID} from 'node:crypto';
import type {Device} from '@ryanair-cli/api';

const CONFIG_DIR = process.env['XDG_CONFIG_HOME']
	? path.join(process.env['XDG_CONFIG_HOME']!, 'ryanair-cli')
	: path.join(homedir(), '.config', 'ryanair-cli');

const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

export type Session = {
	customerId: string;
	authToken: string;
	rememberMeToken?: string;
	email: string;
};

export type Store = {
	device: Device;
	session?: Session;
};

function newDevice(): Device {
	return {
		fingerprint: randomBytes(20).toString('hex'),
		pushId: randomUUID(),
	};
}

export async function loadStore(): Promise<Store> {
	try {
		const raw = await readFile(SESSION_FILE, 'utf8');
		const parsed = JSON.parse(raw) as Partial<Store>;
		if (parsed?.device?.fingerprint && parsed.device.pushId) {
			return parsed as Store;
		}
	} catch {
		// fall through to fresh
	}

	const fresh: Store = {device: newDevice()};
	await saveStore(fresh);
	return fresh;
}

export async function saveStore(store: Store): Promise<void> {
	await mkdir(CONFIG_DIR, {recursive: true, mode: 0o700});
	const tmp = SESSION_FILE + '.tmp';
	await writeFile(tmp, JSON.stringify(store, null, 2), {mode: 0o600});
	await rename(tmp, SESSION_FILE);
	try {
		await chmod(SESSION_FILE, 0o600);
	} catch {
		// best-effort
	}
}

export function sessionFilePath(): string {
	return SESSION_FILE;
}
