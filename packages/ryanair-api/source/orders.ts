import {
	apiFetch,
	HOSTS,
	readJson,
	type ClientOptions,
	type Logger,
} from './client.js';
import type {ApiErrorBody, Device} from './types.js';

/** Single leg of a flight (we collapse rawBooking.flights[].times into this). */
export type FlightLeg = {
	flightNumber: string;
	origin: string;
	destination: string;
	/** ISO 8601 with airport-local offset, e.g. "2026-04-29T20:30:00+02:00". */
	departLocal: string;
	arriveLocal: string;
	/** ISO 8601 in UTC. */
	departUtc: string;
	arriveUtc: string;
	/** When online check-in opens / closes (UTC). */
	checkInOpenUtc: string;
	checkInCloseUtc: string;
};

export type Passenger = {
	paxNum: number;
	firstName: string;
	lastName: string;
	paxType: string;
};

export type CheckinStatus = {
	paxNum: number;
	journeyNum: number;
	segmentNum: number;
	/** "nocheckin" before check-in; other values indicate progress. */
	status: string;
};

export type Seat = {
	paxNum: number;
	journeyNum: number;
	segmentNum: number;
	designator: string;
};

export type FlightBooking = {
	pnr: string;
	bookingId: number;
	status: string;
	currency: string;
	totalAmount: number;
	flightTotalAmount: number;
	emailMasked?: string;
	flights: FlightLeg[];
	passengers: Passenger[];
	checkins: CheckinStatus[];
	seats: Seat[];
};

export type ListFlightsResult =
	| {status: 'ok'; bookings: FlightBooking[]}
	| {status: 'unauthorized'}
	| {status: 'error'; httpStatus: number; code?: string; message: string};

type RawTimes = {
	depart?: string;
	departUTC?: string;
	arrive?: string;
	arriveUTC?: string;
};

type RawFlight = {
	flightNumber?: string;
	origin?: string;
	destination?: string;
	depart?: string;
	arrive?: string;
	checkInOpenUTC?: string;
	checkInCloseUTC?: string;
	times?: RawTimes;
};

type RawPassenger = {
	paxNum?: number;
	firstName?: string;
	lastName?: string;
	paxType?: string;
};

type RawCheckin = {
	paxNum?: number;
	journeyNum?: number;
	segmentNum?: number;
	status?: string;
};

type RawSeat = {
	paxNum?: number;
	journeyNum?: number;
	segmentNum?: number;
	designator?: string;
};

type RawBooking = {
	bookingId?: number;
	currency?: string;
	recordLocator?: string;
	email?: string;
	status?: string;
	totalAmount?: number;
	flightTotalAmount?: number;
	flights?: RawFlight[];
	passengers?: RawPassenger[];
	checkins?: RawCheckin[];
	seats?: RawSeat[];
};

type OrderItem = {
	type?: string;
	rawBooking?: RawBooking;
};

type OrdersResponse = {
	items?: OrderItem[];
	nextToken?: string | null;
};

function normaliseFlight(f: RawFlight): FlightLeg | undefined {
	const flightNumber = f.flightNumber;
	const origin = f.origin;
	const destination = f.destination;
	const departLocal = f.times?.depart;
	const arriveLocal = f.times?.arrive;
	const departUtc = f.times?.departUTC ?? f.depart;
	const arriveUtc = f.times?.arriveUTC ?? f.arrive;
	const checkInOpenUtc = f.checkInOpenUTC;
	const checkInCloseUtc = f.checkInCloseUTC;
	if (
		!flightNumber ||
		!origin ||
		!destination ||
		!departLocal ||
		!arriveLocal ||
		!departUtc ||
		!arriveUtc ||
		!checkInOpenUtc ||
		!checkInCloseUtc
	) {
		return undefined;
	}
	return {
		flightNumber,
		origin,
		destination,
		departLocal,
		arriveLocal,
		departUtc,
		arriveUtc,
		checkInOpenUtc,
		checkInCloseUtc,
	};
}

function normaliseBooking(
	raw: RawBooking | undefined,
	logger: Logger | undefined,
): FlightBooking | undefined {
	if (!raw) return undefined;
	const pnr = raw.recordLocator;
	const bookingId = raw.bookingId;
	if (!pnr || bookingId === undefined) {
		logger?.({
			kind: 'unexpected',
			operation: 'listFlights',
			reason: 'rawBooking missing recordLocator or bookingId',
			details: raw,
		});
		return undefined;
	}

	const flights = (raw.flights ?? [])
		.map(normaliseFlight)
		.filter((f): f is FlightLeg => f !== undefined);

	const passengers: Passenger[] = (raw.passengers ?? [])
		.filter(p => p.firstName && p.lastName && p.paxNum !== undefined)
		.map(p => ({
			paxNum: p.paxNum!,
			firstName: p.firstName!,
			lastName: p.lastName!,
			paxType: p.paxType ?? 'ADT',
		}));

	const checkins: CheckinStatus[] = (raw.checkins ?? [])
		.filter(
			c =>
				c.paxNum !== undefined &&
				c.journeyNum !== undefined &&
				c.segmentNum !== undefined &&
				c.status !== undefined,
		)
		.map(c => ({
			paxNum: c.paxNum!,
			journeyNum: c.journeyNum!,
			segmentNum: c.segmentNum!,
			status: c.status!,
		}));

	const seats: Seat[] = (raw.seats ?? [])
		.filter(
			s =>
				s.paxNum !== undefined &&
				s.journeyNum !== undefined &&
				s.segmentNum !== undefined &&
				s.designator !== undefined,
		)
		.map(s => ({
			paxNum: s.paxNum!,
			journeyNum: s.journeyNum!,
			segmentNum: s.segmentNum!,
			designator: s.designator!,
		}));

	return {
		pnr,
		bookingId,
		status: raw.status ?? 'Unknown',
		currency: raw.currency ?? 'EUR',
		totalAmount: raw.totalAmount ?? 0,
		flightTotalAmount: raw.flightTotalAmount ?? 0,
		...(raw.email ? {emailMasked: raw.email} : {}),
		flights,
		passengers,
		checkins,
		seats,
	};
}

/**
 * GET /orders/v2/orders/{customerId}/details?type=flight&active=true
 *
 * Returns the bookings the customer can act on (i.e. not past, not cancelled).
 * The wire response is rich and chatty; this function flattens it to a stable
 * shape so the UI doesn't need to know the JSON layout.
 */
export type ListFlightsOptions = Omit<ClientOptions, 'device' | 'authToken'> & {
	/**
	 * Server-side `active` filter.
	 * - `true` (default): only upcoming/in-progress bookings (matches the app's
	 *   "Trips" tab).
	 * - `false`: only past/cancelled bookings.
	 * - `undefined`: omit the parameter entirely — let the server decide what
	 *   counts as the full set.
	 */
	active?: boolean;
};

export async function listFlights(
	device: Device,
	customerId: string,
	authToken: string,
	options: ListFlightsOptions = {active: true},
): Promise<ListFlightsResult> {
	const params = new URLSearchParams({type: 'flight'});
	if (options.active !== undefined)
		params.set('active', String(options.active));
	const url =
		`${HOSTS.usrprof}/orders/v2/orders/${encodeURIComponent(customerId)}` +
		`/details?${params.toString()}`;
	const res = await apiFetch(
		url,
		{method: 'GET'},
		{...options, device, authToken},
	);

	if (res.status === 401) {
		return {status: 'unauthorized'};
	}

	if (res.status !== 200) {
		const body = await readJson<ApiErrorBody>(res);
		options.logger?.({
			kind: 'unexpected',
			operation: 'listFlights',
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

	const body = await readJson<OrdersResponse>(res);
	if (!body || !Array.isArray(body.items)) {
		options.logger?.({
			kind: 'unexpected',
			operation: 'listFlights',
			reason: '200 OK but body did not contain items[]',
			httpStatus: res.status,
			responseBody: body,
		});
		return {
			status: 'error',
			httpStatus: res.status,
			message: 'Malformed orders response',
		};
	}

	const bookings: FlightBooking[] = [];
	for (const item of body.items) {
		if (item.type !== 'flight') continue;
		const booking = normaliseBooking(item.rawBooking, options.logger);
		if (booking) bookings.push(booking);
	}
	return {status: 'ok', bookings};
}

/** Convenience: a passenger is checked in on every leg if no checkin row says "nocheckin". */
export function isPassengerCheckedIn(
	booking: FlightBooking,
	paxNum: number,
): boolean {
	const rows = booking.checkins.filter(c => c.paxNum === paxNum);
	if (rows.length === 0) return false;
	return rows.every(r => r.status !== 'nocheckin');
}
