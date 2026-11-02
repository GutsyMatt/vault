/**
 * MyChart export reader: C-CDA documents ("My Health Summary" download) to plain entries.
 *
 * Epic MyChart's download is either one CDA XML file or a zip (IHE XDM layout:
 * DOC0001.XML…, METADATA.XML, STYLE.XSL). This reads only coded, structured
 * entries; it never interprets free text as instructions and never infers
 * anything that isn't in the document. Pure functions, no PHI in errors.
 */

// ---------- minimal XML parser (no DTDs, no custom entities) ----------
export interface XmlNode {
	name: string; // local name, namespace prefix removed
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
}

const MAX_DEPTH = 256;

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
		const k = e.toLowerCase();
		if (k === "lt") return "<";
		if (k === "gt") return ">";
		if (k === "amp") return "&";
		if (k === "quot") return '"';
		if (k === "apos") return "'";
		const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
		return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
	});
}

const localName = (n: string) => n.slice(n.indexOf(":") + 1);

export function parseXml(xml: string): XmlNode {
	const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
	const stack: XmlNode[] = [root];
	let i = 0;
	while (i < xml.length) {
		const lt = xml.indexOf("<", i);
		const top = stack[stack.length - 1];
		if (lt === -1) {
			top.text += decodeEntities(xml.slice(i));
			break;
		}
		if (lt > i) top.text += decodeEntities(xml.slice(i, lt));
		if (xml.startsWith("<!--", lt)) {
			const end = xml.indexOf("-->", lt + 4);
			if (end === -1) throw new Error("Unclosed comment");
			i = end + 3;
		} else if (xml.startsWith("<![CDATA[", lt)) {
			const end = xml.indexOf("]]>", lt + 9);
			if (end === -1) throw new Error("Unclosed CDATA");
			top.text += xml.slice(lt + 9, end);
			i = end + 3;
		} else if (xml.startsWith("<?", lt)) {
			const end = xml.indexOf("?>", lt + 2);
			if (end === -1) throw new Error("Unclosed declaration");
			i = end + 2;
		} else if (xml.startsWith("<!", lt)) {
			// DOCTYPE and other declarations are skipped; custom entities are never expanded.
			const end = xml.indexOf(">", lt + 2);
			if (end === -1) throw new Error("Unclosed declaration");
			i = end + 1;
		} else if (xml.startsWith("</", lt)) {
			const end = xml.indexOf(">", lt + 2);
			if (end === -1) throw new Error("Unclosed tag");
			const name = localName(xml.slice(lt + 2, end).trim());
			if (stack.length < 2 || top.name !== name) throw new Error("Mismatched tag");
			stack.pop();
			i = end + 1;
		} else {
			// Find the end of the start tag, skipping over quoted attribute values.
			let j = lt + 1;
			let quote = "";
			for (; j < xml.length; j++) {
				const c = xml[j];
				if (quote) {
					if (c === quote) quote = "";
				} else if (c === '"' || c === "'") quote = c;
				else if (c === ">") break;
			}
			if (j >= xml.length) throw new Error("Unclosed tag");
			let body = xml.slice(lt + 1, j);
			const selfClosing = body.endsWith("/");
			if (selfClosing) body = body.slice(0, -1);
			const m = body.match(/^\s*([^\s/>]+)/);
			if (!m) throw new Error("Bad tag");
			const node: XmlNode = { name: localName(m[1]), attrs: {}, children: [], text: "" };
			for (const a of body.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
				node.attrs[localName(a[1])] = decodeEntities(a[3] ?? a[4] ?? "");
			}
			top.children.push(node);
			if (!selfClosing) {
				if (stack.length > MAX_DEPTH) throw new Error("Document is nested too deeply");
				stack.push(node);
			}
			i = j + 1;
		}
	}
	if (stack.length !== 1) throw new Error("Unclosed element");
	return root;
}

const kids = (n: XmlNode | undefined, name: string) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name);
/** Follow a path of child element names, e.g. path(node, "patientRole", "patient"). */
function path(n: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
	for (const name of names) n = kid(n, name);
	return n;
}
function* descendants(n: XmlNode): Generator<XmlNode> {
	for (const c of n.children) {
		yield c;
		yield* descendants(c);
	}
}
function textOf(n: XmlNode | undefined): string {
	if (!n) return "";
	return (n.text + n.children.map(textOf).join(" ")).replace(/\s+/g, " ").trim();
}

// ---------- zip (MyChart's "Download" button) ----------
const MAX_ZIP_ENTRIES = 500;
const MAX_UNZIPPED = 60 * 1024 * 1024;

export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Returns the .xml files in a zip as text. Supports stored and deflated entries; not zip64. */
export async function unzipXmlFiles(buf: Uint8Array): Promise<{ name: string; text: string }[]> {
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let eocd = -1;
	for (let p = buf.length - 22; p >= Math.max(0, buf.length - 22 - 65535); p--) {
		if (dv.getUint32(p, true) === 0x06054b50) {
			eocd = p;
			break;
		}
	}
	if (eocd < 0) throw new Error("Not a readable zip file");
	const count = dv.getUint16(eocd + 10, true);
	let p = dv.getUint32(eocd + 16, true);
	if (count > MAX_ZIP_ENTRIES || p >= buf.length) throw new Error("Not a readable zip file");
	const out: { name: string; text: string }[] = [];
	let total = 0;
	for (let n = 0; n < count; n++) {
		if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("Not a readable zip file");
		const method = dv.getUint16(p + 10, true);
		const compSize = dv.getUint32(p + 20, true);
		const size = dv.getUint32(p + 24, true);
		const nameLen = dv.getUint16(p + 28, true);
		const extraLen = dv.getUint16(p + 30, true);
		const commentLen = dv.getUint16(p + 32, true);
		const local = dv.getUint32(p + 42, true);
		const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
		p += 46 + nameLen + extraLen + commentLen;
		if (!/\.xml$/i.test(name) || /(^|\/)metadata\.xml$/i.test(name)) continue;
		if (compSize === 0xffffffff || size === 0xffffffff) throw new Error("This zip format isn't supported");
		total += size;
		if (total > MAX_UNZIPPED) throw new Error("The export is too large");
		if (local + 30 > buf.length || dv.getUint32(local, true) !== 0x04034b50) throw new Error("Not a readable zip file");
		const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
		const data = buf.subarray(start, start + compSize);
		let bytes: Uint8Array;
		if (method === 0) bytes = data;
		else if (method === 8) {
			const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
			bytes = new Uint8Array(await new Response(stream).arrayBuffer());
		} else throw new Error("This zip format isn't supported");
		if (bytes.length > size + 1024) throw new Error("Not a readable zip file");
		out.push({ name, text: new TextDecoder().decode(bytes) });
	}
	return out;
}

// ---------- CDA ----------
export type EntryKind = "allergy" | "problem" | "immunization" | "result" | "vital" | "encounter";

export interface CdaEntry {
	kind: EntryKind;
	on_date: string | null; // YYYY-MM-DD
	title: string;
	value?: string | null;
	unit?: string | null;
	ref_range?: string | null;
	flag?: "high" | "low" | "abnormal" | null;
	status?: string | null;
	detail?: Record<string, string>;
}

export interface CdaMedication {
	name: string;
	strength: string | null;
	form: string | null;
	dose_text: string | null;
	frequency: string | null;
	prescriber: string | null;
	start: string | null;
	active: boolean;
	label: string; // as written in the document
}

export interface CdaDocument {
	title: string;
	created: string | null; // YYYY-MM-DD
	organization: string | null;
	patient: { given: string[]; family: string; birth_date: string | null };
	entries: CdaEntry[];
	medications: CdaMedication[];
}

// LOINC codes for the C-CDA sections read here.
const SECTION = {
	allergies: "48765-2",
	medications: "10160-0",
	problems: "11450-4",
	immunizations: "11369-6",
	results: "30954-2",
	vitals: "8716-3",
	encounters: "46240-8",
} as const;

/** HL7 timestamp ("20260616061500-0400") to a calendar date. */
export function hl7Date(v: string | undefined): string | null {
	const m = v?.match(/^(\d{4})(\d{2})?(\d{2})?/);
	if (!m) return null;
	return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
}

/** Resolves a coded element's human text: displayName, originalText or its narrative reference. */
function display(n: XmlNode | undefined, ids: Map<string, string>): string {
	if (!n) return "";
	const orig = kid(n, "originalText");
	const ref = kid(orig, "reference")?.attrs.value;
	if (ref?.startsWith("#") && ids.get(ref.slice(1))) return ids.get(ref.slice(1))!;
	return textOf(orig) || n.attrs.displayName || kid(n, "translation")?.attrs.displayName || "";
}

function effectiveDate(n: XmlNode | undefined): string | null {
	const et = kid(n, "effectiveTime");
	return hl7Date(et?.attrs.value) ?? hl7Date(kid(et, "low")?.attrs.value) ?? null;
}

function personName(n: XmlNode | undefined): string {
	const name = kid(n, "name");
	if (!name) return "";
	const parts = [...kids(name, "prefix"), ...kids(name, "given"), ...kids(name, "family"), ...kids(name, "suffix")].map(textOf);
	return parts.filter(Boolean).join(" ") || textOf(name);
}

function valueText(v: XmlNode | undefined, ids: Map<string, string>): { value: string | null; unit: string | null } {
	if (!v) return { value: null, unit: null };
	const type = v.attrs.type || "";
	if (v.attrs.value !== undefined && (type.endsWith("PQ") || v.attrs.unit !== undefined)) {
		return { value: v.attrs.value, unit: v.attrs.unit && v.attrs.unit !== "1" ? v.attrs.unit : null };
	}
	if (type.endsWith("CD") || type.endsWith("CE") || v.attrs.code) return { value: display(v, ids) || v.attrs.code || null, unit: null };
	return { value: textOf(v) || v.attrs.value || null, unit: null };
}

function refRange(obs: XmlNode, ids: Map<string, string>): string | null {
	const range = path(obs, "referenceRange", "observationRange");
	if (!range) return null;
	const v = kid(range, "value");
	const low = kid(v, "low")?.attrs;
	const high = kid(v, "high")?.attrs;
	const unit = high?.unit ?? low?.unit;
	const u = unit && unit !== "1" ? ` ${unit}` : "";
	if (low?.value && high?.value) return `${low.value}–${high.value}${u}`;
	if (high?.value) return `≤ ${high.value}${u}`;
	if (low?.value) return `≥ ${low.value}${u}`;
	return display(range, ids) || textOf(kid(range, "text")) || null;
}

function interpretation(obs: XmlNode): CdaEntry["flag"] {
	const code = kid(obs, "interpretationCode")?.attrs.code?.toUpperCase();
	if (!code || code === "N") return null;
	if (code.startsWith("H")) return "high";
	if (code.startsWith("L")) return "low";
	return "abnormal";
}

/** Splits "propranolol 5 mg/mL oral solution" into name, strength and form. */
export function splitMedicationName(label: string): { name: string; strength: string | null; form: string | null } {
	const m = label.match(/^(.*?)\s+(\d[\d.,]*\s*(?:mg|mcg|g|mL|units?|unit|mmol|%|IU)(?:\s*\/\s*[\d.]*\s*(?:mL|L|kg|tab|dose|actuation))?)\b\s*(.*)$/i);
	if (!m || !m[1].trim()) return { name: label.trim(), strength: null, form: null };
	return { name: m[1].trim(), strength: m[2].replace(/\s+/g, " ").trim(), form: m[3].trim() || null };
}

function frequency(sa: XmlNode): string | null {
	for (const et of kids(sa, "effectiveTime")) {
		const period = kid(et, "period");
		if (period?.attrs.value) {
			const unit = ({ h: "hours", d: "days", wk: "weeks", min: "minutes" } as Record<string, string>)[period.attrs.unit || ""] ?? period.attrs.unit ?? "";
			return `every ${period.attrs.value} ${unit}`.trim();
		}
	}
	return null;
}

export function parseCcda(xml: string): CdaDocument {
	const doc = parseXml(xml.replace(/^﻿/, ""));
	const cd = kid(doc, "ClinicalDocument");
	if (!cd) throw new Error("This isn't a clinical document (CDA) export");

	const ids = new Map<string, string>();
	for (const n of descendants(cd)) if (n.attrs.ID) ids.set(n.attrs.ID, textOf(n));

	const patient = path(cd, "recordTarget", "patientRole", "patient");
	const pname = kid(patient, "name");
	const result: CdaDocument = {
		title: textOf(kid(cd, "title")) || "Clinical document",
		created: hl7Date(kid(cd, "effectiveTime")?.attrs.value),
		organization: textOf(path(cd, "custodian", "assignedCustodian", "representedCustodianOrganization", "name")) || null,
		patient: {
			given: kids(pname, "given").map(textOf).filter(Boolean),
			family: textOf(kid(pname, "family")),
			birth_date: hl7Date(kid(patient, "birthTime")?.attrs.value),
		},
		entries: [],
		medications: [],
	};

	const sections = [...descendants(cd)].filter((n) => n.name === "section");
	const sectionsFor = (loinc: string) => sections.filter((s) => kid(s, "code")?.attrs.code === loinc);
	const entriesOf = (s: XmlNode) => kids(s, "entry").flatMap((e) => e.children);
	const add = (e: CdaEntry) => {
		if (e.title) result.entries.push(e);
	};

	for (const s of sectionsFor(SECTION.allergies)) {
		for (const act of entriesOf(s)) {
			const obs = act.name === "observation" ? act : path(act, "entryRelationship", "observation");
			if (!obs) continue;
			if (obs.attrs.negationInd === "true") {
				add({ kind: "allergy", on_date: effectiveDate(obs), title: "No known allergies", status: "none-known" });
				continue;
			}
			const substance = display(path(obs, "participant", "participantRole", "playingEntity", "code"), ids) || textOf(path(obs, "participant", "participantRole", "playingEntity", "name"));
			// Reaction: entryRelationship typeCode="MFST". Severity: an observation coded SEV, on the allergy or its reaction.
			const reaction = kid(kids(obs, "entryRelationship").find((r) => r.attrs.typeCode === "MFST"), "observation");
			const severity = [...descendants(obs)].find((n) => n.name === "observation" && kid(n, "code")?.attrs.code === "SEV");
			add({
				kind: "allergy",
				on_date: effectiveDate(obs),
				title: substance,
				value: reaction ? display(kid(reaction, "value"), ids) || null : null,
				status: severity ? display(kid(severity, "value"), ids) || null : null,
			});
		}
	}

	for (const s of sectionsFor(SECTION.problems)) {
		for (const act of entriesOf(s)) {
			const obs = act.name === "observation" ? act : path(act, "entryRelationship", "observation");
			if (!obs || obs.attrs.negationInd === "true") continue;
			add({ kind: "problem", on_date: effectiveDate(obs), title: display(kid(obs, "value"), ids), status: kid(act, "statusCode")?.attrs.code ?? null });
		}
	}

	for (const s of sectionsFor(SECTION.immunizations)) {
		for (const sa of entriesOf(s)) {
			if (sa.name !== "substanceAdministration") continue;
			add({
				kind: "immunization",
				on_date: effectiveDate(sa),
				title: display(path(sa, "consumable", "manufacturedProduct", "manufacturedMaterial", "code"), ids),
				status: sa.attrs.negationInd === "true" ? "not given" : (kid(sa, "statusCode")?.attrs.code ?? null),
			});
		}
	}

	const observationsIn = (s: XmlNode) =>
		entriesOf(s).flatMap((e) => (e.name === "organizer" ? kids(e, "component").map((c) => kid(c, "observation")) : [e])).filter((o): o is XmlNode => o?.name === "observation");
	for (const [loinc, kind] of [
		[SECTION.results, "result"],
		[SECTION.vitals, "vital"],
	] as const) {
		for (const s of sectionsFor(loinc)) {
			for (const obs of observationsIn(s)) {
				const { value, unit } = valueText(kid(obs, "value"), ids);
				add({ kind, on_date: effectiveDate(obs), title: display(kid(obs, "code"), ids), value, unit, ref_range: refRange(obs, ids), flag: interpretation(obs) });
			}
		}
	}

	for (const s of sectionsFor(SECTION.encounters)) {
		for (const enc of entriesOf(s)) {
			if (enc.name !== "encounter") continue;
			const performer = personName(path(enc, "performer", "assignedEntity", "assignedPerson"));
			const location = textOf(path(enc, "participant", "participantRole", "playingEntity", "name"));
			add({
				kind: "encounter",
				on_date: effectiveDate(enc),
				title: display(kid(enc, "code"), ids) || "Visit",
				value: [performer, location].filter(Boolean).join(" · ") || null,
			});
		}
	}

	for (const s of sectionsFor(SECTION.medications)) {
		for (const sa of entriesOf(s)) {
			if (sa.name !== "substanceAdministration") continue;
			const label = display(path(sa, "consumable", "manufacturedProduct", "manufacturedMaterial", "code"), ids) || textOf(path(sa, "consumable", "manufacturedProduct", "manufacturedMaterial", "name"));
			if (!label) continue;
			const split = splitMedicationName(label);
			const dose = kid(sa, "doseQuantity")?.attrs;
			const sig = ids.get(kid(sa, "text")?.children.find((c) => c.name === "reference")?.attrs.value?.slice(1) ?? "") || textOf(kid(sa, "text")) || null;
			const route = kid(sa, "routeCode")?.attrs.displayName;
			const status = kid(sa, "statusCode")?.attrs.code;
			const end = kids(sa, "effectiveTime").map((et) => hl7Date(kid(et, "high")?.attrs.value)).find(Boolean);
			result.medications.push({
				...split,
				label,
				dose_text: sig || (dose?.value ? `${dose.value}${dose.unit && dose.unit !== "1" ? ` ${dose.unit}` : ""}${route ? ` ${route.toLowerCase()}` : ""}` : null),
				frequency: frequency(sa),
				prescriber: personName(path(sa, "author", "assignedAuthor", "assignedPerson")) || null,
				start: kids(sa, "effectiveTime").map((et) => hl7Date(kid(et, "low")?.attrs.value)).find(Boolean) ?? null,
				active: status !== "completed" && status !== "aborted" && status !== "cancelled" && !(end && end < new Date().toISOString().slice(0, 10)),
			});
		}
	}
	return result;
}

/**
 * Reads an uploaded MyChart export (one CDA XML, or MyChart's zip). Returns every
 * CDA document found; throws with a plain-language message otherwise.
 */
export async function readMyChartExport(buf: Uint8Array): Promise<{ kind: "zip" | "xml"; documents: CdaDocument[] }> {
	const zip = isZip(buf);
	const files = zip ? await unzipXmlFiles(buf) : [{ name: "upload.xml", text: new TextDecoder().decode(buf) }];
	const documents: CdaDocument[] = [];
	for (const f of files) {
		if (!/<(\w+:)?ClinicalDocument[\s>]/.test(f.text.slice(0, 4096))) continue;
		documents.push(parseCcda(f.text));
	}
	if (!documents.length) throw new Error("No MyChart health summary (CDA document) was found in this file");
	return { kind: zip ? "zip" : "xml", documents };
}
