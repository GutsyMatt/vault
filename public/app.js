/**
 * LibbyHD frontend
 *
 * Shows the provider search when signed out and the health record dashboard
 * when signed in.
 */

// Items shown per section before "Show all"
const PREVIEW_COUNT = 5;

const ICONS = {
	medications:
		'<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
	allergies:
		'<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
	conditions:
		'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
	labs: '<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7 15h10"/>',
	immunizations:
		'<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3a2.4 2.4 0 0 1-3.4 0l-.6-.6a2.4 2.4 0 0 1 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/>',
	visits:
		'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
};

// Dashboard sections, in display order
const SECTIONS = [
	{
		key: "medications",
		title: "Medications",
		empty: "No active medications on file.",
		render: (m) => ({
			title: m.name,
			sub: [m.dosage, m.prescribed && `Prescribed ${formatDate(m.prescribed)}`]
				.filter(Boolean)
				.join(" · "),
		}),
	},
	{
		key: "allergies",
		title: "Allergies",
		empty: "No known allergies on file.",
		render: (a) => ({
			title: a.name,
			pill:
				a.severity === "severe" || a.severity === "high"
					? ["severe", "Severe"]
					: null,
			sub: a.reaction && `Reaction: ${a.reaction}`,
		}),
	},
	{
		key: "conditions",
		title: "Health issues",
		empty: "No active health issues on file.",
		render: (c) => ({
			title: c.name,
			side: c.since && `Since ${formatDate(c.since)}`,
		}),
	},
	{
		key: "immunizations",
		title: "Immunizations",
		empty: "No immunizations on file.",
		render: (i) => ({ title: i.name, side: i.date && formatDate(i.date) }),
	},
	{
		key: "labs",
		title: "Recent lab results",
		empty: "No lab results on file.",
		wide: true,
		render: (l) => ({
			title: l.name,
			sub: [l.range && `Normal: ${l.range}`, l.date && formatDate(l.date)]
				.filter(Boolean)
				.join(" · "),
			value: l.value,
			pill: l.flag ? [l.flag, l.flag[0].toUpperCase() + l.flag.slice(1)] : null,
		}),
	},
	{
		key: "visits",
		title: "Recent visits",
		empty: "No visits on file.",
		wide: true,
		render: (v) => ({
			title: v.type,
			sub: [v.provider, v.location].filter(Boolean).join(" · "),
			side: v.date && formatDate(v.date),
		}),
	},
];

init();

async function init() {
	let response;
	try {
		response = await fetch("/api/record");
	} catch (err) {
		console.error("Error loading record:", err);
	}

	if (response?.status === 401 || !response) {
		showSignedOut();
		return;
	}

	showSignedIn();
	renderSkeletons();
	if (!response.ok) {
		document.getElementById("record-error").hidden = false;
		document.getElementById("sections").replaceChildren();
		return;
	}
	renderRecord(await response.json());
}

// --- Signed out: provider search -------------------------------------------

async function showSignedOut() {
	document.getElementById("signed-out").hidden = false;

	const input = document.getElementById("provider-input");
	const results = document.getElementById("provider-results");
	const iss = document.getElementById("provider-iss");
	const button = document.getElementById("signin-button");

	let providers = [];
	try {
		const response = await fetch("/api/providers");
		if (response.ok) providers = await response.json();
	} catch (err) {
		console.error("Error loading providers:", err);
	}

	let matches = [];
	let active = -1;

	const choose = (provider) => {
		input.value = provider.name;
		iss.value = provider.url;
		button.disabled = false;
		close();
	};

	const close = () => {
		results.hidden = true;
		input.setAttribute("aria-expanded", "false");
		active = -1;
	};

	const render = () => {
		const query = input.value.trim().toLowerCase();
		matches = providers
			.filter((p) => p.name.toLowerCase().includes(query))
			.slice(0, 8);
		results.replaceChildren(
			...(matches.length
				? matches.map((provider, i) => {
						const li = document.createElement("li");
						li.id = `provider-option-${i}`;
						li.role = "option";
						li.textContent = provider.name;
						li.setAttribute("aria-selected", String(i === active));
						// mousedown fires before the input loses focus
						li.addEventListener("mousedown", (e) => {
							e.preventDefault();
							choose(provider);
						});
						return li;
					})
				: [
						Object.assign(document.createElement("li"), {
							className: "empty",
							textContent: "No matching providers",
						}),
					]),
		);
		results.hidden = false;
		input.setAttribute("aria-expanded", "true");
		input.setAttribute(
			"aria-activedescendant",
			active >= 0 ? `provider-option-${active}` : "",
		);
	};

	input.addEventListener("focus", render);
	input.addEventListener("blur", close);
	input.addEventListener("input", () => {
		iss.value = "";
		button.disabled = true;
		active = -1;
		render();
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (!matches.length) return;
			const step = e.key === "ArrowDown" ? 1 : -1;
			active = (active + step + matches.length) % matches.length;
			render();
		} else if (e.key === "Enter" && !results.hidden && active >= 0) {
			e.preventDefault();
			choose(matches[active]);
		} else if (e.key === "Escape") {
			close();
		}
	});

	// With a single provider (e.g. the sandbox), preselect it
	if (providers.length === 1) choose(providers[0]);
}

// --- Signed in: dashboard ----------------------------------------------------

function showSignedIn() {
	document.getElementById("signed-in").hidden = false;
	document.getElementById("signout").hidden = false;
}

function renderSkeletons() {
	document.getElementById("sections").replaceChildren(
		...SECTIONS.map((section) => {
			const card = createCard(section);
			for (let i = 0; i < 3; i++) {
				const bar = document.createElement("div");
				bar.className = "skeleton";
				bar.style.width = `${90 - i * 20}%`;
				card.appendChild(bar);
			}
			return card;
		}),
	);
}

function renderRecord(record) {
	const firstName = record.patient.name.split(" ")[0];
	document.getElementById("greeting-name").textContent = `Hi, ${firstName}`;
	document.getElementById("greeting-sub").textContent = [
		record.patient.name,
		record.patient.birthDate && `Born ${formatDate(record.patient.birthDate)}`,
	]
		.filter(Boolean)
		.join(" · ");

	document
		.getElementById("sections")
		.replaceChildren(
			...SECTIONS.map((section) => renderSection(section, record[section.key])),
		);
}

function renderSection(section, data) {
	const card = createCard(section);

	if (!data || data.status === "error") {
		card.appendChild(note("Couldn't load this right now."));
		return card;
	}
	if (data.status === "unavailable") {
		const unavailable = note(
			"Not shared with LibbyHD. You can change what you share in MyChart.",
		);
		unavailable.classList.add("unavailable");
		card.appendChild(unavailable);
		return card;
	}
	if (!data.items.length) {
		card.appendChild(note(section.empty));
		return card;
	}

	card.querySelector(".count").textContent = String(data.items.length);
	const list = document.createElement("ul");
	list.className = "items";
	data.items.forEach((item, i) => {
		const li = renderItem(section.render(item));
		if (i >= PREVIEW_COUNT) li.hidden = true;
		list.appendChild(li);
	});
	card.appendChild(list);

	if (data.items.length > PREVIEW_COUNT) {
		const more = document.createElement("button");
		more.className = "more";
		more.textContent = `Show all ${data.items.length}`;
		more.addEventListener("click", () => {
			list.querySelectorAll("li[hidden]").forEach((li) => (li.hidden = false));
			more.remove();
		});
		card.appendChild(more);
	}
	return card;
}

function createCard(section) {
	const card = document.createElement("section");
	card.className = section.wide ? "card wide" : "card";
	card.innerHTML = `
		<div class="card-head">
			<span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[section.key]}</svg></span>
			<h2></h2>
			<span class="count"></span>
		</div>`;
	card.querySelector("h2").textContent = section.title;
	return card;
}

function renderItem({ title, sub, side, value, pill }) {
	const li = document.createElement("li");
	const main = document.createElement("div");
	main.className = "item-main";

	const titleEl = document.createElement("div");
	titleEl.className = "item-title";
	titleEl.textContent = title;
	main.appendChild(titleEl);

	if (sub) {
		const subEl = document.createElement("div");
		subEl.className = "item-sub";
		subEl.textContent = sub;
		main.appendChild(subEl);
	}
	li.appendChild(main);

	if (side || value || pill) {
		const sideEl = document.createElement("div");
		sideEl.className = "item-side";
		if (value) {
			const valueEl = document.createElement("span");
			valueEl.className = "item-value";
			valueEl.textContent = value;
			sideEl.appendChild(valueEl);
		} else if (side) {
			sideEl.textContent = side;
		}
		if (pill) {
			const pillEl = document.createElement("span");
			pillEl.className = `pill ${pill[0]}`;
			pillEl.textContent = pill[1];
			sideEl.appendChild(pillEl);
		}
		li.appendChild(sideEl);
	}
	return li;
}

function note(text) {
	const p = document.createElement("p");
	p.className = "note";
	p.textContent = text;
	return p;
}

function formatDate(value) {
	// Date-only values (YYYY-MM-DD) are local dates, not UTC midnight
	const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
