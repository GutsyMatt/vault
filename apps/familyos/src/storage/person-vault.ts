/**
 * PersonVault: one Durable Object (SQLite) per person.
 *
 * Isolation by construction: the Worker picks the object from the request
 * hostname only, so an id belonging to another person simply does not exist
 * here (404). Clinical tables are append-only: there are no UPDATE or DELETE
 * statements on them anywhere in this file. Status changes, supersessions and
 * resolutions are new rows.
 */
import { DurableObject } from "cloudflare:workers";
import { formatToronto, sha256Hex, sniffMime, torontoDate, torontoLocalToUtcIso, ulid } from "../core/util";
import { buildKeepsake, periodLabel, previousPeriod } from "../family/keepsake";
import { isGooglePhotoUrl, weekOfLife, weekOfLifeForDate } from "../family/story";
import {
	EVIDENCE_REQUIRED,
	ISSUE_STATUSES,
	RED_FLAG_GUIDANCE,
	VERIFICATION,
	computeAges,
	detectRedFlags,
	parseRapidLog,
	type IssueStatus,
} from "../medical/clinical";
import type { Env } from "../types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_versions (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, text TEXT NOT NULL, category TEXT NOT NULL, duration_min INTEGER, volume_ml INTEGER, tags TEXT NOT NULL, red_flags TEXT NOT NULL, verification TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, starts_at TEXT NOT NULL, title TEXT NOT NULL, provider TEXT, specialty TEXT, location TEXT, details_verified INTEGER NOT NULL, discovered_via TEXT NOT NULL, source_note TEXT);
CREATE TABLE IF NOT EXISTS briefs (id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL, created_at TEXT NOT NULL, trigger TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, title TEXT NOT NULL, specialty TEXT, owner TEXT, first_reported TEXT, source_note TEXT, verification TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issue_status_events (id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT, next_action TEXT, due_date TEXT);
CREATE TABLE IF NOT EXISTS medications (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, name TEXT NOT NULL, form TEXT, strength TEXT, dose_text TEXT, frequency TEXT, prescriber TEXT, verification TEXT NOT NULL, source_note TEXT, document_id TEXT);
CREATE TABLE IF NOT EXISTS med_status_events (id TEXT PRIMARY KEY, med_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT);
CREATE TABLE IF NOT EXISTS conflicts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, subject TEXT NOT NULL, item_ids TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conflict_resolutions (id TEXT PRIMARY KEY, conflict_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, chosen_id TEXT NOT NULL, evidence TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, received_at TEXT NOT NULL, actor TEXT NOT NULL, verification TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS doc_chunks (doc_id TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (doc_id, idx));
CREATE TABLE IF NOT EXISTS drive_imports (source_id TEXT PRIMARY KEY, source_hash TEXT NOT NULL, document_id TEXT NOT NULL, imported_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS doc_receipts (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, filename TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, expected_interval_min INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_status_events (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, job TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, ok INTEGER, detail TEXT);
CREATE TABLE IF NOT EXISTS letters (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, signed_as TEXT NOT NULL, title TEXT, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keepsake_marks (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS keepsakes (id TEXT PRIMARY KEY, period TEXT NOT NULL, created_at TEXT NOT NULL, trigger TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL, html TEXT NOT NULL, counts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keepsake_deliveries (id TEXT PRIMARY KEY, keepsake_id TEXT NOT NULL, at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, key TEXT NOT NULL, value TEXT);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, google_id TEXT UNIQUE, taken_at TEXT NOT NULL, filename TEXT, mime TEXT NOT NULL, width INTEGER, height INTEGER, imported_at TEXT NOT NULL, actor TEXT NOT NULL, source TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, thumb_size INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS photo_blobs (photo_id TEXT NOT NULL, kind TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (photo_id, kind, idx));
CREATE TABLE IF NOT EXISTS life_events (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, on_date TEXT NOT NULL, title TEXT NOT NULL, note TEXT, verification TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS access_log (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, method TEXT NOT NULL, route TEXT NOT NULL);
`;

const DEFAULT_SOURCES: [string, string, number | null][] = [
	["Manual entry (this app)", "manual", null],
	["Google Calendar", "calendar", 60],
	["Gmail appointment confirmations", "email", 60],
	["Google Drive records folder", "drive", 24 * 60],
	["Hospital records (HHS / CMH)", "records-request", null],
];

const CHUNK = 1024 * 1024; // DO SQLite rows max 2 MB
export const MAX_UPLOAD = 20 * 1024 * 1024;

type Row = Record<string, any>;
class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function str(v: unknown, field: string, { required = false, max = 2000 } = {}): string | null {
	if (v === undefined || v === null || v === "") {
		if (required) throw new HttpError(400, `${field} is required`);
		return null;
	}
	if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
	const s = v.trim();
	if (s.length > max) throw new HttpError(400, `${field} is too long`);
	if (required && !s) throw new HttpError(400, `${field} is required`);
	return s || null;
}

export class PersonVault extends DurableObject<Env> {
	sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(SCHEMA);
		const now = new Date().toISOString();
		for (const [name, kind, interval] of DEFAULT_SOURCES) {
			this.sql.exec(
				"INSERT OR IGNORE INTO sources (id, name, kind, expected_interval_min, created_at) VALUES (?, ?, ?, ?, ?)",
				ulid(),
				name,
				kind,
				interval,
				now,
			);
		}
	}

	private rows(q: string, ...args: any[]): Row[] {
		return this.sql.exec(q, ...args).toArray() as Row[];
	}
	private one(q: string, ...args: any[]): Row | null {
		return this.rows(q, ...args)[0] ?? null;
	}
	private event(actor: string, type: string, payload: unknown) {
		this.sql.exec(
			"INSERT INTO events (id, at, actor, type, payload) VALUES (?, ?, ?, ?, ?)",
			ulid(),
			new Date().toISOString(),
			actor,
			type,
			JSON.stringify(payload),
		);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const actor = request.headers.get("x-actor") || "unknown";
		const route = request.headers.get("x-route") || url.pathname;
		this.sql.exec(
			"INSERT INTO access_log (id, at, actor, method, route) VALUES (?, ?, ?, ?, ?)",
			ulid(),
			new Date().toISOString(),
			actor,
			request.method,
			route.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ":id"),
		);
		try {
			return await this.route(request, url, actor);
		} catch (e) {
			if (!request.bodyUsed) await request.body?.cancel().catch(() => {});
			if (e instanceof HttpError) return json({ error: e.message }, e.status);
			console.error("vault error", (e as Error).name); // no PHI in logs
			return json({ error: "Internal error" }, 500);
		}
	}

	private async body(request: Request): Promise<Row> {
		try {
			const b = await request.json();
			if (!b || typeof b !== "object") throw new Error();
			return b as Row;
		} catch {
			throw new HttpError(400, "Expected a JSON body");
		}
	}

	private async route(request: Request, url: URL, actor: string): Promise<Response> {
		const p = url.pathname.split("/").filter(Boolean);
		const m = request.method;
		const is = (method: string, ...segs: string[]) =>
			m === method && p.length === segs.length && segs.every((s, i) => s === "*" || s === p[i]);

		if (is("GET", "summary")) return json(this.summary());
		if (is("GET", "card")) return json(this.card());
		if (is("PUT", "profile")) return json(this.putProfile(await this.body(request), actor), 201);
		if (is("POST", "log")) return json(this.addLog(await this.body(request), actor), 201);
		if (is("GET", "observations")) return json(this.rows("SELECT * FROM observations ORDER BY at DESC LIMIT 200"));
		if (is("POST", "appointments")) return json(this.addAppointment(await this.body(request), actor), 201);
		if (is("GET", "appointments", "*", "brief")) return json(this.latestBrief(p[1], actor));
		if (is("POST", "issues")) return json(this.addIssue(await this.body(request), actor), 201);
		if (is("POST", "issues", "*", "status")) return json(this.issueStatus(p[1], await this.body(request), actor), 201);
		if (is("GET", "issues", "*")) return json(this.issueDetail(p[1]));
		if (is("POST", "medications")) return json(this.addMedication(await this.body(request), actor), 201);
		if (is("POST", "conflicts", "*", "resolve")) return json(this.resolveConflict(p[1], await this.body(request), actor), 201);
		if (is("GET", "drive-imports", "*")) return json(this.one("SELECT source_hash, document_id FROM drive_imports WHERE source_id = ?", p[1]) ?? {source_hash:null});
		if (is("POST", "drive-imports", "*")) {
			const b = await this.body(request);
			if (!this.one("SELECT id FROM documents WHERE id = ? AND sha256 = ?", b.document_id, b.source_hash)) throw new HttpError(400, "Source document not verified");
			this.sql.exec("INSERT INTO drive_imports (source_id,source_hash,document_id,imported_at) VALUES (?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET source_hash=excluded.source_hash,document_id=excluded.document_id,imported_at=excluded.imported_at",p[1],b.source_hash,b.document_id,new Date().toISOString());
			return json({recorded:true});
		}
		if (is("POST", "documents")) return json(await this.addDocument(request, url, actor), 201);
		if (is("GET", "documents", "*", "raw")) return this.rawDocument(p[1]);
		if (is("POST", "sources", "*", "report")) return json(this.reportSource(p[1], await this.body(request)), 201);
		if (is("POST", "tick")) return json(this.tick(Date.now()));
		if (is("GET", "export")) return json(this.exportAll());
		if (is("POST", "letters")) return json(this.addLetter(await this.body(request), actor), 201);
		if (is("POST", "photos", "import")) {
			const b = await this.body(request);
			return json(await this.importPhotos(b.items, b.token, actor), 201);
		}
		if (is("GET", "photos", "*", "thumb")) return this.photoBytes(p[1], "thumb");
		if (is("GET", "photos", "*", "image")) return this.photoBytes(p[1], "image");
		if (is("POST", "life-events")) return json(this.addLifeEvent(await this.body(request), actor), 201);
		if (is("GET", "story")) return json(this.story());
		if (is("POST", "keep")) return json(this.keep(await this.body(request), actor), 201);
		if (is("PUT", "settings", "keepsake-email")) return json(this.setKeepsakeEmail(await this.body(request), actor), 201);
		if (is("POST", "keepsakes", "compile")) return json(this.compileKeepsake((await this.body(request)).period, "requested-by-parent", Date.now()), 201);
		if (is("GET", "keepsakes", "*")) return this.keepsakeHtml(p[1]);
		throw new HttpError(404, "Not found");
	}

	// ---------------- profile ----------------
	private profile(): Row | null {
		const r = this.one("SELECT data, at FROM profile_versions ORDER BY at DESC, id DESC LIMIT 1");
		return r ? { ...JSON.parse(r.data), updated_at: r.at } : null;
	}
	private putProfile(b: Row, actor: string) {
		const birth = str(b.birth_date, "birth_date", { required: true })!;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) throw new HttpError(400, "birth_date must be YYYY-MM-DD");
		const gaW = Number(b.ga_weeks);
		const gaD = Number(b.ga_days ?? 0);
		if (!Number.isInteger(gaW) || gaW < 22 || gaW > 44 || !Number.isInteger(gaD) || gaD < 0 || gaD > 6)
			throw new HttpError(400, "Gestational age at birth must be weeks 22–44 and days 0–6");
		const data = {
			display_name: str(b.display_name, "display_name", { required: true, max: 80 }),
			birth_date: birth,
			ga_weeks: gaW,
			ga_days: gaD,
			label: str(b.label, "label", { max: 40 }), // presentation preference e.g. "Baby A · LEFT"
			side: b.side === "left" || b.side === "right" ? b.side : null,
		};
		const id = ulid();
		this.sql.exec("INSERT INTO profile_versions (id, at, actor, data) VALUES (?, ?, ?, ?)", id, new Date().toISOString(), actor, JSON.stringify(data));
		this.event(actor, "profile.set", { id });
		return { id, ...data };
	}

	// ---------------- rapid log ----------------
	private addLog(b: Row, actor: string) {
		const text = str(b.text, "text", { required: true, max: 1000 })!;
		const parsed = parseRapidLog(text);
		const redFlags = detectRedFlags(text);
		const id = ulid();
		const at = new Date().toISOString();
		this.sql.exec(
			"INSERT INTO observations (id, at, actor, text, category, duration_min, volume_ml, tags, red_flags, verification) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PARENT_REPORT')",
			id,
			at,
			actor,
			text,
			parsed.category,
			parsed.durationMin,
			parsed.volumeMl,
			JSON.stringify(parsed.tags),
			JSON.stringify(redFlags),
		);
		this.event(actor, "observation.logged", { id });
		return {
			id,
			at,
			verification: "PARENT_REPORT",
			parsed,
			red_flags: redFlags,
			guidance: redFlags.length ? RED_FLAG_GUIDANCE : null,
		};
	}

	// ---------------- appointments & briefs ----------------
	private addAppointment(b: Row, actor: string) {
		const local = str(b.starts_local, "starts_local", { required: true })!;
		let startsAt: string;
		try {
			startsAt = torontoLocalToUtcIso(local);
		} catch {
			throw new HttpError(400, "starts_local must be YYYY-MM-DDTHH:mm (Toronto time)");
		}
		const id = ulid();
		this.sql.exec(
			"INSERT INTO appointments (id, created_at, actor, starts_at, title, provider, specialty, location, details_verified, discovered_via, source_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id,
			new Date().toISOString(),
			actor,
			startsAt,
			str(b.title, "title", { required: true, max: 200 }),
			str(b.provider, "provider", { max: 200 }),
			str(b.specialty, "specialty", { max: 80 }),
			str(b.location, "location", { max: 200 }),
			b.details_verified === true ? 1 : 0,
			str(b.discovered_via, "discovered_via", { max: 40 }) ?? "manual",
			str(b.source_note, "source_note"),
		);
		this.event(actor, "appointment.created", { id });
		const lead = Date.parse(startsAt) - Date.now();
		const brief = this.createBrief(id, lead < 7 * 86400000 ? "late-discovery" : "on-create");
		return { id, starts_at: startsAt, brief_id: brief.id, brief_trigger: brief.trigger };
	}

	private createBrief(appointmentId: string, trigger: string) {
		const appt = this.one("SELECT * FROM appointments WHERE id = ?", appointmentId);
		if (!appt) throw new HttpError(404, "Not found");
		const content = this.buildBrief(appt);
		const id = ulid();
		this.sql.exec(
			"INSERT INTO briefs (id, appointment_id, created_at, trigger, content) VALUES (?, ?, ?, ?, ?)",
			id,
			appointmentId,
			new Date().toISOString(),
			trigger,
			JSON.stringify(content),
		);
		this.event("system", "brief.created", { id, appointment_id: appointmentId, trigger });
		return { id, trigger };
	}

	private latestBrief(appointmentId: string, actor: string) {
		const appt = this.one("SELECT id FROM appointments WHERE id = ?", appointmentId);
		if (!appt) throw new HttpError(404, "Not found");
		// Always regenerate on view so it reflects the latest record; keep the version.
		const created = this.createBrief(appointmentId, "viewed");
		this.event(actor, "brief.viewed", { id: created.id });
		const r = this.one("SELECT * FROM briefs WHERE id = ?", created.id)!;
		const history = this.rows("SELECT id, created_at, trigger FROM briefs WHERE appointment_id = ? ORDER BY created_at DESC", appointmentId);
		return { id: r.id, created_at: r.created_at, trigger: r.trigger, content: JSON.parse(r.content), history };
	}

	private buildBrief(appt: Row) {
		const profile = this.profile();
		const ages = profile ? computeAges(profile.birth_date, profile.ga_weeks, profile.ga_days) : null;
		const specialty = (appt.specialty || "").toLowerCase();
		const issues = this.openIssues().filter(
			(i) => !specialty || !i.specialty || ["gp", "family doctor", "pediatrician", "paediatrician"].includes(specialty) || i.specialty.toLowerCase() === specialty,
		);
		const meds = this.medications();
		const conflicts = this.openConflicts();
		const since = new Date(Date.now() - 14 * 86400000).toISOString();
		const obs = this.rows("SELECT * FROM observations WHERE at >= ? ORDER BY at DESC", since);
		const byCat: Record<string, Row[]> = {};
		for (const o of obs) (byCat[o.category] ||= []).push(o);
		const patterns = this.patterns();
		const sections = [
			{
				heading: "Open issues to raise",
				items: issues.map((i) => ({
					text: `${i.title} (status: ${i.status.replace("_", " ")}${i.owner ? `; owner: ${i.owner}` : ""}${i.due_date ? `; due ${i.due_date}` : ""})${i.next_action ? ` → Next: ${i.next_action}` : ""}`,
					verification: i.verification,
				})),
			},
			{
				heading: "Medications: confirm against the bottle label and prescriber",
				items: [
					...meds
						.filter((m) => m.status !== "historical")
						.map((m) => ({
							text: `${m.name}${m.strength ? ` ${m.strength}` : ""}${m.dose_text ? `, ${m.dose_text}` : ""}${m.frequency ? `, ${m.frequency}` : ""}${m.prescriber ? ` (prescriber: ${m.prescriber})` : ""}${m.in_conflict ? " ⚠ CONFLICTING RECORDS" : ""}`,
							verification: m.in_conflict ? "CONFLICT" : m.status === "verified" ? "CLINICAL_RECORD" : m.verification,
						})),
					...conflicts.map((c) => ({ text: `Ask: ${c.description}`, verification: "CONFLICT" })),
				],
			},
			{
				heading: "Parent observations, last 14 days",
				items: Object.entries(byCat).map(([cat, list]) => {
					const durations = list.map((o) => o.duration_min).filter((d) => d != null);
					const extra = durations.length ? `; durations ${Math.min(...durations)}–${Math.max(...durations)} min` : "";
					return {
						text: `${cat}: ${list.length} entr${list.length === 1 ? "y" : "ies"}${extra}. Latest: "${list[0].text}"`,
						verification: "PARENT_REPORT",
					};
				}),
			},
			{
				heading: "Patterns the system noticed (not clinical findings)",
				items: patterns.map((p) => ({ text: p, verification: "AI_INFERENCE" })),
			},
			{
				heading: "Questions to ask",
				items: [
					...issues.filter((i) => i.next_action).map((i) => ({ text: `${i.title}: ${i.next_action}`, verification: "PARENT_REPORT" })),
					...conflicts.map((c) => ({ text: `Which record is current? ${c.subject}`, verification: "CONFLICT" })),
					{ text: "Can we get copies of today's notes, orders and any referral letters?", verification: "PARENT_REPORT" },
				],
			},
		];
		return {
			child: profile?.display_name ?? null,
			label: profile?.label ?? null,
			ages,
			appointment: {
				title: appt.title,
				when: formatToronto(appt.starts_at),
				provider: appt.provider,
				specialty: appt.specialty,
				location: appt.location,
				details_verified: !!appt.details_verified,
			},
			sections,
			disclaimer:
				"Prepared by FamilyOS from the family's own records. It is not medical advice and does not replace the clinician's judgement. Items are labelled by source.",
		};
	}

	// ---------------- issues ----------------
	private addIssue(b: Row, actor: string) {
		const id = ulid();
		const verification = VERIFICATION.includes(b.verification) ? b.verification : "PARENT_REPORT";
		this.sql.exec(
			"INSERT INTO issues (id, created_at, actor, title, specialty, owner, first_reported, source_note, verification) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id,
			new Date().toISOString(),
			actor,
			str(b.title, "title", { required: true, max: 200 }),
			str(b.specialty, "specialty", { max: 80 }),
			str(b.owner, "owner", { max: 200 }),
			str(b.first_reported, "first_reported", { max: 10 }) ?? new Date().toISOString().slice(0, 10),
			str(b.source_note, "source_note"),
			verification,
		);
		this.insertIssueStatus(id, actor, (ISSUE_STATUSES as readonly string[]).includes(b.status) && !EVIDENCE_REQUIRED.includes(b.status) ? b.status : "raised", null, str(b.next_action, "next_action", { max: 500 }), str(b.due_date, "due_date", { max: 10 }));
		this.event(actor, "issue.created", { id });
		return { id };
	}
	private insertIssueStatus(issueId: string, actor: string, status: string, evidence: string | null, next: string | null, due: string | null) {
		this.sql.exec(
			"INSERT INTO issue_status_events (id, issue_id, at, actor, status, evidence, next_action, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			ulid(),
			issueId,
			new Date().toISOString(),
			actor,
			status,
			evidence,
			next,
			due,
		);
	}
	private issueStatus(issueId: string, b: Row, actor: string) {
		if (!this.one("SELECT id FROM issues WHERE id = ?", issueId)) throw new HttpError(404, "Not found");
		const status = b.status as IssueStatus;
		if (!(ISSUE_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "Unknown status");
		const evidence = str(b.evidence, "evidence", { max: 2000 });
		if (EVIDENCE_REQUIRED.includes(status) && !evidence)
			throw new HttpError(422, `Moving to "${status.replace("_", " ")}" needs evidence: who confirmed it, when, and how (e.g. "Clinic called 3 Nov, referral received").`);
		const cur = this.currentIssueStatus(issueId);
		this.insertIssueStatus(
			issueId,
			actor,
			status,
			evidence,
			str(b.next_action, "next_action", { max: 500 }) ?? cur?.next_action ?? null,
			str(b.due_date, "due_date", { max: 10 }) ?? cur?.due_date ?? null,
		);
		this.event(actor, "issue.status", { id: issueId, status });
		return this.issueDetail(issueId);
	}
	private currentIssueStatus(issueId: string) {
		return this.one("SELECT * FROM issue_status_events WHERE issue_id = ? ORDER BY at DESC, id DESC LIMIT 1", issueId);
	}
	private issueDetail(issueId: string): Row {
		const issue = this.one("SELECT * FROM issues WHERE id = ?", issueId);
		if (!issue) throw new HttpError(404, "Not found");
		const history = this.rows("SELECT at, actor, status, evidence, next_action, due_date FROM issue_status_events WHERE issue_id = ? ORDER BY at, id", issueId);
		const cur = history[history.length - 1];
		return { ...issue, status: cur.status, next_action: cur.next_action, due_date: cur.due_date, history };
	}
	private allIssues() {
		return this.rows("SELECT id FROM issues ORDER BY created_at").map((r) => this.issueDetail(r.id));
	}
	private openIssues(): Row[] {
		const today = new Date().toISOString().slice(0, 10);
		return this.allIssues()
			.filter((i) => i.status !== "closed")
			.map((i): Row => ({ ...i, overdue: !!i.due_date && i.due_date < today }))
			.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
	}

	// ---------------- medications & conflicts ----------------
	private addMedication(b: Row, actor: string) {
		const id = ulid();
		const name = str(b.name, "name", { required: true, max: 120 })!;
		const strength = str(b.strength, "strength", { max: 60 });
		const verification = VERIFICATION.includes(b.verification) ? b.verification : "PARENT_REPORT";
		this.sql.exec(
			"INSERT INTO medications (id, created_at, actor, name, form, strength, dose_text, frequency, prescriber, verification, source_note, document_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id,
			new Date().toISOString(),
			actor,
			name,
			str(b.form, "form", { max: 60 }),
			strength,
			str(b.dose_text, "dose_text", { max: 200 }),
			str(b.frequency, "frequency", { max: 100 }),
			str(b.prescriber, "prescriber", { max: 120 }),
			verification,
			str(b.source_note, "source_note"),
			str(b.document_id, "document_id", { max: 40 }),
		);
		this.event(actor, "medication.recorded", { id });
		// Same medication recorded with a different strength or dose -> CONFLICT. Never pick one automatically.
		const others = this.medications().filter(
			(m) => m.id !== id && m.status !== "historical" && m.name.toLowerCase() === name.toLowerCase(),
		);
		const mine = this.one("SELECT * FROM medications WHERE id = ?", id)!;
		const differing = others.filter((o) => (o.strength || "") !== (mine.strength || "") || (o.dose_text || "") !== (mine.dose_text || ""));
		let conflictId: string | null = null;
		if (differing.length) {
			conflictId = ulid();
			const desc = [mine, ...differing]
				.map((m) => `${m.strength || "?"}${m.dose_text ? `, ${m.dose_text}` : ""} (${m.verification}${m.source_note ? `: ${m.source_note}` : ""})`)
				.join(" vs ");
			this.sql.exec(
				"INSERT INTO conflicts (id, created_at, subject, item_ids, description) VALUES (?, ?, ?, ?, ?)",
				conflictId,
				new Date().toISOString(),
				`${name}: records disagree`,
				JSON.stringify([id, ...differing.map((d) => d.id)]),
				`${name} records disagree: ${desc}. Check the current bottle label and confirm with the prescriber. Do not calculate a dose from these records.`,
			);
			this.event("system", "conflict.detected", { id: conflictId });
		}
		return { id, conflict_id: conflictId };
	}
	private resolveConflict(conflictId: string, b: Row, actor: string) {
		const c = this.one("SELECT * FROM conflicts WHERE id = ?", conflictId);
		if (!c) throw new HttpError(404, "Not found");
		if (this.one("SELECT id FROM conflict_resolutions WHERE conflict_id = ?", conflictId)) throw new HttpError(409, "Already resolved");
		const items: string[] = JSON.parse(c.item_ids);
		const chosen = str(b.chosen_id, "chosen_id", { required: true })!;
		if (!items.includes(chosen)) throw new HttpError(400, "chosen_id must be one of the conflicting records");
		const evidence = str(b.evidence, "evidence", { required: true })!;
		const at = new Date().toISOString();
		this.sql.exec("INSERT INTO conflict_resolutions (id, conflict_id, at, actor, chosen_id, evidence) VALUES (?, ?, ?, ?, ?, ?)", ulid(), conflictId, at, actor, chosen, evidence);
		for (const it of items) {
			this.sql.exec(
				"INSERT INTO med_status_events (id, med_id, at, actor, status, evidence) VALUES (?, ?, ?, ?, ?, ?)",
				ulid(),
				it,
				at,
				actor,
				it === chosen ? "verified" : "historical",
				evidence,
			);
		}
		this.event(actor, "conflict.resolved", { id: conflictId });
		return { ok: true };
	}
	private openConflicts(): Row[] {
		return this.rows(
			"SELECT * FROM conflicts WHERE id NOT IN (SELECT conflict_id FROM conflict_resolutions) ORDER BY created_at DESC",
		).map((c): Row => ({ ...c, item_ids: JSON.parse(c.item_ids) }));
	}
	private medications(): Row[] {
		const open = this.openConflicts();
		const inConflict = new Set(open.flatMap((c) => c.item_ids));
		return this.rows("SELECT * FROM medications ORDER BY created_at").map((m): Row => {
			const st = this.one("SELECT status, evidence, at FROM med_status_events WHERE med_id = ? ORDER BY at DESC, id DESC LIMIT 1", m.id);
			return { ...m, status: st?.status ?? "unverified", status_evidence: st?.evidence ?? null, in_conflict: inConflict.has(m.id) };
		});
	}

	// ---------------- documents ----------------
	private async addDocument(request: Request, url: URL, actor: string) {
		const filename = (url.searchParams.get("filename") || "upload").replace(/[^\w.\- ()]/g, "_").slice(0, 200);
		const declared = request.headers.get("content-type") || "application/octet-stream";
		const verification = VERIFICATION.includes(url.searchParams.get("verification") as any)
			? url.searchParams.get("verification")!
			: "EXTRACTED";
		const note = (url.searchParams.get("note") || "").slice(0, 500) || null;
		const buf = new Uint8Array(await request.arrayBuffer()) as Uint8Array<ArrayBuffer>;
		if (!buf.length) throw new HttpError(400, "Empty file");
		if (buf.length > MAX_UPLOAD) throw new HttpError(413, "File is larger than 20 MB");
		const mime = sniffMime(buf, declared);
		if (!mime) throw new HttpError(415, "This file type isn't accepted (PDF, images, text, Word documents only)");
		const hash = await sha256Hex(buf);
		const at = new Date().toISOString();
		const existing = this.one("SELECT * FROM documents WHERE sha256 = ?", hash);
		let docId: string;
		let duplicate = false;
		if (existing) {
			docId = existing.id;
			duplicate = true;
		} else {
			docId = ulid();
			this.ctx.storage.transactionSync(() => {
				this.sql.exec(
					"INSERT INTO documents (id, sha256, filename, mime, size, received_at, actor, verification, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
					docId,
					hash,
					filename,
					mime,
					buf.length,
					at,
					actor,
					verification,
					note,
				);
				for (let i = 0, idx = 0; i < buf.length; i += CHUNK, idx++) {
					this.sql.exec("INSERT INTO doc_chunks (doc_id, idx, data) VALUES (?, ?, ?)", docId, idx, buf.slice(i, i + CHUNK).buffer);
				}
			});
		}
		this.sql.exec("INSERT INTO doc_receipts (id, doc_id, at, actor, filename) VALUES (?, ?, ?, ?, ?)", ulid(), docId, at, actor, filename);
		this.event(actor, duplicate ? "document.duplicate_received" : "document.stored", { id: docId, sha256: hash });
		return { id: docId, sha256: hash, duplicate, mime, size: buf.length };
	}
	private rawDocument(docId: string): Response {
		const d = this.one("SELECT * FROM documents WHERE id = ?", docId);
		if (!d) throw new HttpError(404, "Not found");
		const chunks = this.rows("SELECT data FROM doc_chunks WHERE doc_id = ? ORDER BY idx", docId);
		const out = new Uint8Array(d.size);
		let off = 0;
		for (const c of chunks) {
			const u = new Uint8Array(c.data as ArrayBuffer);
			out.set(u, off);
			off += u.length;
		}
		return new Response(out, {
			headers: {
				"content-type": d.mime,
				"content-disposition": `attachment; filename="${d.filename.replace(/"/g, "")}"`,
				"x-content-sha256": d.sha256,
			},
		});
	}

	// ---------------- sources & automation ----------------
	private reportSource(sourceId: string, b: Row) {
		if (!this.one("SELECT id FROM sources WHERE id = ?", sourceId)) throw new HttpError(404, "Not found");
		this.sql.exec(
			"INSERT INTO source_status_events (id, source_id, at, ok, detail) VALUES (?, ?, ?, ?, ?)",
			ulid(),
			sourceId,
			new Date().toISOString(),
			b.ok === true ? 1 : 0,
			str(b.detail, "detail", { max: 300 }),
		);
		return { ok: true };
	}
	private sources(nowMs = Date.now()) {
		return this.rows("SELECT * FROM sources ORDER BY created_at, name").map((s) => {
			if (s.kind === "manual") return { ...s, status: "CONNECTED", last_success_at: null, detail: "Always available" };
			const last = this.one("SELECT * FROM source_status_events WHERE source_id = ? ORDER BY at DESC LIMIT 1", s.id);
			const lastOk = this.one("SELECT at FROM source_status_events WHERE source_id = ? AND ok = 1 ORDER BY at DESC LIMIT 1", s.id);
			let status = "NOT CONNECTED";
			let detail = "No connector has reported yet. Nothing from this source is being picked up automatically.";
			if (last) {
				const stale = s.expected_interval_min && lastOk && nowMs - Date.parse(lastOk.at) > 2 * s.expected_interval_min * 60000;
				if (!last.ok || !lastOk || stale) {
					status = "DEGRADED";
					detail = last.ok ? "No successful sync recently" : last.detail || "Last sync failed";
				} else {
					status = "CONNECTED";
					detail = "Syncing normally";
				}
			}
			return { ...s, status, last_success_at: lastOk?.at ?? null, detail };
		});
	}
	/** Scheduled work for this person. Called by the Worker's cron handler. */
	tick(nowMs: number) {
		const runId = ulid();
		const started = new Date(nowMs).toISOString();
		this.sql.exec("INSERT INTO automation_runs (id, job, started_at) VALUES (?, 'scheduled-tick', ?)", runId, started);
		const created: string[] = [];
		try {
			const upcoming = this.rows("SELECT * FROM appointments WHERE starts_at > ?", started);
			for (const a of upcoming) {
				const lead = Date.parse(a.starts_at) - nowMs;
				for (const [trigger, ms] of [
					["T-7d", 7 * 86400000],
					["T-48h", 48 * 3600000],
					["T-12h", 12 * 3600000],
				] as const) {
					if (lead <= ms && !this.one("SELECT id FROM briefs WHERE appointment_id = ? AND trigger = ?", a.id, trigger)) {
						this.createBrief(a.id, trigger);
						created.push(trigger);
					}
				}
			}
			// Monthly letter: on the 1st (Toronto), write last month's letter once.
			let keepsake: string | null = null;
			const today = torontoDate(nowMs);
			if (today.endsWith("-01") && this.profile()) {
				const period = previousPeriod(today);
				if (!this.one("SELECT id FROM keepsakes WHERE period = ? AND trigger = 'monthly'", period)) {
					keepsake = this.compileKeepsake(period, "monthly", nowMs).id;
				}
			}
			const overdue = this.openIssues().filter((i) => i.overdue).length;
			const degraded = this.sources(nowMs).filter((s) => s.status !== "CONNECTED").length;
			const detail = JSON.stringify({ briefs_created: created, overdue_issues: overdue, sources_not_connected: degraded, keepsake_created: !!keepsake });
			this.sql.exec("INSERT INTO automation_runs (id, job, started_at, finished_at, ok, detail) VALUES (?, 'scheduled-tick:done', ?, ?, 1, ?)", ulid(), started, new Date().toISOString(), detail);
			return { ok: true, briefs_created: created, overdue_issues: overdue, keepsake };
		} catch (e) {
			this.sql.exec("INSERT INTO automation_runs (id, job, started_at, finished_at, ok, detail) VALUES (?, 'scheduled-tick:done', ?, ?, 0, ?)", ulid(), started, new Date().toISOString(), (e as Error).name);
			throw e;
		}
	}

	// ---------------- patterns (rules, labelled AI_INFERENCE) ----------------
	private patterns(): string[] {
		const out: string[] = [];
		const week = new Date(Date.now() - 7 * 86400000).toISOString();
		const longFeeds = this.one("SELECT COUNT(*) AS n FROM observations WHERE category = 'feed' AND duration_min >= 40 AND at >= ?", week)!.n;
		if (longFeeds >= 3) out.push(`Feeds of 40+ minutes were logged ${longFeeds} times in the last 7 days. Consider raising feeding duration at the next visit.`);
		const regurg = this.rows("SELECT tags FROM observations WHERE at >= ?", week).filter((r) => JSON.parse(r.tags).some((t: string) => t.includes("regurg") || t === "choking")).length;
		if (regurg >= 3) out.push(`Regurgitation or choking was mentioned ${regurg} times in the last 7 days.`);
		const flagged = this.one("SELECT COUNT(*) AS n FROM observations WHERE red_flags != '[]' AND at >= ?", week)!.n;
		if (flagged) out.push(`${flagged} log entr${flagged === 1 ? "y" : "ies"} in the last 7 days matched an urgent-symptom phrase. Make sure a clinician knows.`);
		const overdue = this.openIssues().filter((i) => i.overdue).length;
		if (overdue) out.push(`${overdue} open issue${overdue === 1 ? " is" : "s are"} past due.`);
		return out;
	}

	// ---------------- keepsake letters (his own story, separate from the medical record) ----------------
	private setting(key: string): string | null {
		return this.one("SELECT value FROM settings WHERE key = ? ORDER BY at DESC, id DESC LIMIT 1", key)?.value ?? null;
	}
	private setKeepsakeEmail(b: Row, actor: string) {
		const v = str(b.email, "email", { max: 200 });
		if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, "That doesn't look like an email address");
		this.sql.exec("INSERT INTO settings (id, at, actor, key, value) VALUES (?, ?, ?, 'keepsake_email', ?)", ulid(), new Date().toISOString(), actor, v ? v.toLowerCase() : null);
		this.event(actor, "settings.keepsake_email", {});
		return { ok: true };
	}
	private addLetter(b: Row, actor: string) {
		const id = ulid();
		this.sql.exec(
			"INSERT INTO letters (id, at, actor, signed_as, title, body) VALUES (?, ?, ?, ?, ?, ?)",
			id,
			new Date().toISOString(),
			actor,
			str(b.signed_as, "signed_as", { required: true, max: 60 }),
			str(b.title, "title", { max: 200 }),
			str(b.body, "body", { required: true, max: 20000 }),
		);
		this.event(actor, "letter.written", { id });
		return { id };
	}
	private keep(b: Row, actor: string) {
		const type = b.item_type === "document" ? "document" : "observation";
		const itemId = str(b.item_id, "item_id", { required: true, max: 40 })!;
		const table = type === "document" ? "documents" : "observations";
		if (!this.one(`SELECT id FROM ${table} WHERE id = ?`, itemId)) throw new HttpError(404, "Not found");
		if (this.one("SELECT id FROM keepsake_marks WHERE item_type = ? AND item_id = ?", type, itemId)) return { ok: true, already: true };
		this.sql.exec("INSERT INTO keepsake_marks (id, at, actor, item_type, item_id, note) VALUES (?, ?, ?, ?, ?, ?)", ulid(), new Date().toISOString(), actor, type, itemId, str(b.note, "note", { max: 500 }));
		this.event(actor, "keepsake.marked", { item_type: type });
		return { ok: true };
	}
	/** Build (or rebuild as a new version) the letter for one month. Previous versions are kept. */
	compileKeepsake(periodIn: unknown, trigger: string, nowMs: number) {
		const period = typeof periodIn === "string" && /^\d{4}-\d{2}$/.test(periodIn) ? periodIn : torontoDate(nowMs).slice(0, 7);
		const profile = this.profile();
		if (!profile) throw new HttpError(409, "Set up this record first");
		const [y, m] = period.split("-").map(Number);
		// Month boundaries in UTC are close enough for grouping; display dates use Toronto time.
		const from = new Date(Date.UTC(y, m - 1, 1, 5)).toISOString();
		const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 5)).toISOString();
		const day = (iso: string) => torontoDate(Date.parse(iso));
		const letters = this.rows("SELECT * FROM letters WHERE at >= ? AND at < ? ORDER BY at", from, to).map((l) => ({
			signed_as: l.signed_as,
			title: l.title,
			body: l.body,
			written_on: day(l.at),
		}));
		const milestones = this.rows("SELECT * FROM observations WHERE category = 'milestone' AND at >= ? AND at < ? ORDER BY at", from, to).map((o) => ({ text: o.text, on: day(o.at) }));
		const kept = this.rows(
			"SELECT o.text, o.at, k.note FROM keepsake_marks k JOIN observations o ON o.id = k.item_id WHERE k.item_type = 'observation' AND o.category != 'milestone' AND o.at >= ? AND o.at < ? ORDER BY o.at",
			from,
			to,
		).map((r) => ({ text: r.text, on: day(r.at), note: r.note }));
		const endMs = Math.min(Date.parse(to) - 1, nowMs);
		const k = buildKeepsake({
			childName: profile.display_name,
			period,
			ages: computeAges(profile.birth_date, profile.ga_weeks, profile.ga_days, endMs),
			letters,
			milestones,
			kept,
		});
		const id = ulid();
		this.sql.exec(
			"INSERT INTO keepsakes (id, period, created_at, trigger, subject, text, html, counts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			id,
			period,
			new Date(nowMs).toISOString(),
			trigger,
			k.subject,
			k.text,
			k.html,
			JSON.stringify(k.counts),
		);
		this.event("system", "keepsake.compiled", { id, period, trigger });
		const delivery = this.deliverKeepsake(id);
		return { id, period, subject: k.subject, counts: k.counts, delivery };
	}
	/**
	 * Email delivery is not connected yet (libbyhd.org mail runs on Google Workspace, so it
	 * needs a Google sending credential). Until then every letter records an explicit
	 * NOT_SENT status. The letter itself is always kept here and in the export.
	 */
	private deliverKeepsake(keepsakeId: string) {
		const to = this.setting("keepsake_email");
		const status = to ? "NOT_SENT_DELIVERY_NOT_CONNECTED" : "NOT_SENT_NO_ADDRESS";
		const detail = to ? "Email sending is not connected yet. The letter is saved and will be sent once it is." : "No email address set for his letters.";
		this.sql.exec("INSERT INTO keepsake_deliveries (id, keepsake_id, at, status, detail) VALUES (?, ?, ?, ?, ?)", ulid(), keepsakeId, new Date().toISOString(), status, detail);
		return { status, detail };
	}
	private keepsakeHtml(id: string): Response {
		const k = this.one("SELECT html FROM keepsakes WHERE id = ?", id);
		if (!k) throw new HttpError(404, "Not found");
		return new Response(k.html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
	}
	// ---------------- photos & his story by week ----------------
	/**
	 * Copy photos the parent picked in Google's photo picker into this child's record.
	 * The Google access token is used only for these downloads and never stored or logged.
	 * Keeps a 2048px copy plus a small preview; the full original stays in Google Photos.
	 */
	async importPhotos(itemsIn: unknown, tokenIn: unknown, actor: string, fetcher: typeof fetch = fetch) {
		if (!Array.isArray(itemsIn) || !itemsIn.length || itemsIn.length > 10) throw new HttpError(400, "Send 1–10 photos at a time");
		if (typeof tokenIn !== "string" || tokenIn.length < 10 || tokenIn.length > 4096) throw new HttpError(400, "Missing Google access");
		const results: { google_id: string; status: string }[] = [];
		for (const it of itemsIn as Row[]) {
			const gid = typeof it.id === "string" ? it.id.slice(0, 200) : "";
			const baseUrl = typeof it.baseUrl === "string" ? it.baseUrl : "";
			if (!gid || !isGooglePhotoUrl(baseUrl)) {
				results.push({ google_id: gid, status: "rejected" });
				continue;
			}
			if (this.one("SELECT id FROM photos WHERE google_id = ?", gid)) {
				results.push({ google_id: gid, status: "already-saved" });
				continue;
			}
			const takenMs = Date.parse(String(it.createTime || ""));
			try {
				const get = async (suffix: string) => {
					const r = await fetcher(`${baseUrl}${suffix}`, { headers: { authorization: `Bearer ${tokenIn}` } });
					if (!r.ok) throw new Error(String(r.status));
					return new Uint8Array(await r.arrayBuffer()) as Uint8Array<ArrayBuffer>;
				};
				const image = await get("=w2048-h2048");
				const thumb = await get("=w480-h480-c");
				const mime = sniffMime(image, "image/jpeg") || "image/jpeg";
				const id = ulid();
				const sha = await sha256Hex(image);
				this.ctx.storage.transactionSync(() => {
					this.sql.exec(
						"INSERT INTO photos (id, google_id, taken_at, filename, mime, width, height, imported_at, actor, source, sha256, size, thumb_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'google-photos-picker', ?, ?, ?)",
						id,
						gid,
						Number.isFinite(takenMs) ? new Date(takenMs).toISOString() : new Date().toISOString(),
						typeof it.filename === "string" ? it.filename.slice(0, 200) : null,
						mime,
						Number(it.width) || null,
						Number(it.height) || null,
						new Date().toISOString(),
						actor,
						sha,
						image.length,
						thumb.length,
					);
					for (const [kind, bytes] of [["image", image], ["thumb", thumb]] as const) {
						for (let i = 0, idx = 0; i < bytes.length; i += CHUNK, idx++) {
							this.sql.exec("INSERT INTO photo_blobs (photo_id, kind, idx, data) VALUES (?, ?, ?, ?)", id, kind, idx, bytes.slice(i, i + CHUNK).buffer);
						}
					}
				});
				results.push({ google_id: gid, status: "saved" });
			} catch {
				results.push({ google_id: gid, status: "download-failed" });
			}
		}
		this.event(actor, "photos.imported", { saved: results.filter((r) => r.status === "saved").length });
		return { results };
	}
	private photoBytes(id: string, kind: "thumb" | "image"): Response {
		const ph = this.one("SELECT mime, filename FROM photos WHERE id = ?", id);
		if (!ph) throw new HttpError(404, "Not found");
		const chunks = this.rows("SELECT data FROM photo_blobs WHERE photo_id = ? AND kind = ? ORDER BY idx", id, kind);
		const parts = chunks.map((c) => new Uint8Array(c.data as ArrayBuffer));
		const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let off = 0;
		for (const part of parts) {
			out.set(part, off);
			off += part.length;
		}
		return new Response(out, { headers: { "content-type": ph.mime, "cache-control": "private, max-age=86400" } });
	}
	private addLifeEvent(b: Row, actor: string) {
		const on = str(b.on_date, "on_date", { required: true, max: 10 })!;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new HttpError(400, "Date must be YYYY-MM-DD");
		const id = ulid();
		this.sql.exec(
			"INSERT INTO life_events (id, at, actor, on_date, title, note, verification) VALUES (?, ?, ?, ?, ?, ?, ?)",
			id,
			new Date().toISOString(),
			actor,
			on,
			str(b.title, "title", { required: true, max: 200 }),
			str(b.note, "note", { max: 4000 }),
			// Entries added by automation come from records, not from a parent's own report.
			actor.startsWith("automation:") ? "EXTRACTED" : "PARENT_REPORT",
		);
		this.event(actor, "life_event.added", { id });
		return { id };
	}
	/** Everything in his story, grouped by week of life, newest first. */
	story() {
		const profile = this.profile();
		if (!profile) return { weeks: [], photos: 0, bytes: 0 };
		type Week = { week: number; start: string; end: string; photos: Row[]; events: Row[]; firsts: Row[]; letters: Row[] };
		const weeks = new Map<number, Week>();
		const slot = (w: { week: number; start: string; end: string }) => {
			if (!weeks.has(w.week)) weeks.set(w.week, { ...w, photos: [], events: [], firsts: [], letters: [] });
			return weeks.get(w.week)!;
		};
		for (const ph of this.rows("SELECT id, taken_at FROM photos ORDER BY taken_at")) slot(weekOfLife(profile.birth_date, Date.parse(ph.taken_at))).photos.push(ph);
		for (const ev of this.rows("SELECT id, on_date, title, note FROM life_events ORDER BY on_date")) slot(weekOfLifeForDate(profile.birth_date, ev.on_date)).events.push(ev);
		for (const o of this.rows("SELECT id, at, text FROM observations WHERE category = 'milestone' ORDER BY at")) slot(weekOfLife(profile.birth_date, Date.parse(o.at))).firsts.push(o);
		for (const l of this.rows("SELECT id, at, signed_as, title FROM letters ORDER BY at")) slot(weekOfLife(profile.birth_date, Date.parse(l.at))).letters.push(l);
		const totals = this.one("SELECT COUNT(*) AS n, COALESCE(SUM(size + thumb_size), 0) AS b FROM photos")!;
		return { weeks: [...weeks.values()].sort((a, b) => b.week - a.week), photos: totals.n, bytes: totals.b };
	}

	private keepsakeSummary() {
		return {
			email: this.setting("keepsake_email"),
			letters: this.rows("SELECT id, at, signed_as, title, body FROM letters ORDER BY at DESC LIMIT 50"),
			kept_ids: this.rows("SELECT item_id FROM keepsake_marks").map((r) => r.item_id),
			keepsakes: this.rows("SELECT id, period, created_at, trigger, subject, counts FROM keepsakes ORDER BY created_at DESC LIMIT 36").map((k) => {
				const d = this.one("SELECT status, detail, at FROM keepsake_deliveries WHERE keepsake_id = ? ORDER BY at DESC LIMIT 1", k.id);
				return { ...k, label: periodLabel(k.period), counts: JSON.parse(k.counts), delivery: d };
			}),
		};
	}

	// ---------------- summary / export ----------------
	private summary() {
		const profile = this.profile();
		const now = new Date().toISOString();
		const next = this.one("SELECT * FROM appointments WHERE starts_at > ? ORDER BY starts_at LIMIT 1", now);
		const lastRun = this.one("SELECT * FROM automation_runs WHERE job = 'scheduled-tick:done' ORDER BY started_at DESC LIMIT 1");
		const docs = this.rows("SELECT id, filename, mime, size, received_at, verification, note, sha256 FROM documents ORDER BY received_at DESC");
		return {
			generated_at: now,
			profile,
			ages: profile ? computeAges(profile.birth_date, profile.ga_weeks, profile.ga_days) : null,
			next_appointment: next ? { ...next, when: formatToronto(next.starts_at) } : null,
			appointments: this.rows("SELECT * FROM appointments ORDER BY starts_at DESC LIMIT 50").map((a) => ({ ...a, when: formatToronto(a.starts_at) })),
			issues: this.openIssues(),
			closed_issues: this.allIssues().filter((i) => i.status === "closed").length,
			medications: this.medications(),
			conflicts: this.openConflicts(),
			observations: this.rows("SELECT * FROM observations ORDER BY at DESC LIMIT 30").map((o) => ({ ...o, tags: JSON.parse(o.tags), red_flags: JSON.parse(o.red_flags), when: formatToronto(o.at) })),
			patterns: this.patterns(),
			documents: docs,
			sources: this.sources(),
			last_automation_run: lastRun,
			red_flag_guidance: RED_FLAG_GUIDANCE,
			keepsake: this.keepsakeSummary(),
		};
	}
	/** Compact, attention-first view for the parent (household) dashboard. */
	private card() {
		const s = this.summary() as any;
		return {
			profile: s.profile ? { display_name: s.profile.display_name, label: s.profile.label, side: s.profile.side } : null,
			ages: s.ages,
			next_appointment: s.next_appointment ? { id: s.next_appointment.id, title: s.next_appointment.title, when: s.next_appointment.when, details_verified: !!s.next_appointment.details_verified } : null,
			open_issues: s.issues.length,
			overdue: s.issues.filter((i: Row) => i.overdue).map((i: Row) => ({ title: i.title, next_action: i.next_action, due_date: i.due_date })),
			conflicts: s.conflicts.map((c: Row) => c.subject),
			meds_needing_check: s.medications.filter((m: Row) => m.status === "unverified" || m.in_conflict).length,
			patterns: s.patterns,
			urgent_last_24h: s.observations.filter((o: Row) => o.red_flags.length && Date.parse(o.at) > Date.now() - 86400000).length,
			sources_not_connected: s.sources.filter((x: Row) => x.status !== "CONNECTED").map((x: Row) => ({ name: x.name, status: x.status })),
			last_log: s.observations[0] ? { when: s.observations[0].when, category: s.observations[0].category } : null,
		};
	}

	private exportAll() {
		const tables = ["events", "profile_versions", "observations", "appointments", "briefs", "issues", "issue_status_events", "medications", "med_status_events", "conflicts", "conflict_resolutions", "documents", "doc_receipts", "sources", "source_status_events", "automation_runs", "letters", "keepsake_marks", "keepsakes", "keepsake_deliveries", "settings", "photos", "life_events"];
		const out: Record<string, Row[]> = {};
		for (const t of tables) out[t] = this.rows(`SELECT * FROM ${t}`);
		return { exported_at: new Date().toISOString(), format: "familyos-person-export/v1", note: "Document bytes are downloadable individually via /api/documents/:id/raw", tables: out };
	}

}
