import {fetchRememberMeToken, type Logger} from '@ryanair-cli/api';
import {saveStore, type Store, type Session} from '../store.js';

/**
 * Take a successful auth response, fetch the long-lived rememberMeToken,
 * persist everything to the local store, and return the updated store.
 *
 * The API client doesn't know about disk; this function is the glue.
 */
export async function persistAuthenticated(
	store: Store,
	args: {email: string; customerId: string; authToken: string},
	options: {logger?: Logger} = {},
): Promise<Store> {
	let rememberMeToken: string | undefined;
	try {
		rememberMeToken = await fetchRememberMeToken(
			store.device,
			args.customerId,
			args.authToken,
			options.logger ? {logger: options.logger} : {},
		);
	} catch {
		// non-fatal: we can refresh later
	}

	const session: Session = {
		customerId: args.customerId,
		authToken: args.authToken,
		email: args.email,
		...(rememberMeToken ? {rememberMeToken} : {}),
	};
	const updated: Store = {...store, session};
	await saveStore(updated);
	return updated;
}
