/**
 * FamilyOS medical domain rules: corrected age, quick-log parsing, urgent-phrase
 * detection, issue lifecycle and verification classes. Pure functions, no PHI.
 */
import { torontoDate } from "../core/util";

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
