import {apiFetch, HOSTS, readJson, type ClientOptions} from './client.js';
import type {ApiErrorBody, Device} from './types.js';

const JSON_HEADERS = {'Content-Type': 'application/json; charset=utf-8'};

/** Mirrors the response of POST /v1/boardingpass — one entry per pax / leg. */
export type BoardingPass = {
	passId: string;
	hash: string;
	pnr: string;
	isConnectingFlight: boolean;
	paxNumber: number;
	paxType: string;
	name: {title?: string; first: string; last: string};
	/**
	 * IATA BCBP "M" string. This is the literal payload that the official
	 * app encodes as Aztec on screen — caller renders it however they want.
	 */
	barcode: string;
	departure: BoardingPassPoint;
	arrival: BoardingPassPoint;
	ssrsDetails?: Array<{code: string; qty: number}>;
	seat: {
		designator: string;
		location?: string;
		paid?: boolean;
		door?: number;
		isPrime?: boolean;
	};
	priority?: boolean;
	fast?: boolean;
	leisurePlus?: boolean;
	timeSaver?: boolean;
	businessPlus?: boolean;
	familyPlus?: boolean;
	regular?: boolean;
	sequence: number;
	boardingTime: string;
	boardingTimeEpoch: number;
	flight: {
		carrierCode: string;
		number: string;
		label: string;
		operatedBy?: string;
	};
	ticketType?: string;
	discount?: string;
	docNationality?: string;
	docCountryOfIssue?: string;
	authorizationStatus?: string;
};

export type BoardingPassPoint = {
	code: string;
	name: string;
	/** Local time, no timezone. */
	date: string;
	/** UTC, with `Z` suffix. */
	dateUTC: string;
	dateUTCOffset: string;
	epoch: number;
};

export type BoardingPassResult =
	| {status: 'ok'; passes: BoardingPass[]}
	| {status: 'unauthorized'}
	| {status: 'notFound'; message: string}
	| {status: 'error'; httpStatus: number; code?: string; message: string};

/**
 * POST mntappbp/v1/boardingpass
 *
 * Returns the issued boarding passes for a booking, one per (passenger × leg).
 * Each entry's `barcode` field is the BCBP string we render as Aztec.
 *
 * Note: only succeeds once the passengers have actually checked in. If the
 * booking exists but no one is checked in yet the API responds with an error
 * code rather than an empty array — we map that to {@link BoardingPassResult}'s
 * `notFound` so the UI can prompt the user to check in first.
 */
export async function getBoardingPasses(
	device: Device,
	pnr: string,
	email: string,
	authToken: string,
	options: Omit<ClientOptions, 'device' | 'authToken'> = {},
): Promise<BoardingPassResult> {
	const res = await apiFetch(
		`${HOSTS.mntappbp}/v1/boardingpass`,
		{
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({RecordLocator: pnr, Email: email}),
		},
		{...options, device, authToken},
	);

	if (res.status === 401) return {status: 'unauthorized'};

	if (res.status === 200) {
		const body = await readJson<BoardingPass[]>(res);
		if (!Array.isArray(body)) {
			options.logger?.({
				kind: 'unexpected',
				operation: 'getBoardingPasses',
				reason: '200 OK but body was not an array',
				httpStatus: res.status,
				responseBody: body,
			});
			return {
				status: 'error',
				httpStatus: res.status,
				message: 'Malformed boarding-pass response',
			};
		}
		return {status: 'ok', passes: body};
	}

	const body = await readJson<ApiErrorBody>(res);

	if (
		(res.status === 404 || res.status === 400) &&
		(body?.code === 'BoardingPass.NotFound' ||
			body?.code === 'BoardingPass.NotIssued' ||
			body?.code === 'CheckIn.Required')
	) {
		return {
			status: 'notFound',
			message: body?.message ?? 'No boarding pass issued yet — check in first.',
		};
	}

	options.logger?.({
		kind: 'unexpected',
		operation: 'getBoardingPasses',
		reason: `non-200 response (status=${res.status}, code=${
			body?.code ?? '<none>'
		})`,
		httpStatus: res.status,
		responseBody: body,
	});

	return {
		status: 'error',
		httpStatus: res.status,
		...(body?.code ? {code: body.code} : {}),
		message: body?.message ?? body?.code ?? `HTTP ${res.status}`,
	};
}
