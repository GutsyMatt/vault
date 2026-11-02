/**
 * Keepsake letters: a monthly, standalone letter to each child about his own life,
 * meant to be read years from now. Built only from what the parents wrote or chose
 * to keep. The system adds a fixed greeting, dates and ages, and never writes in a
 * parent's voice. Medical records are NOT included unless a parent explicitly marks
 * an entry "keep this for him".
 */
import type { AgeInfo } from "../medical/clinical";

export interface KeepsakeInput {
	childName: string;
	period: string; // YYYY-MM
	ages: AgeInfo | null; // at the end of the period
	letters: { signed_as: string; title: string | null; body: string; written_on: string }[];
	milestones: { text: string; on: string }[];
	kept: { text: string; on: string; note: string | null }[];
}

export interface Keepsake {
	subject: string;
	text: string;
	html: string;
	counts: { letters: number; milestones: number; kept: number };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function periodLabel(period: string): string {
	const [y, m] = period.split("-").map(Number);
	return `${MONTHS[m - 1]} ${y}`;
}

/** Previous calendar month (YYYY-MM) for a Toronto date string YYYY-MM-DD. */
export function previousPeriod(torontoYmd: string): string {
	const [y, m] = torontoYmd.split("-").map(Number);
	const py = m === 1 ? y - 1 : y;
	const pm = m === 1 ? 12 : m - 1;
	return `${py}-${String(pm).padStart(2, "0")}`;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildKeepsake(i: KeepsakeInput): Keepsake {
	const when = periodLabel(i.period);
	const subject = `${i.childName}: ${when}`;
	const ageLine = i.ages
		? `At the end of ${when} you were ${i.ages.chronological} old${i.ages.corrected ? ` (${i.ages.corrected} counting from your due date)` : ""}.`
		: "";
	const sections: { heading: string; items: string[] }[] = [];
	if (i.letters.length)
		sections.push({
			heading: "Letters to you",
			items: i.letters.map((l) => `${l.title ? `${l.title}\n` : ""}${l.body}\n— ${l.signed_as}, ${l.written_on}`),
		});
	if (i.milestones.length) sections.push({ heading: "Your firsts", items: i.milestones.map((x) => `${x.on}: ${x.text}`) });
	if (i.kept.length)
		sections.push({ heading: "Moments we kept for you", items: i.kept.map((x) => `${x.on}: ${x.text}${x.note ? `\n   (${x.note})` : ""}`) });
	const empty = !sections.length;
	const intro = `Dear ${i.childName},\n\nThis is your family's record of ${when}.${ageLine ? ` ${ageLine}` : ""}`;
	const footer = `This letter was put together by FamilyOS from what your parents wrote and chose to keep. Every word under "Letters to you" is theirs.`;
	const text = [
		intro,
		empty ? "Nothing was written down for you this month, but you were loved every day of it." : "",
		...sections.map((s) => `\n${s.heading.toUpperCase()}\n\n${s.items.join("\n\n")}`),
		`\n---\n${footer}`,
	]
		.filter(Boolean)
		.join("\n");
	const html = `<!doctype html><html><body style="font-family:Georgia,serif;max-width:640px;margin:auto;padding:16px;line-height:1.6;color:#222">
<h1 style="font-size:1.5rem">${esc(subject)}</h1>
<p>Dear ${esc(i.childName)},</p><p>This is your family's record of ${esc(when)}.${ageLine ? ` ${esc(ageLine)}` : ""}</p>
${empty ? "<p>Nothing was written down for you this month, but you were loved every day of it.</p>" : ""}
${sections
	.map(
		(s) =>
			`<h2 style="font-size:1.15rem;margin-top:28px">${esc(s.heading)}</h2>${s.items.map((it) => `<p style="white-space:pre-wrap">${esc(it)}</p>`).join("")}`,
	)
	.join("")}
<hr><p style="font-size:.85rem;color:#666">${esc(footer)}</p></body></html>`;
	return { subject, text, html, counts: { letters: i.letters.length, milestones: i.milestones.length, kept: i.kept.length } };
}
