import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import {
	getBoardingPasses,
	type BoardingPass,
	type Logger,
} from '@ryanair-cli/api';
import {loadStore, type Store} from '../store.js';
import {aztecToHalfBlocks} from '../util/aztec.js';

type Props = {
	pnr: string;
	logger?: Logger;
};

type Stage =
	| {kind: 'loading'}
	| {kind: 'error'; message: string}
	| {kind: 'unauthenticated'}
	| {kind: 'notFound'; message: string}
	| {kind: 'ok'; passes: BoardingPass[]};

export default function BoardingPassCommand({pnr, logger}: Props) {
	const {exit} = useApp();
	const [stage, setStage] = useState<Stage>({kind: 'loading'});

	useEffect(() => {
		(async () => {
			let store: Store;
			try {
				store = await loadStore();
			} catch (err) {
				setStage({
					kind: 'error',
					message: `Could not read session: ${(err as Error).message}`,
				});
				return;
			}

			if (!store.session) {
				setStage({kind: 'unauthenticated'});
				return;
			}

			const apiOpts = logger ? {logger} : {};
			const res = await getBoardingPasses(
				store.device,
				pnr.toUpperCase(),
				store.session.email,
				store.session.authToken,
				apiOpts,
			);

			if (res.status === 'ok') {
				setStage({kind: 'ok', passes: res.passes});
				return;
			}
			if (res.status === 'unauthorized') {
				setStage({kind: 'unauthenticated'});
				return;
			}
			if (res.status === 'notFound') {
				setStage({kind: 'notFound', message: res.message});
				return;
			}
			setStage({kind: 'error', message: res.message});
		})();
	}, [logger, pnr]);

	useEffect(() => {
		if (stage.kind === 'loading') return;
		const t = setTimeout(() => exit(), 50);
		return () => clearTimeout(t);
	}, [stage.kind, exit]);

	if (stage.kind === 'loading')
		return <Text>Fetching boarding pass(es) for {pnr.toUpperCase()}…</Text>;

	if (stage.kind === 'unauthenticated') {
		return (
			<Box flexDirection="column">
				<Text color="yellow">Session is missing or expired.</Text>
				<Text dimColor>Run: ryanair-cli login</Text>
			</Box>
		);
	}

	if (stage.kind === 'notFound') {
		return (
			<Box flexDirection="column">
				<Text color="yellow">
					No boarding pass yet for {pnr.toUpperCase()}.
				</Text>
				<Text dimColor>{stage.message}</Text>
			</Box>
		);
	}

	if (stage.kind === 'error') {
		return (
			<Box flexDirection="column">
				<Text color="red">Could not fetch boarding pass: {stage.message}</Text>
				<Text dimColor>Try with --debug to see the raw response.</Text>
			</Box>
		);
	}

	if (stage.passes.length === 0) {
		return <Text>No boarding passes returned for {pnr.toUpperCase()}.</Text>;
	}

	return (
		<Box flexDirection="column">
			{stage.passes.map(p => (
				<PassCard key={p.passId} pass={p} />
			))}
		</Box>
	);
}

function PassCard({pass}: {pass: BoardingPass}) {
	const aztec = useMemo(() => {
		try {
			return aztecToHalfBlocks(pass.barcode);
		} catch (err) {
			return `[aztec render failed: ${(err as Error).message}]`;
		}
	}, [pass.barcode]);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text>
				<Text color="cyan">{pass.flight.label}</Text>
				{'  '}
				<Text>
					{pass.departure.code} → {pass.arrival.code}
				</Text>
				{'  '}
				<Text dimColor>PNR {pass.pnr}</Text>
			</Text>
			<Text>
				<Text bold>
					{(pass.name.title ? pass.name.title + ' ' : '') +
						pass.name.first +
						' ' +
						pass.name.last}
				</Text>
				{'  '}
				<Text dimColor>seat</Text> {pass.seat.designator}
				{pass.seat.location ? (
					<Text dimColor> ({pass.seat.location})</Text>
				) : null}
				{'  '}
				<Text dimColor>seq</Text> {pass.sequence}
				{pass.priority ? <Text color="green"> · priority</Text> : null}
			</Text>
			<Text dimColor>
				Boarding {formatLocal(pass.boardingTime)} · departs{' '}
				{formatLocal(pass.departure.date)} ({pass.departure.dateUTCOffset})
			</Text>
			<Box marginTop={1} flexDirection="column">
				<Text>{aztec}</Text>
			</Box>
			<Text dimColor>{pass.barcode}</Text>
		</Box>
	);
}

function formatLocal(iso: string): string {
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!m) return iso;
	const [, , month, day, hour, minute] = m;
	const monthName = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	][Number(month) - 1];
	return `${day} ${monthName} ${hour}:${minute}`;
}
