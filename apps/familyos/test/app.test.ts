import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { torontoLocalToUtcIso } from "../src/core/util";
import { computeAges, detectRedFlags, parseRapidLog } from "../src/medical/clinical";
import { verifyAccessJwt, verifyGoogleIdToken } from "../src/core/auth";
import { signInPage } from "../src/index";
import { isGooglePhotoUrl, weekOfLifeForDate } from "../src/family/story";
import type { PersonVault } from "../src/storage/person-vault";

const C = "http://callum.localhost";
const F = "http://finnley.localhost";
const j = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const profile = { display_name: "Test A", birth_date: "2026-06-10", ga_weeks: 34, ga_days: 0 }; // synthetic

async function setup(host: string, name = "Test") {
	const r = await SELF.fetch(`${host}/api/profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...profile, display_name: name }) });
	expect(r.status).toBe(201);
}

describe("1. person isolation", () => {
	it("an id created on Callum's host is 404 on Finnley's host, for every id-bearing route", async () => {
		await setup(C, "Callum test");
		await setup(F, "Finnley test");
		const issue = (await (await SELF.fetch(`${C}/api/issues`, j({ title: "Callum-only issue" }))).json()) as any;
		const appt = (await (await SELF.fetch(`${C}/api/appointments`, j({ title: "Visit", starts_local: "2030-01-10T10:00" }))).json()) as any;
		const doc = (await (await SELF.fetch(`${C}/api/documents?filename=a.txt`, { method: "POST", headers: { "content-type": "text/plain" }, body: "synthetic" })).json()) as any;
		for (const [method, path, body] of [
			["GET", `/api/issues/${issue.id}`, undefined],
			["POST", `/api/issues/${issue.id}/status`, { status: "raised" }],
			["GET", `/api/appointments/${appt.id}/brief`, undefined],
			["GET", `/api/documents/${doc.id}/raw`, undefined],
		] as const) {
			const r = await SELF.fetch(`${F}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
			expect(r.status, `${method} ${path}`).toBe(404);
			await r.arrayBuffer();
		}
		const fs = (await (await SELF.fetch(`${F}/api/summary`)).json()) as any;
		expect(JSON.stringify(fs)).not.toContain("Callum-only issue");
		expect(fs.profile.display_name).toBe("Finnley test");
	});

	it("an unknown hostname gets 404, not a default person", async () => {
		const r = await SELF.fetch("http://other.localhost/api/summary");
		expect(r.status).toBe(404);
	});
});

describe("10. authentication fails closed", () => {
	it("production host without Access configured is refused with no PHI", async () => {
		await setup(C, "SecretNameXYZ");
		const r = await SELF.fetch("https://callum.libbyhd.org/api/summary");
		expect(r.status).toBe(503);
		const t = await r.text();
		expect(t).not.toContain("SecretNameXYZ");
		const page = await SELF.fetch("https://callum.libbyhd.org/");
		expect(page.status).toBe(503);
		expect(await page.text()).not.toMatch(/Callum|Finnley/);
	});

	it("health check is public and contains no PHI", async () => {
		const r = await SELF.fetch("https://callum.libbyhd.org/healthz");
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ ok: true, version: "0.3.0" });
	});

	it("security headers are set", async () => {
		const r = await SELF.fetch(`${C}/api/summary`);
		expect(r.headers.get("x-frame-options")).toBe("DENY");
		expect(r.headers.get("x-robots-tag")).toContain("noindex");
		expect(r.headers.get("cache-control")).toBe("no-store");
		await r.arrayBuffer();
	});

	it("there is no demo-data route anywhere", async () => {
		const r = await SELF.fetch(`${C}/api/dev/seed`, j({}));
		expect(r.status).toBe(404);
		await r.arrayBuffer();
	});
});

describe("Access JWT verification", () => {
	it("accepts a valid token and rejects wrong aud, expired, or tampered tokens", async () => {
		const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
		const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
		const jwks = { keys: [{ ...pub, kid: "k1" }] };
		const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
		const now = Math.floor(Date.now() / 1000);
		const sign = async (payload: object) => {
			const head = `${b64({ alg: "RS256", kid: "k1" })}.${b64(payload)}`;
			const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(head)));
			return `${head}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
		};
		const opts = { aud: "AUD1", issuer: "https://team.cloudflareaccess.com", jwks };
		const good = await sign({ aud: ["AUD1"], iss: opts.issuer, exp: now + 60, email: "Parent@Example.test" });
		expect(await verifyAccessJwt(good, opts)).toEqual({ email: "parent@example.test" });
		expect(await verifyAccessJwt(await sign({ aud: ["OTHER"], iss: opts.issuer, exp: now + 60, email: "a@b.c" }), opts)).toBeNull();
		expect(await verifyAccessJwt(await sign({ aud: ["AUD1"], iss: opts.issuer, exp: now - 10, email: "a@b.c" }), opts)).toBeNull();
		expect(await verifyAccessJwt(good.slice(0, -4) + "AAAA", opts)).toBeNull();
	});
});

describe("2. medication conflict (never picks a dose)", () => {
	it("two strengths of the same medicine create a CONFLICT that needs evidence to resolve", async () => {
		await setup(F);
		const a = (await (await SELF.fetch(`${F}/api/medications`, j({ name: "Med X", strength: "1 mg/mL", verification: "PARENT_REPORT" }))).json()) as any;
		const b = (await (await SELF.fetch(`${F}/api/medications`, j({ name: "med x", strength: "5 mg/mL", verification: "EXTRACTED" }))).json()) as any;
		expect(a.conflict_id).toBeNull();
		expect(b.conflict_id).toBeTruthy();
		let s = (await (await SELF.fetch(`${F}/api/summary`)).json()) as any;
		expect(s.conflicts).toHaveLength(1);
		expect(s.conflicts[0].description).toContain("Do not calculate a dose");
		expect(s.medications.every((m: any) => m.in_conflict && m.status === "unverified")).toBe(true);
		const noEv = await SELF.fetch(`${F}/api/conflicts/${b.conflict_id}/resolve`, j({ chosen_id: b.id }));
		expect(noEv.status).toBe(400);
		await noEv.arrayBuffer();
		const ok = await SELF.fetch(`${F}/api/conflicts/${b.conflict_id}/resolve`, j({ chosen_id: b.id, evidence: "Bottle label checked (synthetic)" }));
		expect(ok.status).toBe(201);
		s = (await (await SELF.fetch(`${F}/api/summary`)).json()) as any;
		expect(s.conflicts).toHaveLength(0);
		const byId = Object.fromEntries(s.medications.map((m: any) => [m.id, m]));
		expect(byId[b.id].status).toBe("verified");
		expect(byId[a.id].status).toBe("historical"); // kept, not deleted
	});
});

describe("4. appointment -> immediate brief, and scheduled briefs", () => {
	it("a late-discovered appointment gets a brief immediately, containing open issues", async () => {
		await setup(C);
		await SELF.fetch(`${C}/api/issues`, j({ title: "Ask about screening result", next_action: "Request copy" }));
		const soon = new Date(Date.now() + 2 * 86400000);
		const local = `${soon.toISOString().slice(0, 10)}T10:30`;
		const r = (await (await SELF.fetch(`${C}/api/appointments`, j({ title: "Vaccinations", starts_local: local, specialty: "GP" }))).json()) as any;
		expect(r.brief_trigger).toBe("late-discovery");
		const brief = (await (await SELF.fetch(`${C}/api/appointments/${r.id}/brief`)).json()) as any;
		const flat = JSON.stringify(brief.content.sections);
		expect(flat).toContain("Ask about screening result");
		expect(brief.history.length).toBeGreaterThanOrEqual(2);
	});

	it("the scheduled tick creates T-48h briefs once and records an automation run", async () => {
		await setup(C);
		const t = new Date(Date.now() + 30 * 3600000);
		const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t).replace(" ", "T");
		await SELF.fetch(`${C}/api/appointments`, j({ title: "Cardiology", starts_local: local }));
		const stub = env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName("callum"));
		const first = await runInDurableObject(stub, (o: PersonVault) => o.tick(Date.now()));
		expect(first.briefs_created).toEqual(expect.arrayContaining(["T-7d", "T-48h"]));
		const second = await runInDurableObject(stub, (o: PersonVault) => o.tick(Date.now()));
		expect(second.briefs_created).toEqual([]);
		const s = (await (await SELF.fetch(`${C}/api/summary`)).json()) as any;
		expect(s.last_automation_run.ok).toBe(1);
	});
});

describe("5. degraded sources are never shown as empty", () => {
	it("an unconnected calendar shows NOT CONNECTED; a failing one shows DEGRADED", async () => {
		await setup(C);
		let s = (await (await SELF.fetch(`${C}/api/summary`)).json()) as any;
		const cal = s.sources.find((x: any) => x.kind === "calendar");
		expect(cal.status).toBe("NOT CONNECTED");
		expect(cal.detail).toContain("Nothing from this source is being picked up");
		const stub = env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName("callum"));
		await stub.fetch(`https://vault/sources/${cal.id}/report`, j({ ok: false, detail: "token revoked" }));
		s = (await (await SELF.fetch(`${C}/api/summary`)).json()) as any;
		expect(s.sources.find((x: any) => x.kind === "calendar").status).toBe("DEGRADED");
	});

	it("browsers cannot call connector/report or tick paths", async () => {
		const r = await SELF.fetch(`${C}/api/tick`, j({}));
		expect(r.status).toBe(404);
		await r.arrayBuffer();
	});
});

describe("6. originals: hashed, deduplicated, byte-identical", () => {
	it("same file twice is one original with two receipts; a revised file is a second original", async () => {
		await setup(F);
		const up = async (body: string) => (await (await SELF.fetch(`${F}/api/documents?filename=r.txt`, { method: "POST", headers: { "content-type": "text/plain" }, body })).json()) as any;
		const a = await up("report v1 (synthetic)");
		const b = await up("report v1 (synthetic)");
		const c = await up("report v2 (synthetic)");
		expect(b.duplicate).toBe(true);
		expect(b.id).toBe(a.id);
		expect(c.id).not.toBe(a.id);
		const raw = await SELF.fetch(`${F}/api/documents/${a.id}/raw`);
		expect(await raw.text()).toBe("report v1 (synthetic)");
		expect(raw.headers.get("x-content-sha256")).toBe(a.sha256);
	});

	it("rejects executables", async () => {
		await setup(F);
		const r = await SELF.fetch(`${F}/api/documents?filename=x.exe`, { method: "POST", headers: { "content-type": "application/pdf" }, body: "MZ\x90\x00" });
		expect(r.status).toBe(415);
		await r.arrayBuffer();
	});
});

describe("7. closed loop: no silent progress", () => {
	it("moving an issue past 'raised' requires evidence; history is preserved", async () => {
		await setup(F);
		const { id } = (await (await SELF.fetch(`${F}/api/issues`, j({ title: "Swallow study referral" }))).json()) as any;
		const bad = await SELF.fetch(`${F}/api/issues/${id}/status`, j({ status: "closed" }));
		expect(bad.status).toBe(422);
		await bad.arrayBuffer();
		await SELF.fetch(`${F}/api/issues/${id}/status`, j({ status: "sent", evidence: "Referral faxed per clinic (synthetic)" }));
		const done = (await (await SELF.fetch(`${F}/api/issues/${id}/status`, j({ status: "closed", evidence: "Study completed (synthetic)" }))).json()) as any;
		expect(done.history.map((h: any) => h.status)).toEqual(["raised", "sent", "closed"]);
	});
});

describe("rapid log + safety", () => {
	it("parses a one-line feed note and stores it as a parent report", async () => {
		await setup(F);
		const r = (await (await SELF.fetch(`${F}/api/log`, j({ text: "Bottle 60 ml took 45 min, milk out his nose" }))).json()) as any;
		expect(r.verification).toBe("PARENT_REPORT");
		expect(r.parsed).toMatchObject({ category: "feed", durationMin: 45, volumeMl: 60 });
		expect(r.parsed.tags).toContain("nasal-regurgitation");
		expect(r.guidance).toBeNull();
	});
	it("urgent phrases return seek-care guidance, never reassurance", async () => {
		await setup(F);
		const r = (await (await SELF.fetch(`${F}/api/log`, j({ text: "his lips turned blue during the feed" }))).json()) as any;
		expect(r.red_flags.length).toBeGreaterThan(0);
		expect(r.guidance).toContain("911");
	});
	it("red flag rules", () => {
		expect(detectRedFlags("heart racing, HR 260")).toContain("fast heart rate");
		expect(detectRedFlags("no wet diaper since morning")).toContain("possible dehydration");
		expect(detectRedFlags("good feed, slept well")).toEqual([]);
	});
	it("parser units", () => {
		expect(parseRapidLog("2 oz in 1 hour 5 min").volumeMl).toBe(59);
		expect(parseRapidLog("2 oz in 1 hour 5 min").durationMin).toBe(65);
		expect(parseRapidLog("Wet diaper").category).toBe("diaper");
	});
});

describe("8. time and corrected age", () => {
	it("corrected age for 34w0d is chronological minus 6w0d", () => {
		const a = computeAges("2026-06-10", 34, 0, Date.parse("2026-11-02T15:00:00Z"));
		expect(a.chronologicalDays).toBe(145);
		expect(a.correctedDays).toBe(145 - 42);
	});
	it("Toronto wall-clock times convert correctly across DST changes", () => {
		expect(torontoLocalToUtcIso("2026-10-31T10:00")).toBe("2026-10-31T14:00:00.000Z"); // EDT
		expect(torontoLocalToUtcIso("2026-11-02T10:00")).toBe("2026-11-02T15:00:00.000Z"); // EST
		expect(torontoLocalToUtcIso("2027-03-15T10:00")).toBe("2027-03-15T14:00:00.000Z"); // EDT again
	});
});

describe("export", () => {
	it("full export is available to the signed-in parent and scoped to one person", async () => {
		await setup(C, "OnlyCallum");
		await setup(F, "OnlyFinnley");
		const e = (await (await SELF.fetch(`${C}/api/export`)).json()) as any;
		expect(e.format).toBe("familyos-person-export/v1");
		expect(JSON.stringify(e)).toContain("OnlyCallum");
		expect(JSON.stringify(e)).not.toContain("OnlyFinnley");
	});
});

describe("household (parent) view: familyos host", () => {
	const H = "http://familyos.localhost";
	it("shows each child's compact card, in left-to-right order, labelled per child", async () => {
		await setup(C, "HH-Callum");
		await setup(F, "HH-Finnley");
		await SELF.fetch(`${F}/api/issues`, j({ title: "Overdue thing", due_date: "2020-01-01" }));
		const h = (await (await SELF.fetch(`${H}/api/household`)).json()) as any;
		expect(h.members.map((m: any) => m.person)).toEqual(["callum", "finnley"]);
		expect(h.members[0].card.profile.display_name).toBe("HH-Callum");
		expect(h.members[1].card.profile.display_name).toBe("HH-Finnley");
		expect(h.members[1].card.overdue.map((o: any) => o.title)).toContain("Overdue thing");
		expect(JSON.stringify(h.members[0].card)).not.toContain("Overdue thing");
	});
	it("cannot write or reach per-record routes", async () => {
		for (const [m, p] of [["POST", "/api/log"], ["GET", "/api/summary"], ["GET", "/api/export"], ["POST", "/api/household"]] as const) {
			const r = await SELF.fetch(`${H}${p}`, { method: m, headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
			expect(r.status, `${m} ${p}`).toBe(404);
			await r.arrayBuffer();
		}
	});
	it("is locked on the production host without sign-in", async () => {
		const r = await SELF.fetch("https://familyos.libbyhd.org/api/household");
		expect(r.status).toBe(503);
		await r.arrayBuffer();
	});
});

describe("Google sign-in (same client as lifeos.libbyhd.org)", () => {
	async function keypair() {
		const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
		const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
		const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
		const sign = async (payload: object) => {
			const head = `${b64({ alg: "RS256", kid: "g1" })}.${b64(payload)}`;
			const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(head)));
			return `${head}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
		};
		return { jwks: { keys: [{ ...pub, kid: "g1" }] }, sign };
	}
	it("accepts a valid Google ID token and rejects wrong client, unverified email, or expiry", async () => {
		const { jwks, sign } = await keypair();
		const now = Math.floor(Date.now() / 1000);
		const base = { iss: "https://accounts.google.com", aud: "CLIENT", email: "Parent@Example.test", email_verified: true, exp: now + 3600 };
		expect(await verifyGoogleIdToken(await sign(base), { clientId: "CLIENT", jwks })).toMatchObject({ email: "parent@example.test" });
		expect(await verifyGoogleIdToken(await sign({ ...base, aud: "OTHER" }), { clientId: "CLIENT", jwks })).toBeNull();
		expect(await verifyGoogleIdToken(await sign({ ...base, email_verified: false }), { clientId: "CLIENT", jwks })).toBeNull();
		expect(await verifyGoogleIdToken(await sign({ ...base, exp: now - 5 }), { clientId: "CLIENT", jwks })).toBeNull();
		expect(await verifyGoogleIdToken(await sign({ ...base, iss: "https://evil.example" }), { clientId: "CLIENT", jwks })).toBeNull();
	});
	it("sign-in page contains no PHI, escapes the client id, and only allows Google's script", async () => {
		const r = signInPage('id"><script>x</script>', "Sign in with Google to continue.");
		const html = await r.text();
		expect(r.status).toBe(401);
		expect(html).not.toContain("<script>x</script>");
		expect(html).not.toMatch(/Callum|Finnley/);
		expect(r.headers.get("content-security-policy")).toContain("https://accounts.google.com/gsi/client");
	});
	it("sign-in assets are reachable before sign-in; app data is not", async () => {
		const js = await SELF.fetch("https://callum.libbyhd.org/signin.js");
		expect(js.status).toBe(200);
		await js.arrayBuffer();
		const api = await SELF.fetch("https://callum.libbyhd.org/api/summary");
		expect(api.status).toBe(503);
		await api.arrayBuffer();
	});
	it("cross-site writes are refused", async () => {
		const r = await SELF.fetch(`${C}/api/log`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ text: "x" }) });
		expect(r.status).toBe(403);
		await r.arrayBuffer();
	});
});

describe("keepsake letters (his own story)", () => {
	it("builds a letter from parent letters, firsts and kept moments only; never medical by default", async () => {
		await setup(C, "KeepA");
		await SELF.fetch(`${C}/api/letters`, j({ signed_as: "Dad", title: "Hello", body: "Synthetic test letter body" }));
		await SELF.fetch(`${C}/api/log`, j({ text: "Smiled for the first time" })); // milestone
		const kept = (await (await SELF.fetch(`${C}/api/log`, j({ text: "Synthetic bath-time moment" }))).json()) as any;
		await SELF.fetch(`${C}/api/log`, j({ text: "Bottle 60 ml took 45 min" })); // not kept
		await SELF.fetch(`${C}/api/keep`, j({ item_id: kept.id }));
		const r = (await (await SELF.fetch(`${C}/api/keepsakes/compile`, j({}))).json()) as any;
		expect(r.delivery.status).toBe("NOT_SENT_NO_ADDRESS");
		const html = await (await SELF.fetch(`${C}/api/keepsakes/${r.id}`)).text();
		expect(html).toContain("Synthetic test letter body");
		expect(html).toContain("Smiled for the first time");
		expect(html).toContain("Synthetic bath-time moment");
		expect(html).not.toContain("Bottle 60 ml");
		expect(html).toContain("Dear KeepA");
	});
	it("records 'not connected' delivery when an address is set, and keeps the letter", async () => {
		await setup(F, "KeepB");
		const put = await SELF.fetch(`${F}/api/settings/keepsake-email`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "child@example.test" }) });
		expect(put.status).toBe(201);
		const r = (await (await SELF.fetch(`${F}/api/keepsakes/compile`, j({}))).json()) as any;
		expect(r.delivery.status).toBe("NOT_SENT_DELIVERY_NOT_CONNECTED");
		const s = (await (await SELF.fetch(`${F}/api/summary`)).json()) as any;
		expect(s.keepsake.keepsakes[0].delivery.status).toBe("NOT_SENT_DELIVERY_NOT_CONNECTED");
	});
	it("the monthly letter is written once on the 1st, for the previous month", async () => {
		await setup(C, "KeepA");
		const stub = env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName("callum"));
		const first = Date.parse("2026-12-01T15:00:00Z"); // 10:00 Toronto, Dec 1
		const a = await runInDurableObject(stub, (o: PersonVault) => o.tick(first));
		const b = await runInDurableObject(stub, (o: PersonVault) => o.tick(first + 3600000));
		expect(a.keepsake).toBeTruthy();
		expect(b.keepsake).toBeNull();
		const s = (await (await SELF.fetch(`${C}/api/summary`)).json()) as any;
		expect(s.keepsake.keepsakes.some((k: any) => k.period === "2026-11" && k.trigger === "monthly")).toBe(true);
	});
	it("letters stay with their own child", async () => {
		await setup(C, "KeepA");
		await setup(F, "KeepB");
		await SELF.fetch(`${C}/api/letters`, j({ signed_as: "Mom", body: "Only-for-A synthetic" }));
		const fs = (await (await SELF.fetch(`${F}/api/summary`)).json()) as any;
		expect(JSON.stringify(fs.keepsake)).not.toContain("Only-for-A");
	});
});

describe("photos and his story by week", () => {
	it("week of life: birth day is week 1, day 7 is week 2", () => {
		expect(weekOfLifeForDate("2026-06-10", "2026-06-10").week).toBe(1);
		expect(weekOfLifeForDate("2026-06-10", "2026-06-16").week).toBe(1);
		expect(weekOfLifeForDate("2026-06-10", "2026-06-17")).toMatchObject({ week: 2, start: "2026-06-17", end: "2026-06-23" });
		expect(weekOfLifeForDate("2026-06-10", "2026-06-01").week).toBeLessThan(1);
	});
	it("only Google photo hosts may be fetched", () => {
		expect(isGooglePhotoUrl("https://lh3.googleusercontent.com/abc")).toBe(true);
		expect(isGooglePhotoUrl("https://evil.example/abc")).toBe(false);
		expect(isGooglePhotoUrl("http://lh3.googleusercontent.com/abc")).toBe(false);
		expect(isGooglePhotoUrl("https://googleusercontent.com.evil.example/x")).toBe(false);
	});
	it("imports picked photos into one child, dedupes, never fetches other hosts, and groups by week", async () => {
		await setup(C, "PhotoA");
		const stub = env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName("callum"));
		const fetched: string[] = [];
		const fake = (async (url: string) => {
			fetched.push(url);
			return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00, url.includes("w480") ? 1 : 2]));
		}) as unknown as typeof fetch;
		const items = [
			{ id: "g1", createTime: "2026-06-12T15:00:00Z", baseUrl: "https://lh3.googleusercontent.com/p1" },
			{ id: "g2", createTime: "2026-06-24T15:00:00Z", baseUrl: "https://evil.example/p2" },
		];
		const r1 = await runInDurableObject(stub, (o: PersonVault) => o.importPhotos(items, "tok-synthetic-123", "t@x", fake));
		expect(r1.results.map((x) => x.status)).toEqual(["saved", "rejected"]);
		expect(fetched.every((u) => u.startsWith("https://lh3.googleusercontent.com/"))).toBe(true);
		const r2 = await runInDurableObject(stub, (o: PersonVault) => o.importPhotos([items[0]], "tok-synthetic-123", "t@x", fake));
		expect(r2.results[0].status).toBe("already-saved");
		await SELF.fetch(`${C}/api/life-events`, j({ on_date: "2026-06-14", title: "Synthetic event" }));
		const st = (await (await SELF.fetch(`${C}/api/story`)).json()) as any;
		const w1 = st.weeks.find((w: any) => w.week === 1);
		expect(w1.photos.length).toBe(1);
		expect(w1.events[0].title).toBe("Synthetic event");
		const img = await SELF.fetch(`${C}/api/photos/${w1.photos[0].id}/image`);
		expect(img.status).toBe(200);
		expect(new Uint8Array(await img.arrayBuffer())[4]).toBe(2);
		const other = await SELF.fetch(`${F}/api/photos/${w1.photos[0].id}/thumb`);
		expect(other.status).toBe(404);
		await other.arrayBuffer();
	});
	it("photo import refuses oversized batches", async () => {
		await setup(C, "PhotoA");
		const r = await SELF.fetch(`${C}/api/photos/import`, j({ token: "tok-synthetic-123", items: new Array(11).fill({ id: "x", baseUrl: "https://lh3.googleusercontent.com/x" }) }));
		expect(r.status).toBe(400);
		await r.arrayBuffer();
	});
});

describe("setup is pre-filled from presentation settings", () => {
	it("whoami returns this child's name, label and side", async () => {
		const w = (await (await SELF.fetch(`${C}/api/whoami`)).json()) as any;
		expect(w.presentation).toMatchObject({ name: "Callum", label: "Baby A · LEFT", side: "left" });
	});
});
