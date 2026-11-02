/**
 * FamilyOS Worker: CallumOS + FinnleyOS (first slice of the NATICO platform).
 *
 * Request flow: security headers -> health check (no PHI) -> authenticate
 * (Cloudflare Access JWT, fail closed) -> hostname selects the person ->
 * that person's Durable Object handles /api/*; static shell otherwise.
 */
import { authenticate } from "./auth";
import { FIXTURES } from "./fixtures";
import { MAX_UPLOAD } from "./vault";
import type { Env } from "./types";

export { PersonVault } from "./vault";

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

function withHeaders(res: Response, extra: Record<string, string> = {}): Response {
	const r = new Response(res.body, res);
	for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
	return r;
}

const DENIED_HTML = (msg: string) =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Private</title></head><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><main style="max-width:28rem;text-align:center"><h1 style="font-size:1.5rem">Private family site</h1><p>${msg}</p></main></body></html>`;

export function personForHost(env: Env, hostname: string): string | null {
	try {
		const map = JSON.parse(env.HOST_PERSON_MAP || "{}") as Record<string, string>;
		return map[hostname.toLowerCase()] ?? null;
	} catch {
		return null;
	}
}

function people(env: Env): string[] {
	try {
		return [...new Set(Object.values(JSON.parse(env.HOST_PERSON_MAP || "{}") as Record<string, string>))];
	} catch {
		return [];
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		// Canonical lowercase host.
		if (url.hostname !== url.hostname.toLowerCase()) {
			url.hostname = url.hostname.toLowerCase();
			return withHeaders(Response.redirect(url.toString(), 301));
		}
		if (url.pathname === "/healthz") {
			return withHeaders(Response.json({ ok: true, version: env.APP_VERSION ?? "dev" }), { "cache-control": "no-store" });
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
				isApi ? Response.json({ error: msg }, { status: auth.status }) : new Response(DENIED_HTML(msg), { status: auth.status, headers: { "content-type": "text/html; charset=utf-8" } }),
				{ "cache-control": "no-store" },
			);
		}

		const person = personForHost(env, url.hostname);
		if (!person) return withHeaders(new Response("Not found", { status: 404 }));

		if (!isApi) {
			// Static shell contains no PHI; data loads from the authenticated API.
			return withHeaders(await env.ASSETS.fetch(request));
		}

		const nostore = { "cache-control": "no-store" };
		if (url.pathname === "/api/whoami") {
			return withHeaders(Response.json({ email: auth.principal.email, via: auth.principal.via, person }), nostore);
		}

		const stub = env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName(person));
		const sub = url.pathname.slice("/api".length);

		if (sub === "/dev/seed") {
			if (auth.principal.via !== "dev") return withHeaders(new Response("Not found", { status: 404 }));
			const fixture = FIXTURES[person];
			if (!fixture) return withHeaders(Response.json({ error: "No demo data for this person" }, { status: 404 }));
			return withHeaders(
				await stub.fetch("https://vault/dev/seed", {
					method: "POST",
					body: JSON.stringify(fixture),
					headers: { "x-actor": auth.principal.email, "content-type": "application/json" },
				}),
				nostore,
			);
		}
		if (sub === "/tick" || sub.startsWith("/sources/")) {
			// Internal / connector-only paths are not exposed to browsers.
			await request.body?.cancel();
			return withHeaders(new Response("Not found", { status: 404 }));
		}
		const len = Number(request.headers.get("content-length") || 0);
		if (len > MAX_UPLOAD + 1024) return withHeaders(Response.json({ error: "File is larger than 20 MB" }, { status: 413 }));

		const fwd = new Request(`https://vault${sub}${url.search}`, request);
		const headers = new Headers(fwd.headers);
		headers.set("x-actor", auth.principal.email);
		headers.set("x-route", sub);
		const res = await stub.fetch(new Request(fwd, { headers }));
		return withHeaders(res, nostore);
	},

	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		for (const person of people(env)) {
			const stub = env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName(person));
			ctx.waitUntil(
				stub
					.fetch("https://vault/tick", { method: "POST", headers: { "x-actor": "system:cron" } })
					.then((r) => console.log(JSON.stringify({ evt: "tick", status: r.status })))
					.catch(() => console.log(JSON.stringify({ evt: "tick.failed" }))),
			);
		}
	},
} satisfies ExportedHandler<Env>;
