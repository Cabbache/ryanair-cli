import React, {useEffect, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import {
	listFlights,
	isPassengerCheckedIn,
	type FlightBooking,
	type Logger,
} from '@ryanair-cli/api';
import {loadStore, type Store} from '../store.js';

type Props = {
	logger?: Logger;
};

type Stage =
	| {kind: 'loading'}
	| {kind: 'error'; message: string}
	| {kind: 'unauthenticated'}
	| {kind: 'ok'; bookings: FlightBooking[]};

export default function FlightsCommand({logger}: Props) {
	const {exit} = useApp();
	const [stage, setStage] = useState<Stage>({kind: 'loading'});

	useEffect(() => {
		(async () => {
			let store: Store;
			try {
				store = await loadStore();
			} catch (err) {
				setStage({kind: 'error', message: `Could not read session: ${(err as Error).message}`});
				return;
			}

			if (!store.session) {
				setStage({kind: 'unauthenticated'});
				return;
			}

			const apiOpts = logger ? {logger} : {};
			const res = await listFlights(
				store.device,
				store.session.customerId,
				store.session.authToken,
				apiOpts,
			);

			if (res.status === 'ok') {
				setStage({kind: 'ok', bookings: res.bookings});
				return;
			}
			if (res.status === 'unauthorized') {
				setStage({kind: 'unauthenticated'});
				return;
			}
			setStage({kind: 'error', message: res.message});
		})();
	}, [logger]);

	useEffect(() => {
		if (stage.kind === 'loading') return;
		const t = setTimeout(() => exit(), 50);
		return () => clearTimeout(t);
	}, [stage.kind, exit]);

	if (stage.kind === 'loading') return <Text>Loading flights…</Text>;

	if (stage.kind === 'unauthenticated') {
		return (
			<Box flexDirection="column">
				<Text color="yellow">Session is missing or expired.</Text>
				<Text dimColor>Run: ryanair-cli login</Text>
			</Box>
		);
	}

	if (stage.kind === 'error') {
		return (
			<Box flexDirection="column">
				<Text color="red">Could not list flights: {stage.message}</Text>
				<Text dimColor>Try with --debug to see what came back.</Text>
			</Box>
		);
	}

	if (stage.bookings.length === 0) {
		return <Text>No upcoming flights.</Text>;
	}

	return (
		<Box flexDirection="column">
			{stage.bookings.map(b => (
				<BookingCard key={b.bookingId} booking={b} />
			))}
		</Box>
	);
}

function BookingCard({booking}: {booking: FlightBooking}) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text>
				<Text color="cyan">{booking.pnr}</Text>
				{'  '}
				<Text dimColor>#{booking.bookingId}</Text>
				{'  '}
				<Text>{booking.status}</Text>
				{'  '}
				<Text dimColor>
					{booking.totalAmount.toFixed(2)} {booking.currency}
				</Text>
			</Text>
			{booking.flights.map((leg, i) => (
				<LegLine key={`${leg.flightNumber}-${i}`} leg={leg} />
			))}
			<Box flexDirection="column" marginLeft={2}>
				{booking.passengers.map(p => {
					const checkedIn = isPassengerCheckedIn(booking, p.paxNum);
					const seat = booking.seats.find(s => s.paxNum === p.paxNum);
					return (
						<Text key={p.paxNum}>
							<Text dimColor>•</Text> {p.firstName} {p.lastName}{' '}
							<Text dimColor>({p.paxType})</Text>{' '}
							{checkedIn ? (
								<Text color="green">checked in</Text>
							) : (
								<Text color="yellow">not checked in</Text>
							)}
							{seat && (
								<>
									{'  '}
									<Text dimColor>seat</Text> {seat.designator}
								</>
							)}
						</Text>
					);
				})}
			</Box>
		</Box>
	);
}

function LegLine({leg}: {leg: {origin: string; destination: string; flightNumber: string; departLocal: string; arriveLocal: string; checkInOpenUtc: string; checkInCloseUtc: string}}) {
	return (
		<Box flexDirection="column" marginLeft={2}>
			<Text>
				<Text color="white">{leg.flightNumber}</Text>{'  '}
				<Text>{leg.origin} → {leg.destination}</Text>{'  '}
				<Text dimColor>{formatLocal(leg.departLocal)} → {formatLocal(leg.arriveLocal)}</Text>
			</Text>
			<Text dimColor>
				  check-in: {formatUtc(leg.checkInOpenUtc)} → {formatUtc(leg.checkInCloseUtc)} UTC
			</Text>
		</Box>
	);
}

function formatLocal(iso: string): string {
	// Keep the airport-local time + offset, just trim seconds for readability.
	// "2026-04-29T20:30:00+02:00" -> "Wed 29 Apr 20:30 (+02:00)"
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/);
	if (!m) return iso;
	const [, year, month, day, hour, minute, offset] = m;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
	const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1];
	const off = offset && offset !== 'Z' ? ` ${offset}` : '';
	return `${dow} ${day} ${monthName} ${hour}:${minute}${off}`;
}

function formatUtc(iso: string): string {
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!m) return iso;
	const [, , month, day, hour, minute] = m;
	const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1];
	return `${day} ${monthName} ${hour}:${minute}`;
}
