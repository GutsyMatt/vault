/**
 * FamilyOS core utilities: ids, hashing, America/Toronto time, upload type checks.
 * Pure functions, no I/O, no PHI.
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
