/**
 * FamilyOS Worker (LibbyHD → FamilyOS).
 *
 *   familyos.libbyhd.org  → household (parent) view: both children side by side
 *   callum.libbyhd.org    → CallumOS  (one person's record)
 *   finnley.libbyhd.org   → FinnleyOS (one person's record)
 *
 * Request flow: security headers → health check (no PHI) → authenticate
 * (Cloudflare Access JWT, fail closed) → hostname selects person or household →
 * that person's Durable Object handles /api/*; static shell otherwise.
 */
import { authenticate } from "./core/auth";
import { MAX_UPLOAD } from "./storage/person-vault";
import type { Env } from "./types";

export { PersonVault } from "./storage/person-vault";

const SECURITY_HEADERS: Record<string, string> = {
	"content-security-policy":
		"default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
	"x-frame-options": "DENY",
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
	"permissions-policy": "camera=(), geolocation=(), microphone=(self)",
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"x-robots-tag": "noindex, nofollow",
};
const NOSTORE = { "cache-control": "no-store" };

function withHeaders(res: Response, extra: Record<string, string> = {}): Response {
	const r = new Response(res.body, res);
	for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
	return r;
}

const DENIED_HTML = (msg: string) =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Private</title></head><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><main style="max-width:28rem;text-align:center"><h1 style="font-size:1.5rem">Private family site</h1><p>${msg}</p></main></body></html>`;

interface HouseholdConfig {
	hosts: string[];
	members: { person: string; host: string }[]; // display order: left → right
}

export function personForHost(env: Env, hostname: string): string | null {
	try {
		const map = JSON.parse(env.HOST_PERSON_MAP || "{}") as Record<string, string>;
		return map[hostname.toLowerCase()] ?? null;
	} catch {
		return null;
	}
}
function household(env: Env): HouseholdConfig {
	try {
		const h = JSON.parse(env.HOUSEHOLD || "{}");
		return { hosts: (h.hosts ?? []).map((x: string) => x.toLowerCase()), members: h.members ?? [] };
	} catch {
		return { hosts: [], members: [] };
	}
}
function people(env: Env): string[] {
	try {
		return [...new Set(Object.values(JSON.parse(env.HOST_PERSON_MAP || "{}") as Record<string, string>))];
	} catch {
		return [];
	}
}
const vault = (env: Env, person: string) => env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName(person));

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.hostname !== url.hostname.toLowerCase()) {
			url.hostname = url.hostname.toLowerCase();
			return withHeaders(Response.redirect(url.toString(), 301));
		}
		if (url.pathname === "/healthz") {
			return withHeaders(Response.json({ ok: true, version: env.APP_VERSION ?? "dev" }), NOSTORE);
		}

		const isApi = url.pathname.startsWith("/api/");
		const auth = await authenticate(request, env);
		if (!auth.ok) {
			const msg =
				auth.status === 503
					? "Sign-in is not configured yet, so this site is locked."
					: auth.status === 403
						? "This account does not have access."
						: "Please sign in to continue.";
			console.log(JSON.stringify({ evt: "auth.denied", status: auth.status, reason: auth.reason })); // no PHI
			await request.body?.cancel();
			return withHeaders(
				isApi
					? Response.json({ error: msg }, { status: auth.status })
					: new Response(DENIED_HTML(msg), { status: auth.status, headers: { "content-type": "text/html; charset=utf-8" } }),
				NOSTORE,
			);
		}

		const hh = household(env);
		const isHousehold = hh.hosts.includes(url.hostname);
		const person = isHousehold ? null : personForHost(env, url.hostname);
		if (!isHousehold && !person) {
			await request.body?.cancel();
			return withHeaders(new Response("Not found", { status: 404 }));
		}

		// Static shell contains no PHI; data loads from the authenticated API.
		if (!isApi) return withHeaders(await env.ASSETS.fetch(request));

		if (url.pathname === "/api/whoami") {
			return withHeaders(
				Response.json({ email: auth.principal.email, via: auth.principal.via, mode: isHousehold ? "household" : "person", person }),
				NOSTORE,
			);
		}

		if (isHousehold) {
			// The household host can only read each member's compact card; it has no write or per-record routes.
			if (url.pathname !== "/api/household" || request.method !== "GET") {
				await request.body?.cancel();
				return withHeaders(new Response("Not found", { status: 404 }));
			}
			const members = await Promise.all(
				hh.members.map(async (m) => {
					try {
						const r = await vault(env, m.person).fetch("https://vault/card", { headers: { "x-actor": auth.principal.email, "x-route": "/card" } });
						if (!r.ok) throw new Error(String(r.status));
						return { person: m.person, host: m.host, ok: true, card: await r.json() };
					} catch {
						return { person: m.person, host: m.host, ok: false, card: null }; // shown as "could not load", never as empty
					}
				}),
			);
			return withHeaders(Response.json({ generated_at: new Date().toISOString(), members }), NOSTORE);
		}

		const sub = url.pathname.slice("/api".length);
		if (sub === "/tick" || sub === "/card" || sub.startsWith("/sources/")) {
			// Internal / connector-only paths are not exposed to browsers.
			await request.body?.cancel();
			return withHeaders(new Response("Not found", { status: 404 }));
		}
		const len = Number(request.headers.get("content-length") || 0);
		if (len > MAX_UPLOAD + 1024) {
			await request.body?.cancel();
			return withHeaders(Response.json({ error: "File is larger than 20 MB" }, { status: 413 }));
		}
		const fwd = new Request(`https://vault${sub}${url.search}`, request);
		const headers = new Headers(fwd.headers);
		headers.set("x-actor", auth.principal.email);
		headers.set("x-route", sub);
		const res = await vault(env, person!).fetch(new Request(fwd, { headers }));
		return withHeaders(res, NOSTORE);
	},

	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		for (const person of people(env)) {
			ctx.waitUntil(
				vault(env, person)
					.fetch("https://vault/tick", { method: "POST", headers: { "x-actor": "system:cron" } })
					.then((r) => console.log(JSON.stringify({ evt: "tick", status: r.status })))
					.catch(() => console.log(JSON.stringify({ evt: "tick.failed" }))),
			);
		}
	},
} satisfies ExportedHandler<Env>;
