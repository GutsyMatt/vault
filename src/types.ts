/**
 * Type definitions for LibbyHD.
 */

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;

	/**
	 * Binding for static assets.
	 */
	ASSETS: { fetch: (request: Request) => Promise<Response> };

	/**
	 * Client ID from the app's registration on Epic on FHIR (open.epic.com).
	 */
	EPIC_CLIENT_ID: string;

	/**
	 * Production client ID. When set, patients can pick any organization from
	 * Epic's endpoint directory instead of only the default FHIR server.
	 */
	EPIC_PRODUCTION_CLIENT_ID?: string;

	/**
	 * Client secret for confidential clients. Leave unset for public clients.
	 */
	EPIC_CLIENT_SECRET?: string;

	/**
	 * FHIR R4 base URL of the organization's Epic server. Defaults to the Epic sandbox.
	 */
	EPIC_FHIR_BASE_URL?: string;

	/**
	 * Redirect URI registered with Epic. Defaults to <origin>/auth/callback.
	 */
	EPIC_REDIRECT_URI?: string;

	/**
	 * Space-separated OAuth scopes to request.
	 */
	EPIC_SCOPE?: string;

	/**
	 * Secret used to encrypt session cookies.
	 */
	SESSION_SECRET: string;
}

/**
 * A signed-in MyChart patient's OAuth session.
 */
export interface PatientSession {
	accessToken: string;
	refreshToken?: string;
	/** Access token expiry, in seconds since the epoch */
	expiresAt: number;
	/** FHIR ID of the patient the token is scoped to */
	patient: string;
	scope?: string;
	tokenEndpoint: string;
	fhirBaseUrl: string;
}

