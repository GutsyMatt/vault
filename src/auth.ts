/**
 * Epic MyChart patient authentication (SMART on FHIR standalone launch).
 *
 * Implements the OAuth 2.0 authorization code flow with PKCE that Epic uses
 * for patient-facing apps:
 *
 *   1. /auth/login     discovers the authorize/token endpoints from the FHIR
 *                      server's .well-known/smart-configuration, then redirects
 *                      the patient to MyChart to sign in.
 *   2. /auth/callback  verifies `state`, exchanges the code (plus the PKCE
 *                      verifier) for an access token and stores the session.
 *   3. /auth/logout    clears the session.
 *
 * Sessions are kept in an AES-GCM encrypted, HttpOnly cookie so no extra
 * storage binding is required.
 *
 * @see https://open.epic.com/Tutorial/PatientAuthentication
 * @see https://hl7.org/fhir/smart-app-launch/app-launch.html
 */
import { Env, PatientSession } from "./types";

// Epic's public sandbox FHIR R4 endpoint, used when EPIC_FHIR_BASE_URL is unset
const DEFAULT_FHIR_BASE_URL =
	"https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";

// Scopes requested at authorization. Epic grants FHIR access based on the
// app's registration, but `launch/patient` is required for a standalone
// patient launch so the token response includes the patient's FHIR ID.
const DEFAULT_SCOPE = "launch/patient openid fhirUser";

const SESSION_COOKIE = "vault_session";
const PENDING_COOKIE = "vault_auth";

// Pending logins must complete within this window (seconds)
const PENDING_TTL = 600;

// Refresh the access token this many seconds before it expires
const REFRESH_SKEW = 60;

// Browsers drop cookies larger than ~4KB
const MAX_COOKIE_BYTES = 4000;

interface SmartConfiguration {
	authorization_endpoint: string;
	token_endpoint: string;
}

interface PendingAuth {
	state: string;
	codeVerifier: string;
	redirectUri: string;
	tokenEndpoint: string;
	createdAt: number;
}

interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	scope?: string;
	refresh_token?: string;
	patient?: string;
}

/**
 * Routes /auth/* requests. Returns null for paths it does not handle.
 */
export async function handleAuthRequest(
	request: Request,
	env: Env,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (request.method !== "GET") {
		return url.pathname.startsWith("/auth/")
			? new Response("Method not allowed", { status: 405 })
			: null;
	}

	switch (url.pathname) {
		case "/auth/login":
			return handleLogin(request, env);
		case "/auth/callback":
			return handleCallback(request, env);
		case "/auth/logout":
			return redirect("/", [clearCookie(SESSION_COOKIE)]);
		default:
			return null;
	}
}

/**
 * Starts the authorization code flow by redirecting to Epic's authorize endpoint.
 */
async function handleLogin(request: Request, env: Env): Promise<Response> {
	const clientId = env.EPIC_CLIENT_ID;
	if (!clientId || !env.SESSION_SECRET) {
		return new Response(
			"Patient sign-in is not configured: set EPIC_CLIENT_ID and SESSION_SECRET.",
			{ status: 500 },
		);
	}

	const fhirBaseUrl = getFhirBaseUrl(env);
	const smart = await discoverSmartConfiguration(fhirBaseUrl);
	const redirectUri =
		env.EPIC_REDIRECT_URI || new URL("/auth/callback", request.url).toString();

	const state = randomString(32);
	const codeVerifier = randomString(64);
	const codeChallenge = base64UrlEncode(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(codeVerifier),
			),
		),
	);

	const authorizeUrl = new URL(smart.authorization_endpoint);
	authorizeUrl.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: env.EPIC_SCOPE || DEFAULT_SCOPE,
		state,
		// Epic requires `aud` to be the FHIR base URL the token will be used with
		aud: fhirBaseUrl,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	}).toString();

	const pending: PendingAuth = {
		state,
		codeVerifier,
		redirectUri,
		tokenEndpoint: smart.token_endpoint,
		createdAt: now(),
	};
	const pendingCookie = await sealCookie(
		PENDING_COOKIE,
		pending,
		env.SESSION_SECRET,
		PENDING_TTL,
	);

	return redirect(authorizeUrl.toString(), [pendingCookie]);
}

/**
 * Handles Epic's redirect back to the app and exchanges the code for a token.
 */
async function handleCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const clearPending = clearCookie(PENDING_COOKIE);

	const error = url.searchParams.get("error");
	if (error) {
		const description = url.searchParams.get("error_description") ?? "";
		console.error("Epic authorization error:", error, description);
		return authError(`Sign-in was not completed (${error}).`, clearPending);
	}

	const pending = await unsealCookie<PendingAuth>(
		request,
		PENDING_COOKIE,
		env.SESSION_SECRET,
	);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (
		!pending ||
		!code ||
		!state ||
		state !== pending.state ||
		now() - pending.createdAt > PENDING_TTL
	) {
		return authError(
			"Sign-in session expired or is invalid. Please try again.",
			clearPending,
		);
	}

	let token: TokenResponse;
	try {
		token = await requestToken(pending.tokenEndpoint, env, {
			grant_type: "authorization_code",
			code,
			redirect_uri: pending.redirectUri,
			code_verifier: pending.codeVerifier,
		});
	} catch (err) {
		console.error("Epic token exchange failed:", err);
		return authError("Could not complete sign-in with MyChart.", clearPending);
	}

	if (!token.patient) {
		return authError(
			"MyChart did not return a patient context. Check that the app requests the launch/patient scope.",
			clearPending,
		);
	}

	const session = sessionFromToken(
		token,
		pending.tokenEndpoint,
		getFhirBaseUrl(env),
	);
	const sessionCookie = await sealSessionCookie(session, env);
	return redirect("/", [clearPending, sessionCookie]);
}

/**
 * Returns the current patient session, refreshing the access token if it has
 * expired and a refresh token is available. When the session changes,
 * `setCookie` holds the updated cookie that must be sent with the response.
 */
export async function getPatientSession(
	request: Request,
	env: Env,
): Promise<{ session: PatientSession | null; setCookie?: string }> {
	if (!env.SESSION_SECRET) return { session: null };

	const session = await unsealCookie<PatientSession>(
		request,
		SESSION_COOKIE,
		env.SESSION_SECRET,
	);
	if (!session) return { session: null };
	if (session.expiresAt - REFRESH_SKEW > now()) return { session };

	if (!session.refreshToken) {
		return { session: null, setCookie: clearCookie(SESSION_COOKIE) };
	}

	try {
		const token = await requestToken(session.tokenEndpoint, env, {
			grant_type: "refresh_token",
			refresh_token: session.refreshToken,
		});
		const refreshed = sessionFromToken(
			{
				...token,
				patient: token.patient ?? session.patient,
				refresh_token: token.refresh_token ?? session.refreshToken,
			},
			session.tokenEndpoint,
			session.fhirBaseUrl,
		);
		return {
			session: refreshed,
			setCookie: await sealSessionCookie(refreshed, env),
		};
	} catch (err) {
		console.error("Epic token refresh failed:", err);
		return { session: null, setCookie: clearCookie(SESSION_COOKIE) };
	}
}

/**
 * Fetches a FHIR resource on behalf of the signed-in patient.
 */
export async function fetchFhir(
	session: PatientSession,
	path: string,
): Promise<Response> {
	return fetch(`${session.fhirBaseUrl}/${path}`, {
		headers: {
			authorization: `Bearer ${session.accessToken}`,
			accept: "application/fhir+json",
		},
	});
}

function getFhirBaseUrl(env: Env): string {
	return (env.EPIC_FHIR_BASE_URL || DEFAULT_FHIR_BASE_URL).replace(/\/+$/, "");
}

async function discoverSmartConfiguration(
	fhirBaseUrl: string,
): Promise<SmartConfiguration> {
	const response = await fetch(
		`${fhirBaseUrl}/.well-known/smart-configuration`,
		{ headers: { accept: "application/json" } },
	);
	if (!response.ok) {
		throw new Error(
			`SMART configuration discovery failed: ${response.status} ${response.statusText}`,
		);
	}
	const config = (await response.json()) as Partial<SmartConfiguration>;
	if (!config.authorization_endpoint || !config.token_endpoint) {
		throw new Error("SMART configuration is missing OAuth endpoints");
	}
	return config as SmartConfiguration;
}

/**
 * POSTs to the token endpoint. Confidential clients (EPIC_CLIENT_SECRET set)
 * authenticate with HTTP Basic; public clients send client_id in the body.
 */
async function requestToken(
	tokenEndpoint: string,
	env: Env,
	params: Record<string, string>,
): Promise<TokenResponse> {
	const headers: Record<string, string> = {
		"content-type": "application/x-www-form-urlencoded",
		accept: "application/json",
	};
	const body = new URLSearchParams(params);
	if (env.EPIC_CLIENT_SECRET) {
		headers.authorization = `Basic ${btoa(
			`${encodeURIComponent(env.EPIC_CLIENT_ID)}:${encodeURIComponent(env.EPIC_CLIENT_SECRET)}`,
		)}`;
	} else {
		body.set("client_id", env.EPIC_CLIENT_ID);
	}

	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers,
		body,
	});
	if (!response.ok) {
		throw new Error(
			`Token request failed: ${response.status} ${await response.text()}`,
		);
	}
	const token = (await response.json()) as TokenResponse;
	if (!token.access_token) {
		throw new Error("Token response did not include an access_token");
	}
	return token;
}

function sessionFromToken(
	token: TokenResponse,
	tokenEndpoint: string,
	fhirBaseUrl: string,
): PatientSession {
	return {
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: now() + (token.expires_in ?? 3600),
		patient: token.patient as string,
		scope: token.scope,
		tokenEndpoint,
		fhirBaseUrl,
	};
}

async function sealSessionCookie(
	session: PatientSession,
	env: Env,
): Promise<string> {
	// Keep the cookie for the refresh token's lifetime when there is one;
	// otherwise it is useless once the access token expires.
	const maxAge = session.refreshToken
		? 60 * 60 * 24 * 30
		: session.expiresAt - now();
	return sealCookie(SESSION_COOKIE, session, env.SESSION_SECRET, maxAge);
}

function authError(message: string, setCookie: string): Response {
	return new Response(message, {
		status: 400,
		headers: { "content-type": "text/plain; charset=utf-8", "set-cookie": setCookie },
	});
}

function redirect(location: string, cookies: string[]): Response {
	const headers = new Headers({ location, "cache-control": "no-store" });
	for (const cookie of cookies) headers.append("set-cookie", cookie);
	return new Response(null, { status: 302, headers });
}

// --- Encrypted cookies ---------------------------------------------------

async function sealCookie(
	name: string,
	value: unknown,
	secret: string,
	maxAge: number,
): Promise<string> {
	const key = await deriveKey(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) },
			key,
			new TextEncoder().encode(JSON.stringify(value)),
		),
	);
	const sealed = new Uint8Array(iv.length + ciphertext.length);
	sealed.set(iv);
	sealed.set(ciphertext, iv.length);

	const cookie = `${name}=${base64UrlEncode(sealed)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
	if (cookie.length > MAX_COOKIE_BYTES) {
		throw new Error(`Cookie ${name} is too large (${cookie.length} bytes)`);
	}
	return cookie;
}

async function unsealCookie<T>(
	request: Request,
	name: string,
	secret: string,
): Promise<T | null> {
	const raw = readCookie(request, name);
	if (!raw || !secret) return null;
	try {
		const sealed = base64UrlDecode(raw);
		const key = await deriveKey(secret);
		const plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: sealed.slice(0, 12),
				additionalData: new TextEncoder().encode(name),
			},
			key,
			sealed.slice(12),
		);
		return JSON.parse(new TextDecoder().decode(plaintext)) as T;
	} catch {
		// Tampered, truncated, or encrypted with a rotated secret
		return null;
	}
}

function clearCookie(name: string): string {
	return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return null;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret),
	);
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

// --- Encoding helpers ------------------------------------------------------

function randomString(byteLength: number): string {
	return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function now(): number {
	return Math.floor(Date.now() / 1000);
}
