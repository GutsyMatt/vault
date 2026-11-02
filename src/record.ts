/**
 * Health record summary for the signed-in MyChart patient.
 *
 * Reads the patient's FHIR resources from their provider's Epic server and
 * reduces each one to the few fields the dashboard shows. Each section is
 * loaded independently: patients can choose not to share some kinds of data
 * when they authorize the app, so a section the app can't read is reported
 * as "unavailable" instead of failing the whole record.
 */
import { fetchFhir } from "./auth";
import { PatientSession } from "./types";

// Most recent lab results to show
const MAX_LABS = 20;

// Most recent visits to show
const MAX_VISITS = 10;

type Section<T> =
	| { status: "ok"; items: T[] }
	| { status: "unavailable" }
	| { status: "error" };

export interface HealthRecord {
	patient: {
		name: string;
		birthDate?: string;
		gender?: string;
	};
	medications: Section<{ name: string; dosage?: string; prescribed?: string }>;
	allergies: Section<{ name: string; reaction?: string; severity?: string }>;
	conditions: Section<{ name: string; since?: string }>;
	labs: Section<{
		name: string;
		value?: string;
		range?: string;
		flag?: "high" | "low" | "abnormal";
		date?: string;
	}>;
	immunizations: Section<{ name: string; date?: string }>;
	visits: Section<{
		type: string;
		date?: string;
		location?: string;
		provider?: string;
	}>;
}

// Minimal shapes of the FHIR R4 elements read below
interface CodeableConcept {
	text?: string;
	coding?: { code?: string; display?: string }[];
}
interface Quantity {
	value?: number;
	unit?: string;
}
interface FhirResource {
	resourceType: string;
	[key: string]: any;
}

/**
 * Loads and summarizes the patient's record.
 */
export async function getHealthRecord(
	session: PatientSession,
): Promise<HealthRecord> {
	const id = encodeURIComponent(session.patient);
	const [
		patient,
		medications,
		allergies,
		conditions,
		labs,
		immunizations,
		visits,
	] = await Promise.all([
		fetchResource(session, `Patient/${id}`),
		loadSection(
			session,
			`MedicationRequest?patient=${id}&status=active`,
			"MedicationRequest",
			summarizeMedication,
		),
		loadSection(
			session,
			`AllergyIntolerance?patient=${id}&clinical-status=active`,
			"AllergyIntolerance",
			summarizeAllergy,
		),
		loadSection(
			session,
			`Condition?patient=${id}&category=problem-list-item&clinical-status=active`,
			"Condition",
			summarizeCondition,
		),
		loadSection(
			session,
			`Observation?patient=${id}&category=laboratory`,
			"Observation",
			summarizeLab,
			(items) => newestFirst(items).slice(0, MAX_LABS),
		),
		loadSection(
			session,
			`Immunization?patient=${id}`,
			"Immunization",
			summarizeImmunization,
			newestFirst,
		),
		loadSection(
			session,
			`Encounter?patient=${id}`,
			"Encounter",
			summarizeVisit,
			(items) => newestFirst(items).slice(0, MAX_VISITS),
		),
	]);

	return {
		patient: summarizePatient(patient),
		medications,
		allergies,
		conditions,
		labs,
		immunizations,
		visits,
	};
}

async function fetchResource(
	session: PatientSession,
	path: string,
): Promise<FhirResource> {
	const response = await fetchFhir(session, path);
	if (!response.ok) {
		throw new FhirError(response.status, path);
	}
	return (await response.json()) as FhirResource;
}

async function loadSection<T>(
	session: PatientSession,
	query: string,
	resourceType: string,
	summarize: (resource: FhirResource) => T | null,
	arrange: (items: T[]) => T[] = (items) => items,
): Promise<Section<T>> {
	try {
		const bundle = await fetchResource(session, query);
		// Epic includes OperationOutcome entries (e.g. "no results") in bundles
		const items = ((bundle.entry ?? []) as { resource?: FhirResource }[])
			.map((entry) => entry.resource)
			.filter((resource) => resource?.resourceType === resourceType)
			.map((resource) => summarize(resource!))
			.filter((item): item is T => item !== null);
		return { status: "ok", items: arrange(items) };
	} catch (err) {
		if (err instanceof FhirError && [401, 403].includes(err.status)) {
			return { status: "unavailable" };
		}
		console.error(`Failed to load ${resourceType}:`, err);
		return { status: "error" };
	}
}

class FhirError extends Error {
	constructor(
		readonly status: number,
		path: string,
	) {
		super(`FHIR request ${path.split("?")[0]} failed: ${status}`);
	}
}

// --- Summaries ------------------------------------------------------------

function summarizePatient(patient: FhirResource): HealthRecord["patient"] {
	const names = (patient.name ?? []) as {
		use?: string;
		text?: string;
		given?: string[];
		family?: string;
	}[];
	const name = names.find((n) => n.use === "official") ?? names[0];
	return {
		name:
			name?.text ||
			[...(name?.given ?? []), name?.family].filter(Boolean).join(" ") ||
			"Patient",
		birthDate: patient.birthDate,
		gender: patient.gender,
	};
}

function summarizeMedication(resource: FhirResource) {
	const name =
		conceptText(resource.medicationCodeableConcept) ||
		resource.medicationReference?.display;
	if (!name) return null;
	return {
		name,
		dosage: resource.dosageInstruction?.[0]?.text,
		prescribed: resource.authoredOn,
	};
}

function summarizeAllergy(resource: FhirResource) {
	const name = conceptText(resource.code);
	if (!name) return null;
	return {
		name,
		reaction: conceptText(resource.reaction?.[0]?.manifestation?.[0]),
		severity: resource.reaction?.[0]?.severity ?? resource.criticality,
	};
}

function summarizeCondition(resource: FhirResource) {
	const name = conceptText(resource.code);
	if (!name) return null;
	return { name, since: resource.onsetDateTime ?? resource.recordedDate };
}

function summarizeLab(resource: FhirResource) {
	const name = conceptText(resource.code);
	if (!name) return null;
	return {
		name,
		value: formatValue(resource),
		range: formatRange(resource.referenceRange?.[0]),
		flag: interpretationFlag(resource.interpretation?.[0]),
		date: resource.effectiveDateTime ?? resource.issued,
	};
}

function summarizeImmunization(resource: FhirResource) {
	const name = conceptText(resource.vaccineCode);
	if (!name || resource.status === "entered-in-error") return null;
	return { name, date: resource.occurrenceDateTime };
}

function summarizeVisit(resource: FhirResource) {
	return {
		type:
			conceptText(resource.type?.[0]) ||
			conceptText(resource.class) ||
			resource.class?.display ||
			"Visit",
		date: resource.period?.start,
		location: resource.location?.[0]?.location?.display,
		provider: resource.participant?.[0]?.individual?.display,
	};
}

// --- Helpers ----------------------------------------------------------------

function conceptText(concept?: CodeableConcept): string | undefined {
	return concept?.text || concept?.coding?.find((c) => c.display)?.display;
}

function formatQuantity(quantity?: Quantity): string | undefined {
	if (quantity?.value === undefined) return undefined;
	return quantity.unit
		? `${quantity.value} ${quantity.unit}`
		: `${quantity.value}`;
}

function formatValue(resource: FhirResource): string | undefined {
	return (
		formatQuantity(resource.valueQuantity) ??
		resource.valueString ??
		conceptText(resource.valueCodeableConcept)
	);
}

function formatRange(range?: {
	text?: string;
	low?: Quantity;
	high?: Quantity;
}): string | undefined {
	if (!range) return undefined;
	if (range.text) return range.text;
	const low = formatQuantity(range.low);
	const high = formatQuantity(range.high);
	if (low && high) {
		// "0–99 mg/dL" rather than "0 mg/dL – 99 mg/dL" when units match
		return range.low!.unit === range.high!.unit && range.high!.unit
			? `${range.low!.value}–${range.high!.value} ${range.high!.unit}`
			: `${low} – ${high}`;
	}
	if (low) return `≥ ${low}`;
	if (high) return `≤ ${high}`;
	return undefined;
}

function interpretationFlag(
	interpretation?: CodeableConcept,
): "high" | "low" | "abnormal" | undefined {
	const code = interpretation?.coding?.[0]?.code?.toUpperCase();
	if (!code || code === "N") return undefined;
	if (code.startsWith("H")) return "high";
	if (code.startsWith("L")) return "low";
	return "abnormal";
}

function newestFirst<T extends { date?: string }>(items: T[]): T[] {
	return [...items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
