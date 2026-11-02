/**
 * Pure helpers: ids, hashing, time zone, ages, rapid-log parsing, red flags.
 * No I/O, no PHI. Everything here is unit-tested.
 */

export const TZ = "America/Toronto";

// ---------- ids & hashing ----------
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(now = Date.now()): string {
	let t = now;
	let time = "";
	for (let i = 0; i < 10; i++) {
		time = B32[t % 32] + time;
		t = Math.floor(t / 32);
	}
	const rnd = crypto.getRandomValues(new Uint8Array(16));
	let r = "";
	for (let i = 0; i < 16; i++) r += B32[rnd[i] % 32];
	return time + r;
}

export async function sha256Hex(data: BufferSource): Promise<string> {
	const d = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- time zone ----------
/** Offset (minutes, local - UTC) of America/Toronto at a given UTC instant. */
export function torontoOffsetMinutes(utcMs: number): number {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: TZ,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(utcMs));
	const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
	const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
	return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** "2026-11-02T10:30" (Toronto wall clock) -> UTC ISO string. DST-aware. */
export function torontoLocalToUtcIso(local: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
	if (!m) throw new Error("Expected YYYY-MM-DDTHH:mm");
	const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
	// Two passes handle the offset change around DST transitions.
	let guess = wall - torontoOffsetMinutes(wall) * 60000;
	guess = wall - torontoOffsetMinutes(guess) * 60000;
	return new Date(guess).toISOString();
}

export function formatToronto(iso: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: TZ,
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(iso));
}

/** Calendar date (YYYY-MM-DD) in Toronto for an instant. */
export function torontoDate(utcMs: number): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
		new Date(utcMs),
	);
}

// ---------- ages ----------
export interface AgeInfo {
	chronologicalDays: number;
	chronological: string;
	correctedDays: number | null; // null once correction no longer applies
	corrected: string | null;
	pmaWeeks: number; // post-menstrual age, whole weeks
}

function fmtDays(days: number): string {
	if (days < 0) return `${Math.floor(-days / 7)}w ${-days % 7}d before term`;
	const w = Math.floor(days / 7);
	const d = days % 7;
	const base = `${w} week${w === 1 ? "" : "s"} ${d} day${d === 1 ? "" : "s"}`;
	if (days >= 84) {
		const months = Math.floor(days / 30.4375);
		return `${months} month${months === 1 ? "" : "s"} (${base})`;
	}
	return base;
}

/**
 * birthDate: YYYY-MM-DD. gaWeeks/gaDays: gestational age at birth.
 * Corrected age = chronological age - (40w - GA). Shown until 24 months chronological.
 */
export function computeAges(birthDate: string, gaWeeks: number, gaDays: number, nowMs = Date.now()): AgeInfo {
	const today = torontoDate(nowMs);
	const [by, bm, bd] = birthDate.split("-").map(Number);
	const [ty, tm, td] = today.split("-").map(Number);
	const chronologicalDays = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(by, bm - 1, bd)) / 86400000);
	const prematureDays = 280 - (gaWeeks * 7 + gaDays);
	const applies = prematureDays > 0 && chronologicalDays < 730;
	const correctedDays = applies ? chronologicalDays - prematureDays : null;
	return {
		chronologicalDays,
		chronological: fmtDays(chronologicalDays),
		correctedDays,
		corrected: correctedDays === null ? null : fmtDays(correctedDays),
		pmaWeeks: Math.floor((gaWeeks * 7 + gaDays + chronologicalDays) / 7),
	};
}

// ---------- rapid log ----------
export type LogCategory = "feed" | "sleep" | "diaper" | "symptom" | "medication" | "milestone" | "note";
export interface ParsedLog {
	category: LogCategory;
	durationMin: number | null;
	volumeMl: number | null;
	tags: string[];
}

export function parseRapidLog(text: string): ParsedLog {
	const t = text.toLowerCase();
	const tags: string[] = [];
	const has = (re: RegExp) => re.test(t);
	let category: LogCategory = "note";
	if (has(/\b(bottle|feed|fed|feeding|formula|ml|oz|breast|nurs)/)) category = "feed";
	else if (has(/\b(slept|sleep|nap|woke|awake)/)) category = "sleep";
	else if (has(/\b(diaper|nappy|wet|poop|stool|bm)\b/)) category = "diaper";
	else if (has(/\b(gave|dose|med|medicine|medication)\b/)) category = "medication";
	else if (has(/\b(first time|rolled|smiled|smile|laughed|lifted|milestone)/)) category = "milestone";
	if (has(/(vomit|spit|regurg|reflux|choke|choking|chok|cough|gag|arch)/)) {
		if (category === "note") category = "symptom";
	}
	for (const [tag, re] of [
		["regurgitation", /(regurg|spit|reflux)/],
		["nasal-regurgitation", /(nose|nasal)/],
		["choking", /(chok|gag)/],
		["vomit", /vomit/],
		["cough", /cough/],
	] as const) {
		if (re.test(t)) tags.push(tag);
	}
	let durationMin: number | null = null;
	const hm = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(t);
	const mm = /(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(t);
	if (hm) durationMin = Math.round(parseFloat(hm[1]) * 60);
	if (mm) durationMin = (durationMin ?? 0) + parseInt(mm[1], 10);
	let volumeMl: number | null = null;
	const ml = /(\d+(?:\.\d+)?)\s*(ml|cc)\b/.exec(t);
	const oz = /(\d+(?:\.\d+)?)\s*(oz|ounce|ounces)\b/.exec(t);
	if (ml) volumeMl = Math.round(parseFloat(ml[1]));
	else if (oz) volumeMl = Math.round(parseFloat(oz[1]) * 29.5735);
	return { category, durationMin, volumeMl, tags };
}

// ---------- red flags ----------
/**
 * Configuration, not clinical opinion: phrases that should always trigger
 * "seek care" guidance. Review with the care team. Never used to reassure.
 */
export const RED_FLAG_RULES: { id: string; re: RegExp; label: string }[] = [
	{ id: "colour", re: /\b(blue|grey|gray|dusky|purple)\b.*\b(lip|lips|face|skin|colou?r)\b|\b(lip|lips|face)\b.*\b(blue|grey|gray|dusky)\b|turn(ed|ing)? (blue|grey|gray)/, label: "colour change" },
	{ id: "breathing", re: /(not breathing|stopped breathing|breathing pause|pause in breathing|apn(o)?ea|struggling to breathe|working hard to breathe|grunting)/, label: "breathing difficulty or pause" },
	{ id: "responsiveness", re: /\b(limp|floppy|unresponsive|won'?t wake|hard to wake|lethargic)\b/, label: "low responsiveness" },
	{ id: "seizure", re: /seiz|convuls|twitching|jerking/, label: "possible seizure" },
	{ id: "heart", re: /(heart (is )?racing|racing heart|very fast heart|heart rate (of )?(2\d\d|3\d\d)|\bhr (2\d\d|3\d\d)\b|svt)/, label: "fast heart rate" },
	{ id: "hydration", re: /(no wet diaper|no wet nappy|no wet in|fewer wet diapers|dry diaper)/, label: "possible dehydration" },
	{ id: "fever", re: /(fever|temp(erature)? (of )?(38|39|40)|\b3[89](\.\d)? ?c\b)/, label: "fever in a young infant" },
	{ id: "choking-distress", re: /chok\w*.*(distress|couldn'?t breathe|blue|limp)/, label: "choking with distress" },
];

export const RED_FLAG_GUIDANCE =
	"This may need urgent care. If he is struggling to breathe, turning blue or grey, limp, or unresponsive: call 911 now. " +
	"Otherwise call your doctor or Health Connect Ontario (811) now. This app cannot assess symptoms.";

export function detectRedFlags(text: string): string[] {
	const t = text.toLowerCase();
	return RED_FLAG_RULES.filter((r) => r.re.test(t)).map((r) => r.label);
}

// ---------- issues ----------
export const ISSUE_STATUSES = [
	"unraised",
	"raised",
	"ordered",
	"sent",
	"accepted",
	"scheduled",
	"completed",
	"result_reviewed",
	"communicated",
	"closed",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
/** Moving to any of these requires recorded evidence (who/what/when). */
export const EVIDENCE_REQUIRED: IssueStatus[] = [
	"ordered",
	"sent",
	"accepted",
	"scheduled",
	"completed",
	"result_reviewed",
	"communicated",
	"closed",
];

export const VERIFICATION = [
	"CLINICAL_RECORD",
	"EXTRACTED",
	"PARENT_REPORT",
	"AI_INFERENCE",
	"CONFLICT",
	"HISTORICAL",
] as const;
export type Verification = (typeof VERIFICATION)[number];

// ---------- uploads ----------
export function sniffMime(bytes: Uint8Array, declared: string): string | null {
	const s = (n: number) => String.fromCharCode(...bytes.slice(0, n));
	if (s(2) === "MZ" || s(4) === "\x7fELF" || s(2) === "#!") return null; // executables
	if (s(5) === "%PDF-") return "application/pdf";
	if (bytes[0] === 0x89 && s(4).slice(1) === "PNG") return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
	if (s(12).slice(4, 12).startsWith("ftyphei") || s(12).slice(4, 12).startsWith("ftypmif")) return "image/heic";
	if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
		// zip container: allow only office docs by declared type
		if (declared.includes("officedocument")) return declared;
		return null;
	}
	if (["text/plain", "text/csv", "application/json", "application/xml", "text/xml"].includes(declared)) return declared;
	return null;
}
