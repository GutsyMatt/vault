import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { computeAges, detectRedFlags, parseRapidLog, torontoLocalToUtcIso } from "../src/lib";
import { verifyAccessJwt } from "../src/auth";
import type { PersonVault } from "../src/vault";

const C = "http://callum.localhost";
const F = "http://finnley.localhost";
const j = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const profile = { display_name: "Test A", birth_date: "2026-06-16", ga_weeks: 33, ga_days: 4 };

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
		expect(await r.json()).toEqual({ ok: true, version: "0.1.0" });
	});

	it("security headers are set", async () => {
		const r = await SELF.fetch(`${C}/api/summary`);
		expect(r.headers.get("x-frame-options")).toBe("DENY");
		expect(r.headers.get("x-robots-tag")).toContain("noindex");
		expect(r.headers.get("cache-control")).toBe("no-store");
		await r.arrayBuffer();
	});

	it("dev seed route is not reachable on production hosts", async () => {
		const r = await SELF.fetch("https://callum.libbyhd.org/api/dev/seed", j({}));
		expect(r.status).not.toBe(201);
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
	it("corrected age for 33w4d is chronological minus 6w3d", () => {
		const a = computeAges("2026-06-16", 33, 4, Date.parse("2026-11-02T15:00:00Z"));
		expect(a.chronologicalDays).toBe(139);
		expect(a.correctedDays).toBe(139 - 45);
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
