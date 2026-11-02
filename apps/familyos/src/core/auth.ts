/**
 * Layer-2 authentication: verify the Cloudflare Access JWT on every request.
 * Cloudflare Access (layer 1) is configured in the dashboard; this code never
 * trusts that it is present. Fails closed when not configured.
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
	via: "access" | "dev";
}

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

export async function verifyAccessJwt(
	token: string,
	opts: { aud: string; issuer: string; jwks: Jwks; nowSec?: number },
): Promise<{ email: string } | null> {
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
	const key = await crypto.subtle.importKey(
		"jwk",
		{ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
	const ok = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		key,
		b64urlToBytes(parts[2]),
		new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
	);
	if (!ok) return null;
	const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
	const auds: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!auds.includes(opts.aud)) return null;
	if (payload.iss !== opts.issuer) return null;
	if (typeof payload.exp !== "number" || payload.exp < now) return null;
	if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
	if (typeof payload.email !== "string") return null;
	return { email: payload.email.toLowerCase() };
}

let jwksCache: { at: number; teamDomain: string; jwks: Jwks } | null = null;
async function getJwks(teamDomain: string): Promise<Jwks> {
	if (jwksCache && jwksCache.teamDomain === teamDomain && Date.now() - jwksCache.at < 10 * 60_000) return jwksCache.jwks;
	const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
	const jwks = (await res.json()) as Jwks;
	jwksCache = { at: Date.now(), teamDomain, jwks };
	return jwks;
}

export type AuthResult =
	| { ok: true; principal: Principal }
	| { ok: false; status: 401 | 403 | 503; reason: string };

function isLocalHost(hostname: string): boolean {
	return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1";
}

export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
	const url = new URL(request.url);
	// Development bypass: only on *.localhost AND only when DEV_AUTH_EMAIL is set (.dev.vars / tests).
	if (env.DEV_AUTH_EMAIL && isLocalHost(url.hostname)) {
		return { ok: true, principal: { email: env.DEV_AUTH_EMAIL.toLowerCase(), via: "dev" } };
	}
	if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
		return { ok: false, status: 503, reason: "access-not-configured" };
	}
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) return { ok: false, status: 401, reason: "missing-token" };
	let claims: { email: string } | null = null;
	try {
		claims = await verifyAccessJwt(token, {
			aud: env.ACCESS_AUD,
			issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
			jwks: await getJwks(env.ACCESS_TEAM_DOMAIN),
		});
	} catch {
		return { ok: false, status: 503, reason: "jwks-unavailable" };
	}
	if (!claims) return { ok: false, status: 401, reason: "invalid-token" };
	const allowed = (env.ALLOWED_EMAILS || "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (!allowed.includes(claims.email)) return { ok: false, status: 403, reason: "not-allowed" };
	return { ok: true, principal: { email: claims.email, via: "access" } };
}
