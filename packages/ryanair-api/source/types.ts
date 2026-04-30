/**
 * Per-installation device identity. The Ryanair backend uses these to
 * fingerprint clients and gate MFA; persist them across runs so a user
 * doesn't get re-challenged for every login.
 */
export type Device = {
	/** 40-hex-char string sent as `X-Device-Fingerprint`. */
	fingerprint: string;
	/** UUID sent as `X-Pushid` (also used as Swrve user id, etc.). */
	pushId: string;
};

export type LoginOk = {status: 'ok'; customerId: string; token: string};
export type LoginMfa = {status: 'mfa'; mfaToken: string};
export type LoginWrongPassword = {status: 'wrongPassword'; remaining?: string};
export type LoginError = {
	status: 'error';
	httpStatus: number;
	code?: string;
	message: string;
};

export type LoginResult = LoginOk | LoginMfa | LoginWrongPassword | LoginError;

export type VerifyResult = LoginOk | LoginError;

export type AdditionalDataItem = {code: string; message: string};

export type ApiErrorBody = {
	code?: string;
	message?: string;
	additionalData?: AdditionalDataItem[];
};
