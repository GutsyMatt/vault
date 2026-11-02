// FamilyOS client. Plain JS, no build step. All data comes from the authenticated /api.
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) =>
	String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const VLABEL = {
	CLINICAL_RECORD: "Clinical record",
	EXTRACTED: "Extracted, unchecked",
	PARENT_REPORT: "Parent report",
	AI_INFERENCE: "System pattern",
	CONFLICT: "Conflict",
	HISTORICAL: "Historical",
};
const vbadge = (v) => `<span class="badge v-${esc(v)}">${esc(VLABEL[v] || v)}</span>`;
const STATUSES = ["unraised", "raised", "ordered", "sent", "accepted", "scheduled", "completed", "result_reviewed", "communicated", "closed"];
const nice = (s) => String(s).replace(/_/g, " ");

let state = null;
let tab = "today";

async function api(path, opts = {}) {
	const res = await fetch(`/api${path}`, { credentials: "same-origin", ...opts });
	if (res.status === 401) {
		// Sign-in expired: reload to show the sign-in page.
		location.reload();
		throw new Error("Signing in again…");
	}
	const ct = res.headers.get("content-type") || "";
	const body = ct.includes("json") ? await res.json() : null;
	if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
	return body;
}
const post = (path, data) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

function toast(msg) {
	const t = $("#toast");
	t.textContent = msg;
	t.hidden = false;
	clearTimeout(toast.t);
	toast.t = setTimeout(() => (t.hidden = true), 5000);
}
function showAlert(msg) {
	const a = $("#alert");
	a.textContent = msg;
	a.hidden = !msg;
}
function sheet(title, html) {
	$("#sheet-title").textContent = title;
	$("#sheet-body").innerHTML = html;
	const d = $("#sheet");
	if (!d.open) d.showModal();
	return $("#sheet-body");
}
$("#sheet-close").addEventListener("click", () => $("#sheet").close());
// Errors inside a dialog must show inside it (the toast sits behind the modal layer).
function sheetError(msg) {
	let e = $("#sheet-error");
	if (!e) {
		e = document.createElement("p");
		e.id = "sheet-error";
		e.className = "alert";
		e.setAttribute("role", "alert");
		$("#sheet-body").prepend(e);
	}
	e.textContent = msg;
	e.scrollIntoView({ block: "nearest" });
}

async function load() {
	if (!load.mode) {
		try {
			load.mode = (await api("/whoami")).mode;
		} catch (e) {
			$("#fresh").textContent = `Could not load: ${e.message}`;
			return;
		}
	}
	if (load.mode === "household") return loadHousehold();
	try {
		state = await api("/summary");
	} catch (e) {
		$("#fresh").textContent = `Could not load: ${e.message}. Nothing shown below is current.`;
		return;
	}
	renderHeader();
	if (!state.profile) return renderSetup();
	$("#setup").hidden = true;
	document.querySelector(".tabs").hidden = false;
	render();
}

function renderHeader() {
	const p = state.profile;
	const side = p?.side || "";
	$("#top").dataset.side = side;
	$("#child-name").textContent = p?.display_name || "Set up this record";
	document.title = p ? `${p.display_name} · FamilyOS` : "FamilyOS";
	const lab = $("#child-label");
	lab.hidden = !p?.label;
	lab.textContent = p?.label || "";
	lab.dataset.side = side;
	const a = state.ages;
	$("#ages").textContent = a ? `Age ${a.chronological}${a.corrected ? ` · Corrected ${a.corrected}` : ""}` : "";
	const t = new Date(state.generated_at);
	$("#fresh").textContent = `Updated ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. ${state.sources.filter((s) => s.status !== "CONNECTED").length} source(s) not connected (see Sources).`;
}

function renderSetup() {
	const el = $("#setup");
	el.hidden = false;
	document.querySelector(".tabs").hidden = true;
	document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = true));
	el.innerHTML = `
	<div class="card">
		<h2>Set up this record</h2>
		<p class="muted">Enter the basics once. You can correct them later; earlier versions are kept.</p>
		<form id="profile-form">
			<label for="pf-name">Name</label><input id="pf-name" name="display_name" required autocomplete="off">
			<div class="grid2">
				<div><label for="pf-birth">Birth date</label><input id="pf-birth" name="birth_date" type="date" required></div>
				<div><label for="pf-label">Label (optional)</label><input id="pf-label" name="label" placeholder="Baby A · LEFT"></div>
				<div><label for="pf-gaw">Weeks at birth</label><input id="pf-gaw" name="ga_weeks" type="number" min="22" max="44" required></div>
				<div><label for="pf-gad">+ days</label><input id="pf-gad" name="ga_days" type="number" min="0" max="6" value="0"></div>
			</div>
			<label for="pf-side">Colour / side</label>
			<select id="pf-side" name="side"><option value="">None</option><option value="left">Left</option><option value="right">Right</option></select>
			<p><button type="submit">Save</button></p>
		</form>
	</div>`;
	$("#profile-form").addEventListener("submit", async (e) => {
		e.preventDefault();
		const f = Object.fromEntries(new FormData(e.target));
		try {
			await api("/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, ga_weeks: +f.ga_weeks, ga_days: +f.ga_days }) });
			load();
		} catch (err) {
			toast(err.message);
		}
	});
}

function render() {
	document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
	document.querySelectorAll(".tabs button").forEach((b) => (b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
	({ today: renderToday, issues: renderIssues, record: renderRecord, sources: renderSources })[tab]();
}
document.querySelectorAll(".tabs button").forEach((b) =>
	b.addEventListener("click", () => {
		tab = b.dataset.tab;
		if (state?.profile) render();
	}),
);

// ---------- Today ----------
function medLine(m) {
	const st = m.in_conflict ? `<span class="badge v-CONFLICT">Records disagree</span>` : m.status === "verified" ? `<span class="badge s-verified">Verified</span>` : m.status === "historical" ? `<span class="badge s-historical">Historical</span>` : `<span class="badge s-unverified">Needs check</span>`;
	return `<li><div class="row between"><strong>${esc(m.name)}</strong>${st}</div>
		<div>${esc([m.strength, m.dose_text, m.frequency].filter(Boolean).join(" · "))}</div>
		<div class="small muted">${vbadge(m.verification)} ${esc(m.source_note || "")}</div></li>`;
}

function renderToday() {
	const s = state;
	const el = $('[data-panel="today"]');
	const attn = [
		...s.conflicts.map((c) => `<li><span class="badge v-CONFLICT">Conflict</span> ${esc(c.description)}</li>`),
		...s.issues.filter((i) => i.overdue).map((i) => `<li><span class="badge overdue">Overdue</span> ${esc(i.title)}${i.next_action ? ` → ${esc(i.next_action)}` : ""}</li>`),
		...s.patterns.map((p) => `<li>${vbadge("AI_INFERENCE")} ${esc(p)}</li>`),
		...s.sources.filter((x) => x.status !== "CONNECTED").slice(0, 1).map((x) => `<li><span class="badge s-${x.status.replace(" ", "-")}">${esc(x.status)}</span> ${esc(x.name)}: appointments there are not being detected.</li>`),
	];
	const n = s.next_appointment;
	el.innerHTML = `
	<div class="card">
		<h2><label for="quick" class="nolabel">Quick log</label></h2>
		<form id="log-form">
			<textarea id="quick" name="text" placeholder="e.g. Bottle 60 ml took 45 min, milk out his nose" required></textarea>
			<div class="row">
				<button type="submit">Log it</button>
				<button type="button" class="ghost" id="dictate" hidden>🎤 Speak</button>
			</div>
			<div class="row small" aria-label="Quick entries">
				${["Wet diaper", "Dirty diaper", "Slept", "Spit up", "Good feed"].map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}
			</div>
		</form>
		<p class="small muted">Saved as a parent report with the time. Nothing here is treated as a diagnosis.</p>
	</div>
	${attn.length ? `<div class="card attn"><h2>Needs attention</h2><ul class="list">${attn.join("")}</ul></div>` : ""}
	<div class="card">
		<h2>Next appointment</h2>
		${n ? `<p><strong>${esc(n.title)}</strong><br>${esc(n.when)}${n.provider ? ` · ${esc(n.provider)}` : ""}${n.location ? ` · ${esc(n.location)}` : ""}</p>
			${n.details_verified ? "" : `<p class="small"><span class="badge v-AI_INFERENCE">Time/place not verified</span></p>`}
			<button data-brief="${esc(n.id)}">Open visit brief</button>` : `<p class="muted">No upcoming appointment is recorded. <strong>That does not mean there isn't one</strong>: check Sources.</p>`}
	</div>
	<div class="card"><h2>Medications</h2><ul class="list">${s.medications.filter((m) => m.status !== "historical").map(medLine).join("") || `<li class="muted">None recorded.</li>`}</ul>
		<p class="small muted">Always follow the current bottle label and prescriber. This app never calculates doses.</p></div>
	<div class="card"><h2>Recent log</h2><ul class="list">${
		s.observations.slice(0, 8).map((o) => `<li><div class="row between"><span class="badge">${esc(o.category)}</span><span class="small muted">${esc(o.when)}</span></div><div>${esc(o.text)}</div>${o.red_flags.length ? `<div class="small"><span class="badge v-CONFLICT">Urgent phrase: ${esc(o.red_flags.join(", "))}</span></div>` : ""}</li>`).join("") || `<li class="muted">Nothing logged yet.</li>`
	}</ul></div>`;

	const form = $("#log-form");
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const text = $("#quick").value.trim();
		if (!text) return;
		try {
			const r = await post("/log", { text });
			const bits = [r.parsed.category, r.parsed.durationMin && `${r.parsed.durationMin} min`, r.parsed.volumeMl && `${r.parsed.volumeMl} ml`, ...r.parsed.tags].filter(Boolean);
			toast(`Logged: ${bits.join(" · ")}`);
			showAlert(r.guidance || "");
			$("#quick").value = "";
			await load();
		} catch (err) {
			toast(err.message);
		}
	});
	el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { $("#quick").value = b.dataset.q; form.requestSubmit(); }));
	const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
	if (SR) {
		const d = $("#dictate");
		d.hidden = false;
		d.addEventListener("click", () => {
			const r = new SR();
			r.lang = "en-CA";
			r.onresult = (ev) => ($("#quick").value = ev.results[0][0].transcript);
			r.start();
		});
	}
	bindBriefButtons(el);
}

// ---------- Brief ----------
function bindBriefButtons(el) {
	el.querySelectorAll("[data-brief]").forEach((b) => b.addEventListener("click", () => openBrief(b.dataset.brief)));
}
async function openBrief(id) {
	const body = sheet("Visit brief", `<p class="muted">Preparing…</p>`);
	try {
		const b = await api(`/appointments/${id}/brief`);
		const c = b.content;
		const text = [];
		body.innerHTML = `<div class="brief">
			<div class="row no-print"><button id="print">Print</button><button class="ghost" id="speak">Read aloud</button></div>
			<h3>${esc(c.child || "")} ${c.label ? `· ${esc(c.label)}` : ""}</h3>
			<p>${esc(c.appointment.title)}<br>${esc(c.appointment.when)}${c.appointment.provider ? ` · ${esc(c.appointment.provider)}` : ""}${c.appointment.details_verified ? "" : " (time/place not verified)"}</p>
			${c.ages ? `<p class="small">Age ${esc(c.ages.chronological)}${c.ages.corrected ? ` · corrected ${esc(c.ages.corrected)}` : ""}</p>` : ""}
			${c.sections.map((s) => `<h3>${esc(s.heading)}</h3>${s.items.length ? `<ul>${s.items.map((i) => `<li>${esc(i.text)} ${vbadge(i.verification)}</li>`).join("")}</ul>` : `<p class="muted small">Nothing recorded.</p>`}`).join("")}
			<p class="small muted">${esc(c.disclaimer)}</p>
			<p class="small muted">Version generated ${esc(new Date(b.created_at).toLocaleString())}. ${b.history.length} version(s) kept.</p>
		</div>`;
		text.push(`${c.child}. ${c.appointment.title}, ${c.appointment.when}.`);
		for (const s of c.sections) if (s.items.length) text.push(`${s.heading}. ${s.items.map((i) => i.text).join(". ")}.`);
		$("#print").addEventListener("click", () => window.print());
		$("#speak").addEventListener("click", () => {
			speechSynthesis.cancel();
			speechSynthesis.speak(new SpeechSynthesisUtterance(text.join(" ")));
		});
	} catch (e) {
		body.innerHTML = `<p>${esc(e.message)}</p>`;
	}
}

// ---------- Issues ----------
function renderIssues() {
	const el = $('[data-panel="issues"]');
	el.innerHTML = `
	<div class="card"><div class="row between"><h2>Open issues</h2><button class="ghost" id="new-issue">+ Add</button></div>
	<ul class="list">${
		state.issues.map((i) => `<li><button class="ghost" data-issue="${esc(i.id)}" aria-label="Open ${esc(i.title)}">${esc(i.title)}</button>
			<div class="row small"><span class="badge">${esc(nice(i.status))}</span>${i.overdue ? `<span class="badge overdue">Overdue ${esc(i.due_date)}</span>` : i.due_date ? `<span class="badge">Due ${esc(i.due_date)}</span>` : ""}${i.specialty ? `<span class="badge">${esc(i.specialty)}</span>` : ""}${vbadge(i.verification)}</div>
			<div class="small">Owner: ${esc(i.owner || "not assigned")}${i.next_action ? ` · Next: ${esc(i.next_action)}` : ""}</div></li>`).join("") || `<li class="muted">No open issues.</li>`
	}</ul><p class="small muted">${state.closed_issues} closed. Issues only close with recorded evidence.</p></div>`;
	el.querySelectorAll("[data-issue]").forEach((b) => b.addEventListener("click", () => openIssue(b.dataset.issue)));
	$("#new-issue").addEventListener("click", newIssue);
}
function newIssue() {
	const body = sheet("New issue", `<form id="issue-form">
		<label for="i-title">What needs to happen or be answered?</label><input id="i-title" name="title" required>
		<div class="grid2"><div><label for="i-spec">Specialty</label><input id="i-spec" name="specialty" placeholder="GP, Cardiology…"></div>
		<div><label for="i-owner">Who owns it?</label><input id="i-owner" name="owner"></div>
		<div><label for="i-due">Due</label><input id="i-due" name="due_date" type="date"></div></div>
		<label for="i-next">Next action</label><input id="i-next" name="next_action">
		<p><button type="submit">Save</button></p></form>`);
	$("#issue-form", body).addEventListener("submit", async (e) => {
		e.preventDefault();
		try { await post("/issues", Object.fromEntries(new FormData(e.target))); $("#sheet").close(); await load(); } catch (err) { sheetError(err.message); }
	});
}
async function openIssue(id) {
	const i = await api(`/issues/${id}`);
	const body = sheet(i.title, `
		<p>${vbadge(i.verification)} <span class="badge">${esc(nice(i.status))}</span></p>
		<p class="small">Owner: ${esc(i.owner || "not assigned")} · First reported ${esc(i.first_reported || "")}</p>
		<h3>History (never erased)</h3>
		<ul class="list history">${i.history.map((h) => `<li><strong>${esc(nice(h.status))}</strong> <span class="small muted">${esc(new Date(h.at).toLocaleString())} · ${esc(h.actor)}</span>${h.evidence ? `<div class="small">Evidence: ${esc(h.evidence)}</div>` : ""}</li>`).join("")}</ul>
		<h3>Update status</h3>
		<form id="status-form">
			<label for="st">New status</label>
			<select id="st" name="status">${STATUSES.map((s) => `<option value="${s}" ${s === i.status ? "selected" : ""}>${nice(s)}</option>`).join("")}</select>
			<label for="ev">Evidence (who confirmed, when, how)</label><textarea id="ev" name="evidence" placeholder="e.g. Clinic called 3 Nov: referral received"></textarea>
			<label for="nx">Next action</label><input id="nx" name="next_action" value="${esc(i.next_action || "")}">
			<p><button type="submit">Record update</button></p>
		</form>`);
	$("#status-form", body).addEventListener("submit", async (e) => {
		e.preventDefault();
		try { await post(`/issues/${id}/status`, Object.fromEntries(new FormData(e.target))); $("#sheet").close(); toast("Status recorded"); await load(); } catch (err) { sheetError(err.message); }
	});
}

// ---------- Record ----------
function renderRecord() {
	const s = state;
	const el = $('[data-panel="record"]');
	el.innerHTML = `
	<div class="card"><div class="row between"><h2>Medications</h2><button class="ghost" id="add-med">+ Add</button></div>
		<ul class="list">${s.medications.map(medLine).join("") || `<li class="muted">None recorded.</li>`}</ul>
		${s.conflicts.map((c) => `<div class="card attn"><p>${esc(c.description)}</p><button class="ghost" data-resolve="${esc(c.id)}">Record which one is current</button></div>`).join("")}
	</div>
	<div class="card"><div class="row between"><h2>Appointments</h2><button class="ghost" id="add-appt">+ Add</button></div>
		<ul class="list">${s.appointments.map((a) => `<li><strong>${esc(a.title)}</strong><div>${esc(a.when)}${a.provider ? ` · ${esc(a.provider)}` : ""}</div><div class="row small"><span class="badge">${esc(a.discovered_via)}</span>${a.details_verified ? "" : `<span class="badge v-AI_INFERENCE">not verified</span>`}<button class="ghost" data-brief="${esc(a.id)}">Brief</button></div></li>`).join("") || `<li class="muted">None recorded.</li>`}</ul>
	</div>
	<div class="card"><h2>Documents (originals kept exactly as uploaded)</h2>
		<form id="doc-form" class="row">
			<label for="doc-file" class="small">Add a PDF, photo or document</label>
			<input id="doc-file" type="file" accept=".pdf,image/*,.txt,.docx,.xml,.json" required>
			<input id="doc-note" placeholder="Short note (optional)" aria-label="Note">
			<button type="submit">Upload</button>
		</form>
		<ul class="list">${s.documents.map((d) => `<li><a class="btn ghost" href="/api/documents/${esc(d.id)}/raw">${esc(d.filename)}</a><div class="small muted">${esc(new Date(d.received_at).toLocaleString())} · ${(d.size / 1024).toFixed(0)} KB · SHA-256 ${esc(d.sha256.slice(0, 12))}… ${vbadge(d.verification)}</div>${d.note ? `<div class="small">${esc(d.note)}</div>` : ""}</li>`).join("") || `<li class="muted">No documents yet.</li>`}</ul>
	</div>`;
	bindBriefButtons(el);
	el.querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", () => resolveConflict(b.dataset.resolve)));
	$("#add-appt").addEventListener("click", addAppointment);
	$("#add-med").addEventListener("click", addMedication);
	$("#doc-form").addEventListener("submit", async (e) => {
		e.preventDefault();
		const f = $("#doc-file").files[0];
		if (!f) return;
		const q = new URLSearchParams({ filename: f.name, note: $("#doc-note").value });
		try {
			const r = await api(`/documents?${q}`, { method: "POST", headers: { "content-type": f.type || "application/octet-stream" }, body: f });
			toast(r.duplicate ? "Already stored: identical file (receipt recorded)" : "Stored and fingerprinted");
			await load();
		} catch (err) { toast(err.message); }
	});
}
function addAppointment() {
	const body = sheet("Add appointment", `<form id="appt-form">
		<label for="a-title">What is it?</label><input id="a-title" name="title" required placeholder="e.g. Vaccinations">
		<div class="grid2"><div><label for="a-when">Date and time</label><input id="a-when" name="starts_local" type="datetime-local" required></div>
		<div><label for="a-spec">Type</label><select id="a-spec" name="specialty"><option>GP</option><option>Pediatrician</option><option>Cardiology</option><option>Feeding</option><option>ENT</option><option>Developmental</option><option>Dietitian</option><option>Other</option></select></div>
		<div><label for="a-prov">With whom</label><input id="a-prov" name="provider"></div><div><label for="a-loc">Where</label><input id="a-loc" name="location"></div></div>
		<label><input type="checkbox" name="details_verified" value="1"> Time and place are confirmed</label>
		<p><button type="submit">Save and prepare brief</button></p></form>`);
	$("#appt-form", body).addEventListener("submit", async (e) => {
		e.preventDefault();
		const f = Object.fromEntries(new FormData(e.target));
		try { const r = await post("/appointments", { ...f, details_verified: f.details_verified === "1" }); $("#sheet").close(); toast("Saved. A brief is ready."); await load(); openBrief(r.id); } catch (err) { sheetError(err.message); }
	});
}
function addMedication() {
	const body = sheet("Record a medication", `<p class="small muted">Copy exactly what the label or document says. If it differs from an existing record, both are kept and flagged.</p>
		<form id="med-form"><label for="m-name">Name</label><input id="m-name" name="name" required>
		<div class="grid2"><div><label for="m-str">Strength / concentration</label><input id="m-str" name="strength" placeholder="e.g. 5 mg/mL"></div>
		<div><label for="m-dose">Dose as written</label><input id="m-dose" name="dose_text"></div>
		<div><label for="m-freq">How often</label><input id="m-freq" name="frequency"></div><div><label for="m-pres">Prescriber</label><input id="m-pres" name="prescriber"></div></div>
		<label for="m-src">Where is this from?</label><select id="m-src" name="verification"><option value="PARENT_REPORT">Our own notes</option><option value="CLINICAL_RECORD">Pharmacy label or clinical document</option><option value="EXTRACTED">Copied from a portal summary</option></select>
		<label for="m-note">Source note</label><input id="m-note" name="source_note" placeholder="e.g. Bottle label, Shoppers, 1 Nov">
		<p><button type="submit">Save</button></p></form>`);
	$("#med-form", body).addEventListener("submit", async (e) => {
		e.preventDefault();
		try { const r = await post("/medications", Object.fromEntries(new FormData(e.target))); $("#sheet").close(); toast(r.conflict_id ? "Saved: records disagree, flagged for checking" : "Saved"); await load(); } catch (err) { sheetError(err.message); }
	});
}
function resolveConflict(id) {
	const c = state.conflicts.find((x) => x.id === id);
	const meds = state.medications.filter((m) => c.item_ids.includes(m.id));
	const body = sheet("Which record is current?", `<p>${esc(c.description)}</p>
		<form id="res-form"><fieldset><legend>Current record</legend>${meds.map((m) => `<label><input type="radio" name="chosen_id" value="${esc(m.id)}" required> ${esc(m.strength || "")} ${esc(m.dose_text || "")} (${esc(m.source_note || m.verification)})</label>`).join("")}</fieldset>
		<label for="r-ev">How was this confirmed?</label><textarea id="r-ev" name="evidence" required placeholder="e.g. Checked bottle label and called the cardiology clinic, 3 Nov"></textarea>
		<p><button type="submit">Record</button></p></form>`);
	$("#res-form", body).addEventListener("submit", async (e) => {
		e.preventDefault();
		try { await post(`/conflicts/${id}/resolve`, Object.fromEntries(new FormData(e.target))); $("#sheet").close(); toast("Recorded. The other record is kept as historical."); await load(); } catch (err) { sheetError(err.message); }
	});
}

// ---------- Sources ----------
function renderSources() {
	const el = $('[data-panel="sources"]');
	const r = state.last_automation_run;
	el.innerHTML = `
	<div class="card"><h2>Where information comes from</h2>
		<ul class="list">${state.sources.map((x) => `<li><div class="row between"><strong>${esc(x.name)}</strong><span class="badge s-${esc(x.status.replace(" ", "-"))}">${esc(x.status)}</span></div><div class="small">${esc(x.detail)}${x.last_success_at ? ` · last success ${esc(new Date(x.last_success_at).toLocaleString())}` : ""}</div></li>`).join("")}</ul>
	</div>
	<div class="card"><h2>Automatic checks</h2>
		<p>${r ? `Last run ${esc(new Date(r.started_at).toLocaleString())}: ${r.ok ? "completed" : "FAILED"}.` : "No automatic run has completed yet."}</p>
		<p class="small muted">Runs every 30 minutes once deployed: prepares briefs 7 days, 48 hours and 12 hours before each appointment and checks for overdue items.</p>
	</div>
	<div class="card"><h2>Signed in</h2><p class="small" id="who"></p><button class="ghost" id="signout">Sign out</button></div>
	<div class="card"><h2>Your data</h2><p><a class="btn ghost" href="/api/export" download="familyos-export.json">Download a full export (JSON)</a></p></div>`;
	api("/whoami").then((w) => ($("#who").textContent = w.email)).catch(() => {});
	$("#signout").addEventListener("click", async () => {
		await fetch("/auth/signout", { method: "POST" });
		try { google.accounts.id.disableAutoSelect(); } catch {}
		location.reload();
	});
}

// ---------- Household (parent) view: familyos.libbyhd.org ----------
async function loadHousehold() {
	document.querySelector(".tabs").hidden = true;
	document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = true));
	$("#child-name").textContent = "FamilyOS";
	document.title = "FamilyOS";
	const el = $("#household");
	el.hidden = false;
	let h;
	try {
		h = await api("/household");
	} catch (e) {
		$("#fresh").textContent = `Could not load: ${e.message}. Nothing shown is current.`;
		return;
	}
	$("#ages").textContent = "Both boys at a glance. Tap a name to open his record.";
	$("#fresh").textContent = `Updated ${new Date(h.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
	const proto = location.protocol;
	el.innerHTML = `<div class="hh">${h.members
		.map((m) => {
			const c = m.card;
			const href = `${proto}//${m.host}/`;
			if (!m.ok) return `<div class="card attn"><h2>${esc(m.person[0].toUpperCase() + m.person.slice(1))}</h2><p>Could not load this record right now. This is <strong>not</strong> the same as "nothing to do".</p><a class="btn ghost" href="${esc(href)}">Open</a></div>`;
			if (!c.profile) return `<div class="card"><h2>${esc(m.person[0].toUpperCase() + m.person.slice(1))}</h2><p class="muted">Not set up yet.</p><a class="btn" href="${esc(href)}">Set up</a></div>`;
			const attn = [
				...(c.urgent_last_24h ? [`<li><span class="badge v-CONFLICT">Urgent phrase logged</span> in the last 24 hours</li>`] : []),
				...c.conflicts.map((x) => `<li><span class="badge v-CONFLICT">Conflict</span> ${esc(x)}</li>`),
				...c.overdue.map((o) => `<li><span class="badge overdue">Overdue</span> ${esc(o.title)}${o.next_action ? ` → ${esc(o.next_action)}` : ""}</li>`),
				...c.patterns.map((p) => `<li>${vbadge("AI_INFERENCE")} ${esc(p)}</li>`),
			];
			return `<div class="card member" data-side="${esc(c.profile.side || "")}">
				<div class="row between"><h2><a href="${esc(href)}">${esc(c.profile.display_name)}</a></h2>${c.profile.label ? `<span class="badge side" data-side="${esc(c.profile.side || "")}">${esc(c.profile.label)}</span>` : ""}</div>
				${c.ages ? `<p class="small muted">Age ${esc(c.ages.chronological)}${c.ages.corrected ? ` · corrected ${esc(c.ages.corrected)}` : ""}</p>` : ""}
				<p><strong>Next:</strong> ${c.next_appointment ? `${esc(c.next_appointment.title)}, ${esc(c.next_appointment.when)}${c.next_appointment.details_verified ? "" : " (not verified)"}` : `none recorded <span class="small muted">(check Sources)</span>`}</p>
				<p class="small">${c.open_issues} open issue(s) · ${c.meds_needing_check} medication(s) need checking${c.last_log ? ` · last log ${esc(c.last_log.when)}` : ""}</p>
				${attn.length ? `<ul class="list">${attn.join("")}</ul>` : `<p class="small muted">Nothing flagged.</p>`}
				${c.sources_not_connected.length ? `<p class="small"><span class="badge s-NOT-CONNECTED">${c.sources_not_connected.length} source(s) not connected</span></p>` : ""}
				<a class="btn" href="${esc(href)}">Open ${esc(c.profile.display_name)}'s record</a>
			</div>`;
		})
		.join("")}</div>`;
}


load();
