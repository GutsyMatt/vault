/**
 * His story, week by week: photos, past events, firsts and letters grouped by the
 * week of his life they belong to. Pure helpers, no I/O.
 */
import { torontoDate } from "../core/util";

const DAY = 86400000;
const ymdToUtc = (ymd: string) => {
	const [y, m, d] = ymd.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
};
const utcToYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Week of life for an instant: week 1 = birth day + 6 days. 0 or less = before birth. */
export function weekOfLife(birthDate: string, atMs: number): { week: number; start: string; end: string } {
	const day = ymdToUtc(torontoDate(atMs));
	const birth = ymdToUtc(birthDate);
	const days = Math.round((day - birth) / DAY);
	const week = Math.floor(days / 7) + 1; // days 0..6 → week 1
	const start = birth + (week - 1) * 7 * DAY;
	return { week, start: utcToYmd(start), end: utcToYmd(start + 6 * DAY) };
}

/** Same, for a calendar date (YYYY-MM-DD) entered by a parent. */
export function weekOfLifeForDate(birthDate: string, ymd: string) {
	const days = Math.round((ymdToUtc(ymd) - ymdToUtc(birthDate)) / DAY);
	const week = Math.floor(days / 7) + 1;
	const start = ymdToUtc(birthDate) + (week - 1) * 7 * DAY;
	return { week, start: utcToYmd(start), end: utcToYmd(start + 6 * DAY) };
}

/**
 * Only Google's own photo hosts may be fetched with a Google token
 * (prevents the server being pointed at arbitrary URLs).
 */
export function isGooglePhotoUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === "https:" && (u.hostname === "lh3.googleusercontent.com" || /^[a-z0-9-]+\.googleusercontent\.com$/.test(u.hostname)) && !u.username && !u.password;
	} catch {
		return false;
	}
}
