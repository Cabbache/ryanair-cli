import React, {useEffect, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import TextInput from 'ink-text-input';
import {login, verifyMfa, type Logger} from '@ryanair-cli/api';
import {loadStore, type Store} from '../store.js';
import {persistAuthenticated} from '../services/auth.js';

type Props = {
	logger?: Logger;
};

type Stage =
	| {kind: 'loading'}
	| {kind: 'email'}
	| {kind: 'password'}
	| {kind: 'submitting'}
	| {kind: 'mfa'; mfaToken: string}
	| {kind: 'mfaSubmitting'; mfaToken: string}
	| {kind: 'error'; message: string; recoverable: boolean}
	| {kind: 'done'; email: string; customerId: string};

export default function LoginCommand({logger}: Props) {
	const {exit} = useApp();
	const [store, setStore] = useState<Store | undefined>();
	const [stage, setStage] = useState<Stage>({kind: 'loading'});
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [code, setCode] = useState('');

	useEffect(() => {
		loadStore().then(s => {
			setStore(s);
			setStage({kind: 'email'});
		});
	}, []);

	useEffect(() => {
		if (stage.kind === 'done') {
			const t = setTimeout(() => exit(), 50);
			return () => clearTimeout(t);
		}
		return undefined;
	}, [stage.kind, exit]);

	if (!store || stage.kind === 'loading') {
		return <Text>Loading…</Text>;
	}

	const apiOpts = logger ? {logger} : {};

	const submitCredentials = async () => {
		setStage({kind: 'submitting'});
		const res = await login(store.device, email, password, apiOpts);

		if (res.status === 'ok') {
			const updated = await persistAuthenticated(
				store,
				{email, customerId: res.customerId, authToken: res.token},
				apiOpts,
			);
			setStore(updated);
			setStage({kind: 'done', email, customerId: res.customerId});
			return;
		}

		if (res.status === 'mfa') {
			setStage({kind: 'mfa', mfaToken: res.mfaToken});
			return;
		}

		if (res.status === 'wrongPassword') {
			setPassword('');
			setStage({
				kind: 'error',
				message: `Wrong password${res.remaining ? ` (${res.remaining} attempts left)` : ''}.`,
				recoverable: true,
			});
			return;
		}

		setStage({kind: 'error', message: res.message, recoverable: false});
	};

	const submitMfa = async (mfaToken: string) => {
		setStage({kind: 'mfaSubmitting', mfaToken});
		const res = await verifyMfa(store.device, mfaToken, code.trim(), apiOpts);

		if (res.status === 'ok') {
			const updated = await persistAuthenticated(
				store,
				{email, customerId: res.customerId, authToken: res.token},
				apiOpts,
			);
			setStore(updated);
			setStage({kind: 'done', email, customerId: res.customerId});
			return;
		}

		setStage({kind: 'error', message: res.message, recoverable: false});
	};

	const onErrorRetry = () => {
		if (stage.kind !== 'error') return;
		if (stage.recoverable) {
			setStage({kind: 'password'});
		} else {
			exit();
		}
	};

	return (
		<Box flexDirection="column">
			<Text color="cyan">Ryanair sign-in</Text>

			{stage.kind === 'email' && (
				<Box>
					<Text>Email: </Text>
					<TextInput
						value={email}
						onChange={setEmail}
						onSubmit={() => {
							if (email.trim()) setStage({kind: 'password'});
						}}
					/>
				</Box>
			)}

			{stage.kind === 'password' && (
				<Box flexDirection="column">
					<Text dimColor>Email: {email}</Text>
					<Box>
						<Text>Password: </Text>
						<TextInput
							value={password}
							onChange={setPassword}
							mask="*"
							onSubmit={submitCredentials}
						/>
					</Box>
				</Box>
			)}

			{stage.kind === 'submitting' && <Text>Logging in…</Text>}

			{stage.kind === 'mfa' && (
				<Box flexDirection="column">
					<Text dimColor>
						This device is not recognised. Check your email for a verification code.
					</Text>
					<Box>
						<Text>Code: </Text>
						<TextInput
							value={code}
							onChange={setCode}
							onSubmit={() => {
								if (code.trim()) submitMfa(stage.mfaToken);
							}}
						/>
					</Box>
				</Box>
			)}

			{stage.kind === 'mfaSubmitting' && <Text>Verifying code…</Text>}

			{stage.kind === 'error' && (
				<Box flexDirection="column">
					<Text color="red">{stage.message}</Text>
					{stage.recoverable ? (
						<Box>
							<Text dimColor>Press enter to retry password.</Text>
							<TextInput value="" onChange={() => undefined} onSubmit={onErrorRetry} />
						</Box>
					) : (
						<Box>
							<Text dimColor>Press enter to exit.</Text>
							<TextInput value="" onChange={() => undefined} onSubmit={onErrorRetry} />
						</Box>
					)}
				</Box>
			)}

			{stage.kind === 'done' && (
				<Text color="green">
					Signed in as {stage.email} (customer {stage.customerId}). Session saved.
				</Text>
			)}
		</Box>
	);
}
