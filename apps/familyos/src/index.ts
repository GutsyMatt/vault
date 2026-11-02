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
import { SESSION_COOKIE, allowedEmails, authenticate, googleJwks, verifyGoogleIdToken } from "./core/auth";
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
	for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
		// A response that already set a stricter, specific CSP (e.g. a stored letter) keeps it.
		if (k === "content-security-policy" && res.headers.has(k) && !(k in extra)) continue;
		r.headers.set(k, v);
	}
	return r;
}

const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SIGNIN_HEADERS = {
	"content-security-policy":
		"default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'none'",
	"cross-origin-opener-policy": "same-origin-allow-popups",
};

/** Google sign-in page. Contains no PHI. Google's script is allowed only on this page. */
export function signInPage(clientId: string, msg: string): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>FamilyOS · Sign in</title><link rel="stylesheet" href="/app.css"><link rel="icon" href="/icon.svg"></head>
<body><main class="signin"><h1>FamilyOS</h1><p>${escHtml(msg)}</p><div id="g" data-client-id="${escHtml(clientId)}"></div><p id="err" class="alert" role="alert" hidden></p><p class="small muted">Private family site. Only approved Google accounts can open it.</p></main>
<script src="https://accounts.google.com/gsi/client" async></script><script src="/signin.js"></script></body></html>`;
	return new Response(html, {
		status: 401,
		headers: {
			"content-type": "text/html; charset=utf-8",
			...SIGNIN_HEADERS,
			"cache-control": "no-store",
		},
	});
}

/** Files the sign-in page needs before sign-in. Static, no PHI. */
const PUBLIC_ASSETS = new Set(["/signin.js", "/app.css", "/icon.svg", "/manifest.webmanifest", "/robots.txt"]);

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
async function googleSignIn(request: Request, env: Env): Promise<Response> {
	const allowed = allowedEmails(env);
	if (!env.GOOGLE_CLIENT_ID || !allowed.length) return Response.json({ error: "Google sign-in is not configured" }, { status: 503 });
	let credential = "";
	try {
		credential = String(((await request.json()) as any)?.credential || "");
	} catch {
		/* handled below */
	}
	if (!credential) return Response.json({ error: "Missing credential" }, { status: 400 });
	let id: { email: string; exp: number } | null = null;
	try {
		id = await verifyGoogleIdToken(credential, { clientId: env.GOOGLE_CLIENT_ID, jwks: await googleJwks() });
	} catch {
		return Response.json({ error: "Could not reach Google to check the sign-in. Try again." }, { status: 503 });
	}
	if (!id) return Response.json({ error: "Google sign-in could not be verified" }, { status: 401 });
	if (!allowed.includes(id.email)) {
		console.log(JSON.stringify({ evt: "auth.google.not_allowed" })); // no email logged
		return Response.json({ error: "This Google account isn't approved for this site." }, { status: 403 });
	}
	const maxAge = Math.max(0, id.exp - Math.floor(Date.now() / 1000));
	return new Response(null, { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=${credential}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` } });
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

		if (PUBLIC_ASSETS.has(url.pathname) && request.method === "GET") return withHeaders(await env.ASSETS.fetch(request));

		// Cross-site requests may never change anything.
		const origin = request.headers.get("origin");
		if (request.method !== "GET" && request.method !== "HEAD" && origin && origin !== url.origin) {
			await request.body?.cancel();
			return withHeaders(Response.json({ error: "Cross-site request refused" }, { status: 403 }));
		}

		if (url.pathname === "/auth/google" && request.method === "POST") return withHeaders(await googleSignIn(request, env), NOSTORE);
		if (url.pathname === "/auth/signout" && request.method === "POST") {
			return withHeaders(new Response(null, { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` } }), NOSTORE);
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
			if (!isApi && auth.canSignIn && env.GOOGLE_CLIENT_ID) {
				const why =
					auth.reason === "not-allowed"
						? "That Google account isn't approved for this site. Sign in with an approved account."
						: auth.reason === "session-invalid-or-expired"
							? "Your sign-in expired. Please sign in again."
							: "Sign in with Google to continue.";
				return withHeaders(signInPage(env.GOOGLE_CLIENT_ID, why), SIGNIN_HEADERS);
			}
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
