/**
 * Authentication. Fails closed. Two supported methods, checked in this order:
 *
 *  1. Google sign-in (the method already live on lifeos.libbyhd.org): the browser
 *     signs in with Google Identity Services, posts the Google ID token to
 *     /auth/google, the Worker verifies it (signature, audience, issuer, expiry,
 *     verified email, allow-list) and stores it in a Secure HttpOnly cookie.
 *     Every later request re-verifies that cookie.
 *  2. Cloudflare Access: if an Access application sits in front, its JWT is verified.
 *
 * If neither is configured, every request is refused.
 */
import type { Env } from "../types";

export interface Jwk extends JsonWebKey {
	kid?: string;
}
export interface Jwks {
	keys: Jwk[];
}
export interface Principal {
	email: string;
	via: "google" | "access" | "dev" | "automation";
}

export const SESSION_COOKIE = "__Host-fos_gid";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
	const out = new Uint8Array(new ArrayBuffer(bin.length));
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
function b64urlJson(s: string): any {
	return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/** Verify an RS256 JWT's signature, audience, issuer and time claims. Returns the payload or null. */
export async function verifyRs256Jwt(
	token: string,
	opts: { aud: string; issuers: string[]; jwks: Jwks; nowSec?: number },
): Promise<Record<string, any> | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	let header: any, payload: any;
	try {
		header = b64urlJson(parts[0]);
		payload = b64urlJson(parts[1]);
	} catch {
		return null;
	}
	if (header.alg !== "RS256") return null;
	const jwk = opts.jwks.keys.find((k) => k.kid === header.kid);
	if (!jwk) return null;
	let ok = false;
	try {
		const key = await crypto.subtle.importKey(
			"jwk",
			{ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["verify"],
		);
		ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
	} catch {
		return null;
	}
	if (!ok) return null;
	const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
	const auds: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!auds.includes(opts.aud)) return null;
	if (!opts.issuers.includes(payload.iss)) return null;
	if (typeof payload.exp !== "number" || payload.exp < now) return null;
	if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
	return payload;
}

export async function verifyAccessJwt(token: string, opts: { aud: string; issuer: string; jwks: Jwks; nowSec?: number }): Promise<{ email: string } | null> {
	const p = await verifyRs256Jwt(token, { aud: opts.aud, issuers: [opts.issuer], jwks: opts.jwks, nowSec: opts.nowSec });
	if (!p || typeof p.email !== "string") return null;
	return { email: p.email.toLowerCase() };
}

export async function verifyGoogleIdToken(token: string, opts: { clientId: string; jwks: Jwks; nowSec?: number }): Promise<{ email: string; exp: number } | null> {
	const p = await verifyRs256Jwt(token, { aud: opts.clientId, issuers: GOOGLE_ISSUERS, jwks: opts.jwks, nowSec: opts.nowSec });
	if (!p || typeof p.email !== "string" || p.email_verified !== true) return null;
	return { email: p.email.toLowerCase(), exp: p.exp };
}

const jwksCache = new Map<string, { at: number; jwks: Jwks }>();
async function getJwks(url: string): Promise<Jwks> {
	const hit = jwksCache.get(url);
	if (hit && Date.now() - hit.at < 10 * 60_000) return hit.jwks;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
	const jwks = (await res.json()) as Jwks;
	jwksCache.set(url, { at: Date.now(), jwks });
	return jwks;
}
export const googleJwks = () => getJwks(GOOGLE_JWKS_URL);

export function allowedEmails(env: Env): string[] {
	return (env.ALLOWED_EMAILS || "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("cookie") || "";
	for (const part of header.split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) return v.join("=");
	}
	return null;
}

async function sha256HexOf(s: string): Promise<string> {
	const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * What the automation key may do: add and read. Never write in a parent's voice or make a
 * clinical/closing decision: letters, kept moments, quick-log entries, issue status changes,
 * conflict resolution and settings stay parents-only.
 */
export function automationMayCall(method: string, sub: string): boolean {
	const allowed: [string, RegExp][] = [
		["GET", /^\/(summary|story|export|whoami)$/],
		["GET", /^\/issues\/[0-9A-Z]{26}$/],
		["PUT", /^\/profile$/],
		["POST", /^\/(life-events|issues|appointments|medications|documents|mychart-import)$/],
	];
	return allowed.some(([m, re]) => m === method && re.test(sub));
}

export type AuthResult =
	| { ok: true; principal: Principal }
	| { ok: false; status: 401 | 403 | 503; reason: string; canSignIn: boolean };

function isLocalHost(hostname: string): boolean {
	return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1";
}

export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
	const url = new URL(request.url);
	// Local development and tests only: requires *.localhost AND DEV_AUTH_EMAIL.
	if (env.DEV_AUTH_EMAIL && isLocalHost(url.hostname)) {
		return { ok: true, principal: { email: env.DEV_AUTH_EMAIL.toLowerCase(), via: "dev" } };
	}
	// Claude's automation key (approved by Matthew, 2026-11-02). Compared by SHA-256,
	// so only the hash lives in config; delete AUTOMATION_TOKEN_SHA256 to revoke.
	const authz = request.headers.get("authorization") || "";
	if (env.AUTOMATION_TOKEN_SHA256 && authz.startsWith("Bearer fos_")) {
		const presented = await sha256HexOf(authz.slice(7));
		if (timingSafeEqualHex(presented, env.AUTOMATION_TOKEN_SHA256.toLowerCase())) {
			return { ok: true, principal: { email: "automation:claude", via: "automation" } };
		}
		return { ok: false, status: 401, reason: "bad-automation-key", canSignIn: false };
	}
	const allowed = allowedEmails(env);
	const googleOn = !!env.GOOGLE_CLIENT_ID && allowed.length > 0;
	const accessOn = !!env.ACCESS_TEAM_DOMAIN && !!env.ACCESS_AUD && allowed.length > 0;
	if (!googleOn && !accessOn) return { ok: false, status: 503, reason: "auth-not-configured", canSignIn: false };

	// Cloudflare Access (if an Access app is in front and configured).
	const accessJwt = request.headers.get("Cf-Access-Jwt-Assertion");
	if (accessOn && accessJwt) {
		try {
			const c = await verifyAccessJwt(accessJwt, {
				aud: env.ACCESS_AUD!,
				issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
				jwks: await getJwks(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
			});
			if (c && allowed.includes(c.email)) return { ok: true, principal: { email: c.email, via: "access" } };
			if (c) return { ok: false, status: 403, reason: "not-allowed", canSignIn: googleOn };
		} catch {
			/* fall through to Google */
		}
	}

	// Google sign-in session cookie.
	if (googleOn) {
		const token = readCookie(request, SESSION_COOKIE);
		if (!token) return { ok: false, status: 401, reason: "no-session", canSignIn: true };
		let c: { email: string } | null = null;
		try {
			c = await verifyGoogleIdToken(token, { clientId: env.GOOGLE_CLIENT_ID!, jwks: await googleJwks() });
		} catch {
			return { ok: false, status: 503, reason: "google-keys-unavailable", canSignIn: true };
		}
		if (!c) return { ok: false, status: 401, reason: "session-invalid-or-expired", canSignIn: true };
		if (!allowed.includes(c.email)) return { ok: false, status: 403, reason: "not-allowed", canSignIn: true };
		return { ok: true, principal: { email: c.email, via: "google" } };
	}
	return { ok: false, status: 401, reason: "missing-token", canSignIn: false };
}
