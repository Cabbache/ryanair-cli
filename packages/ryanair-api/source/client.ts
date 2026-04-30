import type {Device} from './types.js';

export const APP_VERSION = '3.228.0';
export const CLIENT_OS = '30';
export const CARRIER_CODE = 'FR';
export const DEFAULT_MARKET = 'en-GB';

export const HOSTS = {
	usrprof: 'https://services-api.ryanair.com',
	mntappdb: 'https://mntappdb.ryanair.com',
	mntappbp: 'https://mntappbp.ryanair.com',
} as const;

/**
 * A structured event the library emits so consumers can decide what to do
 * with it (write to stderr, send to a log aggregator, surface in a UI…).
 *
 * - `request` / `response`: every HTTP round-trip. Verbose; usually only
 *   wanted under a `--debug` flag.
 * - `unexpected`: the library got a response it can't classify (probably
 *   means the API changed). Should be surfaced even without debug mode.
 */
export type LogEvent =
	| {
			kind: 'request';
			method: string;
			url: string;
			headers: Record<string, string>;
			body?: unknown;
	  }
	| {
			kind: 'response';
			method: string;
			url: string;
			status: number;
			ok: boolean;
			headers: Record<string, string>;
			body?: unknown;
	  }
	| {
			kind: 'unexpected';
			operation: string;
			reason: string;
			httpStatus?: number;
			responseBody?: unknown;
			details?: unknown;
	  };

export type Logger = (event: LogEvent) => void;

export type ClientOptions = {
	device: Device;
	authToken?: string;
	market?: string;
	sessionToken?: string;
	/** Override fetch (for tests / non-browser runtimes). */
	fetchImpl?: typeof fetch;
	logger?: Logger;
};

/**
 * Header set + insertion order mirror what the official RyanairApp 3.228.0
 * sends. Values are verbatim from a captured request except the device
 * identifiers, which are caller-supplied per-installation (so we don't look
 * like the device the capture came from).
 */
export function buildHeaders(options: ClientOptions): Record<string, string> {
	const market = options.market ?? DEFAULT_MARKET;
	const headers: Record<string, string> = {
		Client: 'android',
		'Client-Os': CLIENT_OS,
		'Client-Version': APP_VERSION,
		'User-Agent': `RyanairApp/${APP_VERSION};(android; AndroidApi: ${CLIENT_OS})`,
		'Client-Carrier-Code': CARRIER_CODE,
		'X-Pushid': options.device.pushId,
		'X-Device-Fingerprint': options.device.fingerprint,
		'Market-Code': market,
	};
	if (options.authToken) headers['X-Auth-Token'] = options.authToken;
	if (options.sessionToken) headers['X-Session-Token'] = options.sessionToken;
	headers['Accept-Encoding'] = 'gzip, deflate, br';
	return headers;
}

export async function apiFetch(
	url: string,
	init: RequestInit,
	options: ClientOptions,
): Promise<Response> {
	const f = options.fetchImpl ?? fetch;
	const baseHeaders = buildHeaders(options);
	const merged: Record<string, string> = {...baseHeaders};
	if (init.headers) {
		const provided = init.headers as Record<string, string>;
		for (const k of Object.keys(provided)) {
			const v = provided[k];
			if (typeof v === 'string') merged[k] = v;
		}
	}

	const method = (init.method ?? 'GET').toUpperCase();
	const logger = options.logger;

	if (logger) {
		logger({
			kind: 'request',
			method,
			url,
			headers: redactHeaders(merged),
			body: parseAndRedactBody(init.body),
		});
	}

	const res = await f(url, {...init, headers: merged});

	if (logger) {
		const responseHeaders: Record<string, string> = {};
		res.headers.forEach((v, k) => {
			responseHeaders[k] = v;
		});
		const body = await readResponseBodyForLog(res);
		logger({
			kind: 'response',
			method,
			url,
			status: res.status,
			ok: res.ok,
			headers: redactHeaders(responseHeaders),
			body,
		});
	}
	return res;
}

export async function readJson<T>(res: Response): Promise<T | undefined> {
	try {
		return (await res.json()) as T;
	} catch {
		return undefined;
	}
}

/** Headers whose value is a credential and must never be logged in the clear. */
const SENSITIVE_HEADERS = new Set([
	'authorization',
	'cookie',
	'set-cookie',
	'x-auth-token',
	'x-session-token',
]);

/** Body fields whose value is a credential. */
const SENSITIVE_BODY_KEYS = new Set([
	'password',
	'token',
	'authToken',
	'rememberMeToken',
	'refreshToken',
	'mfaToken',
	'mfaCode',
]);

function maskValue(v: string): string {
	if (v.length <= 12) return '***';
	return `${v.slice(0, 6)}…${v.slice(-4)} (len=${v.length})`;
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const k of Object.keys(h)) {
		const v = h[k];
		if (v === undefined) continue;
		out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? maskValue(v) : v;
	}
	return out;
}

function redactBody(input: unknown): unknown {
	if (Array.isArray(input)) return input.map(item => redactBody(item));
	if (input && typeof input === 'object') {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
			if (SENSITIVE_BODY_KEYS.has(k) && typeof v === 'string') {
				result[k] = maskValue(v);
			} else {
				result[k] = redactBody(v);
			}
		}
		return result;
	}
	return input;
}

function parseAndRedactBody(body: BodyInit | null | undefined): unknown {
	if (body === undefined || body === null) return undefined;
	if (typeof body !== 'string') return '<binary>';
	try {
		return redactBody(JSON.parse(body));
	} catch {
		return body.length > 512 ? `${body.slice(0, 512)}…` : body;
	}
}

async function readResponseBodyForLog(res: Response): Promise<unknown> {
	try {
		const cloned = res.clone();
		const text = await cloned.text();
		if (!text) return undefined;
		try {
			return redactBody(JSON.parse(text));
		} catch {
			return text.length > 1024 ? `${text.slice(0, 1024)}…` : text;
		}
	} catch {
		return '<unreadable>';
	}
}

/**
 * Convenience logger that writes one JSON-Lines event per line to a stream
 * (defaults to process.stderr).
 *
 * - When `verbose` is false (default), only `unexpected` events are written.
 *   That gives users a "something changed in the API" warning without
 *   spamming during normal runs.
 * - When `verbose` is true, every request/response pair is also written.
 */
export function createStreamLogger(opts: {
	write: (line: string) => void;
	verbose?: boolean;
}): Logger {
	const verbose = opts.verbose ?? false;
	return event => {
		if (!verbose && event.kind !== 'unexpected') return;
		opts.write(JSON.stringify({ts: new Date().toISOString(), ...event}) + '\n');
	};
}
