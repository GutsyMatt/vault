/**
 * SYNTHETIC DEMO DATA ONLY. Not the children's real records.
 * Used by /api/dev/seed, which only works on *.localhost with DEV_AUTH_EMAIL set.
 * Every value here is invented to exercise the features.
 */
const inDays = (d: number, hh = 10, mm = 0) => {
	const t = new Date(Date.now() + d * 86400000);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(hh)}:${p(mm)}`;
};

export const FIXTURES: Record<string, any> = {
	callum: {
		profile: { display_name: "Callum", birth_date: "2026-06-10", ga_weeks: 34, ga_days: 0, label: "Baby A · LEFT", side: "left" },
		medications: [
			{ name: "Demo vitamin D drops", strength: "400 IU/mL", dose_text: "1 mL", frequency: "once daily", verification: "PARENT_REPORT", source_note: "Demo: parent report" },
		],
		issues: [
			{ title: "Newborn screening result not yet seen", specialty: "Pediatrician", owner: "Pediatrician (demo)", next_action: "Ask who holds the result and request a copy", due_date: inDays(5).slice(0, 10), verification: "PARENT_REPORT" },
			{ title: "Growth check: weight trend since discharge", specialty: "GP", owner: "GP (demo)", next_action: "Bring the feeding log; ask for weight to be plotted on the preterm chart", verification: "PARENT_REPORT" },
		],
		logs: ["Bottle 70 ml in 20 min, good feed", "Slept 3 hours", "Wet diaper", "Smiled at Mum for the first time"],
		appointments: [{ title: "Twin vaccinations (demo)", starts_local: inDays(2, 10, 30), provider: "Family doctor (demo)", specialty: "GP", location: "Clinic (demo)", details_verified: false }],
		calendar_failing: true,
	},
	finnley: {
		profile: { display_name: "Finnley", birth_date: "2026-06-10", ga_weeks: 34, ga_days: 0, label: "Baby B · RIGHT", side: "right" },
		medications: [
			{ name: "Demo heart medicine", form: "oral solution", strength: "1 mg/mL", dose_text: "as labelled (demo)", frequency: "three times daily", verification: "PARENT_REPORT", source_note: "Demo: older pharmacy history" },
			{ name: "Demo heart medicine", form: "oral solution", strength: "5 mg/mL", dose_text: "as labelled (demo)", frequency: "three times daily", verification: "EXTRACTED", source_note: "Demo: newer portal summary" },
		],
		issues: [
			{ title: "Feeding / swallow assessment", specialty: "Feeding", owner: "Pediatrician (demo)", next_action: "Ask whether a swallow study referral was sent and to whom", due_date: inDays(-3).slice(0, 10), verification: "PARENT_REPORT" },
			{ title: "Heart rhythm monitor report not on file", specialty: "Cardiology", owner: "Cardiology (demo)", next_action: "Request a copy of the monitor report", verification: "PARENT_REPORT" },
		],
		logs: [
			"Bottle took 45 min again, milk came out his nose",
			"Feed 60 ml, 50 min, lots of spit up",
			"Bottle 55ml took 42 minutes, choking twice",
			"Slept 2 hours",
		],
		appointments: [{ title: "Twin vaccinations (demo)", starts_local: inDays(2, 10, 30), provider: "Family doctor (demo)", specialty: "GP", location: "Clinic (demo)", details_verified: false }],
		calendar_failing: true,
	},
};
