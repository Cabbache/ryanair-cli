import {randomUUID} from 'node:crypto';
import {
	apiFetch,
	HOSTS,
	readJson,
	type ClientOptions,
	type Logger,
} from './client.js';
import type {
	ApiErrorBody,
	LoginOk,
	LoginResult,
	VerifyResult,
} from './types.js';

const JSON_HEADERS = {'Content-Type': 'application/json; charset=utf-8'};

function findAdditional(
	body: ApiErrorBody | undefined,
	code: string,
): string | undefined {
	return body?.additionalData?.find(d => d.code === code)?.message;
}

function reportUnexpected(
	logger: Logger | undefined,
	operation: string,
	reason: string,
	httpStatus: number,
	responseBody: unknown,
): void {
	logger?.({
		kind: 'unexpected',
		operation,
		reason,
		httpStatus,
		responseBody,
	});
}

/**
 * POST /usrprof/v2/accountLogin
 *
 * Three response paths the caller has to handle:
 * - 200 → status 'ok' with auth JWT.
 * - 401 Password.Wrong → status 'wrongPassword' (with remaining attempts).
 * - 403 Account.UnknownDeviceFingerprint → status 'mfa'; caller fetches the
 *   email-delivered code from the user and calls {@link verifyMfa}.
 */
export async function login(
	device: ClientOptions['device'],
	email: string,
	password: string,
	options: Omit<ClientOptions, 'device' | 'authToken'> = {},
): Promise<LoginResult> {
	const res = await apiFetch(
		`${HOSTS.usrprof}/usrprof/v2/accountLogin`,
		{
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({
				email,
				password,
				adiContext: {
					deviceTransactionId: `v2-${randomUUID()}`,
					pageId: 'app: en: myfr: login: home',
				},
				policyAgreed: true,
			}),
		},
		{...options, device},
	);

	if (res.status === 200) {
		const body = await readJson<LoginOk & {customerId: string; token: string}>(
			res,
		);
		if (!body?.customerId || !body.token) {
			reportUnexpected(
				options.logger,
				'login',
				'200 OK but body missing customerId/token',
				res.status,
				body,
			);
			return {
				status: 'error',
				httpStatus: res.status,
				message: 'Malformed login response',
			};
		}
		return {status: 'ok', customerId: body.customerId, token: body.token};
	}

	const body = await readJson<ApiErrorBody>(res);

	if (res.status === 403 && body?.code === 'Account.UnknownDeviceFingerprint') {
		const mfaToken = findAdditional(body, 'Mfa.Token');
		if (mfaToken) return {status: 'mfa', mfaToken};
		reportUnexpected(
			options.logger,
			'login',
			'403 Account.UnknownDeviceFingerprint without Mfa.Token in additionalData',
			res.status,
			body,
		);
	}

	if (res.status === 401 && body?.code === 'Password.Wrong') {
		const remaining = findAdditional(
			body,
			'Account.Password.TryCount.Remaining',
		);
		return remaining
			? {status: 'wrongPassword', remaining}
			: {status: 'wrongPassword'};
	}

	reportUnexpected(
		options.logger,
		'login',
		`unrecognised response (status=${res.status}, code=${
			body?.code ?? '<none>'
		})`,
		res.status,
		body,
	);
	return {
		status: 'error',
		httpStatus: res.status,
		...(body?.code ? {code: body.code} : {}),
		message: body?.message ?? body?.code ?? `HTTP ${res.status}`,
	};
}

/**
 * PUT /usrprof/v2/accountVerifications/deviceFingerprint
 * Submits the email-delivered code paired with the mfaToken from {@link login}.
 */
export async function verifyMfa(
	device: ClientOptions['device'],
	mfaToken: string,
	mfaCode: string,
	options: Omit<ClientOptions, 'device' | 'authToken'> = {},
): Promise<VerifyResult> {
	const res = await apiFetch(
		`${HOSTS.usrprof}/usrprof/v2/accountVerifications/deviceFingerprint`,
		{
			method: 'PUT',
			headers: JSON_HEADERS,
			body: JSON.stringify({mfaToken, mfaCode}),
		},
		{...options, device},
	);

	if (res.status === 200) {
		const body = await readJson<{customerId: string; token: string}>(res);
		if (!body?.customerId || !body.token) {
			reportUnexpected(
				options.logger,
				'verifyMfa',
				'200 OK but body missing customerId/token',
				res.status,
				body,
			);
			return {
				status: 'error',
				httpStatus: res.status,
				message: 'Malformed verify response',
			};
		}
		return {status: 'ok', customerId: body.customerId, token: body.token};
	}

	const body = await readJson<ApiErrorBody>(res);
	reportUnexpected(
		options.logger,
		'verifyMfa',
		`non-200 response (status=${res.status}, code=${body?.code ?? '<none>'})`,
		res.status,
		body,
	);
	return {
		status: 'error',
		httpStatus: res.status,
		...(body?.code ? {code: body.code} : {}),
		message: body?.message ?? body?.code ?? `HTTP ${res.status}`,
	};
}

/**
 * GET /usrprof/v2/accounts/{customerId}/rememberMeToken
 * Long-lived (~6 month) token used to silently refresh the short-lived JWT.
 */
export async function fetchRememberMeToken(
	device: ClientOptions['device'],
	customerId: string,
	authToken: string,
	options: Omit<ClientOptions, 'device' | 'authToken'> = {},
): Promise<string | undefined> {
	const res = await apiFetch(
		`${HOSTS.usrprof}/usrprof/v2/accounts/${encodeURIComponent(
			customerId,
		)}/rememberMeToken`,
		{method: 'GET'},
		{...options, device, authToken},
	);
	if (!res.ok) {
		reportUnexpected(
			options.logger,
			'fetchRememberMeToken',
			`non-2xx response`,
			res.status,
			await readJson<unknown>(res),
		);
		return undefined;
	}
	const body = await readJson<{customerId: string; token: string}>(res);
	if (!body?.token) {
		reportUnexpected(
			options.logger,
			'fetchRememberMeToken',
			'200 OK but body missing token',
			res.status,
			body,
		);
	}
	return body?.token;
}
