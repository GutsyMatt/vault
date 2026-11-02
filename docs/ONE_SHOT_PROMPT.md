# NATICO Platform: one-shot build prompt for Claude
## First slice to make work: FamilyOS → CallumOS + FinnleyOS

> **How to use this file.** Paste everything below the line into a new Claude Code session that has the `gutsymatt/vault` repo attached (or say: *"Read `docs/ONE_SHOT_PROMPT.md` and execute it."*). It is meant to be self-contained. The original directive in Google Drive (`FAMILYOS — Claude One-Shot Build Directive`, doc id `1aqD9XwV4YEeLoebGJxuq2LVX9wf1r0TiQmHDGTgYJbc`) is still authoritative for anything this file leaves unclear. Where the two conflict, this file wins, because it reflects the infrastructure that actually exists.
>
> **Structure.** **Part I** is the whole platform: the long-term destination every design decision must fit. **Part II** is the first slice you build and prove: CallumOS and FinnleyOS. Read both. Build Part II, shaped so it becomes part of Part I without being rewritten.

---

# PART I: THE PLATFORM (the destination)

## I.1 What this really is

This is not a family medical dashboard. It is the **NATICO Platform**: a personal intelligence, accessibility, advocacy and household operating platform. It serves the Herbert family first and may later serve other individuals and families. The names changed over 2025–2026, but they are **capabilities within one governed architecture, not competing products:**

| Capability | What it is responsible for |
|---|---|
| **NATICO** | The umbrella: governance, accessibility-first principles, advocacy, service navigation, institutional accountability, and an eventual public offering |
| **Libby / Libby Live** | The interaction and intelligence layer: conversational assistant, live advocate, guided support, model routing, memory, retrieval with citations, specialist-agent orchestration |
| **LibbyHD** | The private intelligence engine and operating environment: memory, document retrieval, agents, personal workspace (`libbyhd.org`) |
| **SENTINEL** | Evidence and accountability: acquisition, preservation (hash, chain of custody), transcription, entity extraction, timelines, claim↔evidence mapping, discrepancy and missing-evidence analysis, case binders |
| **LifeOS** | One per person: health, functioning and disability, accommodations, biography, finances, benefits, education, relationships, commitments, unresolved matters |
| **FamilyOS / Family HD** | The household layer over several LifeOS identities: parenting, caregiving shifts and handoffs, shared calendar, supplies and inventory, budget, home/Home Assistant/cameras, parent briefings |

**Layers, top to bottom:**
1. **Experiences:** `libbyhd.org`, `callum.libbyhd.org`, `finnley.libbyhd.org`, family dashboard, Libby Live, admin/Boardroom, and later a NATICO public site.
2. **Capabilities:** Libby · SENTINEL · LifeOS · FamilyOS · NATICO advocacy.
3. **Shared foundation:** Identity · Permissions/Consent · Knowledge graph · Memory · Event bus · Agents · Connectors · Audit · UX design system.
4. **Private evidence and data:** governed storage (R2/Drive/local), operational database, and integrations (Google Workspace, Obsidian, local storage, Home Assistant, external services).

## I.2 Permanent architectural principles (apply to everything, forever)

1. **One canonical identity per person.** A person exists once. Medical, financial, educational, accessibility, caregiving and advocacy views are *projections* of the same person, not copies. Households group people; people are never subfolders of a household.
2. **One authoritative original per source.** One document can support many cases and issues by reference, never by duplication.
3. **One traceable operational state per outstanding matter**, with an owner, history, next action and closure evidence.
4. **Originals are preserved, including wrong or conflicting ones.** Corrections add attribution and context; they never erase.
5. **Portability.** The family can export everything in open formats (JSON/CSV/PDF and originals, FHIR where it fits). No lock-in to a model, coding assistant, host or UI.
6. **Private data and public product are structurally separated.** NATICO may reuse *software and methods*. It never implicitly gets family data. Private cases are not examples, demos or training data. Tenancy, consent and governance boundaries are enforced in code.
7. **Observable automation.** Every job, agent and connector reports its last run, its result and its failures to an operational health view. Silent failure is never shown as successful monitoring.
8. **Accessibility is the default behaviour.** Design for cognitive fatigue, poor working memory, auditory-processing difficulty and competing caregiving demands. The system reduces remembering, searching, explaining and checking.
9. **Read-only audit before migration.** No bulk deletion, moving or uncontrolled sync of existing assets (the earlier D-drive preservation rule). Governance freeze v4.2.1 and action gates A/B/C are the policy baseline. Changes to them need explicit, recorded approval.
10. **Software in GitHub; private data never.** Repos hold code, schemas, contracts, tests and non-sensitive definitions. Evidence, records, the private knowledge graph, exports and credentials live in governed storage. No tokens, production exports or `~/.config` backups in repos or broadly synced archives. Treat earlier secret-exposure findings as **open security items until verified remediated.**

## I.3 Canonical object model (shared foundation)

Every object has a stable ID, provenance and an audit trail. Core types:

`Person`, `Household`, `HouseholdMembership`, `Relationship`, `Organization`, `Provider`, `Source`, `Evidence` (an original artifact), `Claim` (an assertion with verification class), `Event`, `Observation`, `Encounter`, `Case`, `Issue`, `Task`, `Decision`, `Consent`, `Authorization`, `AgentRun`, `AuditEvent`, `PresentationPreference`.

Verification classes apply platform-wide: `CLINICAL_RECORD`/`OFFICIAL_RECORD`, `EXTRACTED`, `SELF_OR_PARENT_REPORT`, `AI_INFERENCE`, `CONFLICT`, `HISTORICAL`. A model's recollection or inference must never overwrite sourced evidence.

**Presentation rules are data, not schema.** "Baby A / Callum / LEFT, Baby B / Finnley / RIGHT" is a `PresentationPreference` for this household. The UI must honour it everywhere, but the database must not hard-code twins, left/right or "patient". The same engine must later serve Matthew's and Kellsie's LifeOS (e.g. TBI communication accommodations, Crohn's and surgical history, OT/SLP evidence, ODSP/DSO/DTC cases, dental care) and other households.

The test of the model: it must be able to answer cross-domain questions like *"Which uncompleted support requests relate to Matthew's mobility limitations, what professional evidence supports them, who owns each, and what happened in the last three attempts?"* You don't build that answer now. You **must not make it impossible.**

## I.4 Private data hierarchy (governed storage, not GitHub)

Preserve the historical `04_USERS` principle (individuals are first-class users). Illustrative layout, mirrored by R2 prefixes and database scoping. **Do not move existing private folders to match it.** Reconcile existing user IDs against the historical registry before assigning any.

```
LIBBYHD_PRIVATE/
  00_SYSTEM/ (source-registry, policy-register, reconciliation-ledger)
  01_INBOX/  02_EVIDENCE/  03_KNOWLEDGE_GRAPH/
  04_USERS/<user-id>/ (biography, health, functioning, benefits-and-advocacy, communications, cases)
  05_HOUSEHOLDS/ (shared-care, scheduling, inventory, finances)
  06_CASES/  07_OPERATIONS/  08_HANDOFFS/  09_EXPORTS/  99_ARCHIVE_AND_RECOVERY/
```

## I.5 Repository strategy (do NOT create 12 empty repos)

The long-term logical domains are: 01 platform-governance · 02 libby-intelligence · 03 sentinel-evidence · 04 lifeos · 05 familyos · 06 natico-advocacy · 07 experience-and-apps · 08 integrations-and-ingestion · 09 automation-and-agents · 10 infrastructure-and-devices · 11 knowledge-and-research · 12 quality-security-and-operations.

These are **logical groupings, implemented as modules or packages first.** Split them into repositories only at real deployment, permission, ownership or release boundaries. **Decided by the parents (2026-11-02): LibbyHD is the parent; FamilyOS sits under it.** GitHub: organization **`LibbyHD`**, with this product as the repo **`LibbyHD/familyOS`**. Web: **`familyos.libbyhd.org`** is the parent (household) site, with **`callum.libbyhd.org`** and **`finnley.libbyhd.org`** as the children's sites. Other repos below become siblings under `LibbyHD` only when there is real code for them. Starting set:

| Repo | Holds |
|---|---|
| `platform-governance` | Constitution and principles, system map, ADRs and decision register, canonical-source authority, identity and permission model, **Master Architecture Registry**, migration inventory |
| `libby-platform` | Shared schemas, Libby intelligence, SENTINEL libraries, connectors, agents (as packages) |
| `familyOS` (= `LibbyHD/familyOS`; the old working name was `familyos-app`) | Family dashboard, LifeOS views, the per-person portals (CallumOS/FinnleyOS), caregiver UX, action queues |
| `platform-infrastructure` | Deployment and IaC, Cloudflare, local core (Toshiba/Tailscale/Home Assistant/Ollama), monitoring, backup, security |
| `natico-public` | Public site and reusable public-safe advocacy resources, independently governed |

**Superseded proposal, for reconciliation:** an earlier plan proposed a `familyos` org with six repos. It was replaced because it put advocacy and the shared foundation *under* FamilyOS, when they belong to the whole platform. Map, don't duplicate:

| Earlier `familyos/` repo | Goes to |
|---|---|
| `familyos-core` (identity-and-permissions, event-processing, provenance, audit) | Shared foundation: `platform-governance` (identity and permission model) plus `libby-platform` (event, provenance and audit packages) |
| `familyos-medical` (clinical-data-schemas, appointment-intelligence, medication-reconciliation, referral-tracking) | LifeOS health domain in `libby-platform`. It is per person and reused for Matthew and Kellsie, not FamilyOS-only. |
| `familyos-advocacy` (disability-support-workflows, benefits-case-management, evidence-reconciliation) | SENTINEL (evidence reconciliation) plus LifeOS and NATICO advocacy. Not built in the first slice. |
| `familyos-connectors` (google-drive, google-calendar, gmail, github) | Connectors package in `libby-platform` |
| `familyos-web` (parent-dashboard, callum-portal, finnley-portal) | `familyos-app`, seeded from this repo. **This is Part II.** |
| `familyos-infrastructure` (deployment, monitoring, backup, security) | `platform-infrastructure` |

If any of these repos already exist on GitHub, add them to the registry (§I.6) as assets to audit. Don't treat them as a competing plan.

**In-repo module layout (the deep structure, as real modules, never empty folders).** Inside `LibbyHD/familyOS`, code is organised the way the earlier `familyos-*` proposal grouped it. Add a folder only when it gets working, tested code:

```
apps/familyos/src/
  core/        identity & auth, ids, time, provenance helpers   (was: familyos-core)
  medical/     clinical rules: ages, logging, red flags, issue lifecycle (was: familyos-medical)
  storage/     per-person vault (Durable Object), append-only tables
  connectors/  Google Calendar / Gmail / Drive                 (when built: was familyos-connectors)
  advocacy/    disability, benefits and evidence workflows      (later: was familyos-advocacy)
apps/familyos/public/   household view, Callum and Finnley portals (was: familyos-web)
apps/familyos/wrangler.jsonc + docs/   deployment, monitoring and backup (was: familyos-infrastructure)
```

**Right now:** you only have `gutsymatt/vault`. Phase 0 classified it: it is a Cloudflare Workers template already wired to Workers Builds. It becomes the **seed of `familyos-app`**, with a `packages/`-style layout so the shared schema and core can later move to `libby-platform` without a rewrite. Creating the org or new repos, or moving or renaming existing repos, is a **migration action that needs explicit approval** (see blockers). Never do it unilaterally. One cross-repo GitHub Project ("Boardroom") should eventually show objectives, defects, migrations and completion evidence in one place.

## I.6 The Master Architecture Registry (a Phase 0 deliverable)

A version-controlled, machine-readable registry (`registry/*.yaml`, with a JSON schema and a validation test), plus a generated status page. Entry types: repository, local workspace, Drive root, hostname/domain, deployed service, database, agent, scheduled job, integration, archive/bundle. Fields: `id`, `name`, `type`, `location`, `capability` (NATICO/Libby/SENTINEL/LifeOS/FamilyOS/foundation), `canonical_destination`, `authority`, `verified_state` (`operational` / `partial` / `experimental` / `obsolete` / `broken` / `unknown` / `security-sensitive`), `evidence` (how and when verified), `dependencies`, `duplicates_of`, `conflicts`, `migration_priority`, `owner`, `notes`.

Seed it with every asset the family has mentioned, **all `unknown` until checked**: `natico-org`, `libby-live`/`libby_live`, `libby_demo`, `libby-live-references`, `sentinel-framework`, `natico-case-vault`, `LibbytheLibrarian/LibbyHD`, `ios_extraction`, `voice-memo-transcription`, local FAMILYOS work, `FamilyOS-FinnleyOS.git.bundle` (preserve as a recovery artifact; inspect before merging anything), Obsidian graph and exporters, `00_FAMILYOS_LIVE`, LibbyOS Boardroom, governance freeze v4.2.1, `libbyhd.org`, `libby.natico.ca`, the Toshiba local core, the ChatGPT appointment watch, the Ops Control Board, and `gutsymatt/vault`. Recover and reconcile the earlier **482-file migration map**, unresolved-item reports and prior repo audits if they can be found (Drive search). Do not regenerate them from memory.

## I.7 How the capabilities work together (the target loop)

Information arrives (calendar, email, upload, message, observation) → **Libby** resolves the people and organizations involved and classifies the item → **SENTINEL** preserves the original, checks provenance and flags discrepancies → **LifeOS/FamilyOS** update the right person's or household's state → **automation** proposes the action behind the right approval gate → the parents get **one coherent briefing** (what changed, why it matters, what's due, what's blocked, who must act) → the **verification loop** records whether the action happened and what the outside organization did.

Part II builds the smallest real version of this loop for two people.

## I.8 Scope discipline (the rule that prevents a repeat of 2026)

The repeated failure has been **expanding the architecture before closing the loop.** So:

- **Build vertical slices, not horizontal layers.** A capability counts only when it is `VERIFIED OPERATIONAL` on real family data, end to end.
- **No new domain starts until the current slice passes its acceptance tests.** The order is: CallumOS/FinnleyOS (Part II), then the family dashboard and caregiving, then Matthew's LifeOS plus SENTINEL case support, then Kellsie's LifeOS, then Libby Live conversational access across all of it, then NATICO public and reusable advocacy.
- Foundation code (identity, consent, evidence store, event log, audit, connectors, job monitor) is written as **reusable platform modules from day one**, because Part II needs all of it anyway.
- Anything outside the current slice goes into the registry or the backlog. It does not become code.

---

# PART II: FIRST SLICE: CallumOS + FinnleyOS

## 0. Who you are and what "done" means

You are the principal engineer and the person responsible for getting **LibbyHD FamilyOS** running. You also own health-informatics design, privacy and security, accessibility, and QA.

You are building **a private, family-owned equivalent of MyChart for two premature twin boys. It shows two perspectives side by side and goes further than MyChart does.**

- **https://callum.libbyhd.org**: CallumOS (Baby A, LEFT)
- **https://finnley.libbyhd.org**: FinnleyOS (Baby B, RIGHT)

Hostnames are case-insensitive. Always redirect to lowercase HTTPS.

**"Always access" means:** both sites are reachable 24/7 from any network (cellular, hospital Wi-Fi, a relative's house). They never depend on the home internet connection or on a home computer being switched on. **Only authorized family members can open them.** Being always reachable never means public. Anyone who is not signed in gets a sign-in screen and nothing else: no names, no dates, no health information.

**Definition of success, in the parents' words:**
> I can open either child's site at any time, understand their current care situation, retrieve the original evidence behind every claim, see what has changed, know what needs attention, and prepare for any clinical appointment without reconstructing their history from memory.

**The acceptance question.** The finished system must answer it accurately, with dated sources, without anyone re-explaining history:
> "What has changed for Finnley since his last pediatrician visit, what is still unresolved, and what should we ask the GP tomorrow?"

It must answer the same question for Callum.

**The failure you are here to correct.** Months of records, plans, Google Docs, "agent" instructions and architecture write-ups have been produced. Several previous assistants claimed things were "integrated", "trained" or "live" when they weren't. The concrete example: the **November 2, 2026 twin vaccination appointment was never detected or prepared for automatically.** It was not on the connected primary calendar, so no briefing ran. **More documents are not the deliverable. Working, tested, persisted behaviour is the deliverable.**

---

## 1. Who uses this (design for them, not for a generic user)

- **Parents:** Matt and Kellsie. Matt has significant **working-memory, auditory-processing and executive-function challenges.** Both parents are caring for two medically complex premature infants on very little sleep.
- Design rules that follow from this:
  - **Minimal input.** Logging must work from a single sentence ("Finnley's bottle took 45 min again, lots of nasal regurg"), one tap, or dictation. No mandatory forms.
  - **Written and visual first; audio as an option.** Every briefing can be read aloud (Web Speech API) and printed.
  - **The system initiates, not the parent.** Parents must never have to remember to start a routine action, re-explain a history, or audit an assistant's claims.
  - **Low cognitive load.** One primary action per screen, big targets, plain language, no jargon without an inline explanation.
  - **Never another admin job.** If a feature needs regular manual upkeep to stay correct, redesign it.
- Possible future roles (design for them now, enable them only with parental approval): grandparents or other caregivers (limited, family-life-only view), and a clinician share link (read-only, expiring, signed, one patient).

---

## 2. Verified ground truth (checked 2026-11-02, re-verify before relying on it)

| Fact | Evidence | Implication |
|---|---|---|
| Repo `gutsymatt/vault` is an unmodified **Cloudflare Workers AI chat template** (`src/index.ts`, `public/`, `wrangler.jsonc` with `AI` + `ASSETS` bindings, Wrangler 4.56, Vitest pool-workers) | Single commit `source repo import` | This is the codebase. Replace the template; keep the Workers toolchain. |
| `libbyhd.org` resolves to Cloudflare anycast IPs (172.67.x / 104.21.x) and returns HTTP 200 | `getent hosts`, `curl` | The zone is on Cloudflare. Subdomains can be added as Worker custom domains in the same account. |
| The repo is **already connected to Cloudflare Workers Builds** (Worker `vault`, account subdomain `mattherbert01.workers.dev`). Every push deploys automatically, and the bot posts public **commit and branch preview URLs** on `*.mattherbert01.workers.dev` | Check run "Workers Builds: vault" plus a Cloudflare bot comment on PR #2 | CI/CD to Cloudflare already exists, so reuse it rather than building a parallel pipeline. **Critical:** `workers.dev` and preview URLs are public by default. Before any PHI or real data exists, disable `workers_dev` and preview URLs in `wrangler.jsonc` (or put them behind Cloudflare Access), so the custom domains are the only way in. Add a test that the `workers.dev` hosts return no app data. |
| `familyos.libbyhd.org`, `callum.libbyhd.org` and `finnley.libbyhd.org` **do not resolve**. `libbyhd.org`/`www` serve a **public** landing page with no Access in front. `app.libbyhd.org` returns Cloudflare "DNS points to prohibited IP". No Cloudflare Access login was observed on any reachable `libbyhd.org` host | `getent hosts`, `curl` (2026-11-02) | Parents believe sign-in is already live. It may exist in Zero Trust without covering these hosts: get the team domain and the Access application AUD (or add the three hosts to an existing app) before deploying. Do not assume. |
| FamilyOS Operations Control Board exists in Google Sheets (`1KKdxaGrTuQSWe41QEi256AJF4OPvE1dEivXTR_FwhG4`) with APPOINTMENTS, WAITING_ON, TASKS (and reportedly INTAKE_QUEUE + provenance tabs) | Previous assistant report, **not yet re-verified** | Read it (read-only) in Phase 0. It is the existing action layer. Import from it; don't build a competing tracker. |
| Nov 2 GP agenda doc exists (`1pbZtBhP58HXDqPtPqWGo-TMQIR_RAkUWxq_i5WvkOTo`) | Previous assistant report, **not re-verified** | Import as an evidence document. |
| Drive holds newborn reports, inpatient after-visit summaries, Callum and Finnley health summaries, cardiology consult material, discharge binders, Oct 30 HHS MyChart summaries, a records-request package | Previous assistant report, **not re-verified** | Phase 2 import source. Inventory it; don't assume completeness. |
| A "daily pediatric appointment watch" exists **in ChatGPT** | Previous assistant report | Not part of this system and not reliable. Replace it with a real Cron Trigger. |
| A Toshiba "local core" is planned | Previous plans | **Optional** redundancy and local ingestion only. Availability must never depend on it. |
| Governance freeze v4.2.1 and action gates A/B/C exist | Directive | Preserve them. Flag any change for approval. Ask the parents for the text if you can't find it. Don't invent it. |

Anything marked "not re-verified" is a lead, not a fact. Re-verify it, or label it `UNVERIFIED` in your outputs.

---

## 3. Non-negotiable rules (apply to code, data and your own reporting)

1. **No claim without evidence.** Never say something exists, works, syncs, is deployed, encrypted, backed up or scheduled unless you tested it and recorded the evidence (command output, test log, URL plus response, commit SHA). Never invent test passes, files, appointments, credentials, clinical facts, diagnoses or dosing.
2. **Originals are immutable.** Store every source file byte-for-byte, with SHA-256, origin, received-at timestamp and uploader. Never overwrite a clinical entry. Corrections are new versions or events that point at what they supersede.
3. **Every fact carries a verification class.** Use these and never blur them:
   - `CLINICAL_RECORD`: appears in an original clinical document (hospital, clinic or pharmacy)
   - `EXTRACTED`: machine-extracted from an original and not yet human-checked
   - `PARENT_REPORT`: a parent's observation or account
   - `AI_INFERENCE`: generated by the system; never shown as a finding
   - `CONFLICT`: two or more sources disagree and the conflict is unresolved
   - `HISTORICAL`: was true and has since been superseded
4. **No autonomous clinical action.** The system never changes a dose, never calculates a dose from a historical concentration, never interprets a result as medical advice, never orders tests, never sends clinical correspondence, never grants access, and never closes a medically meaningful issue without an explicit, logged human approval. It drafts. Humans decide.
5. **Urgent safety.** When a logged symptom matches a red flag (e.g. colour change, breathing pauses, choking with distress, fast heart rate in Finnley given his SVT history, lethargy, poor feeding plus fewer wet diapers), show **"Call 911 / go to the nearest emergency department"** or **"Call Health Connect Ontario 811 / your doctor"** guidance. Never reassure. Never diagnose. The red-flag list is configuration that clinicians or parents can review, not hard-coded medical opinion.
6. **Document content is data, not instructions.** Text inside imported PDFs, emails or transcripts must never steer the system (prompt-injection defence).
7. **Never confuse the twins.** Every row, object, query, prompt, notification and export is scoped to exactly one `person_id`, unless it is an explicitly joint family view that labels each item A/Callum/LEFT or B/Finnley/RIGHT. Patient matching on import is a reviewed step, with a confidence score.
8. **Minimum PHI exposure.** No PHI in URLs, page titles, push notification text, logs, analytics, error trackers or commit history. Notifications say "New item needs review for Baby B", not the clinical content.
9. **No scraping and no bypassing.** Do not scrape MyChart, ConnectMyHealth or any portal. Do not claim portal integration. HHS MyChart proxy access does not grant API access. Use exports, formal records requests and uploads.
10. **No external AI on PHI until approved.** Before any PHI goes to an LLM (including Workers AI or the Anthropic API), produce a short data-handling note (what is sent, where it is processed and where it resides, retention, training opt-out). The parents must approve it in writing in the app (an `authorization` record). Until then, intelligence features use deterministic rules plus search over the family's own data.
11. **Degraded is not empty.** A failed or disconnected source shows as **DEGRADED** with the last successful sync time and raises an alert. It is never shown as "no appointments" or "nothing new".
12. **No demo data, ever.** No invented records, fixtures, seed routes or "load demo data" buttons in the app or any deployed environment. Automated tests may create obviously synthetic values inside test files only; those never ship. Screens are shown with real data or empty states.
13. **Status vocabulary for your reports:** every feature is `VERIFIED OPERATIONAL` / `PARTIAL` / `BLOCKED` / `NOT IMPLEMENTED`. Use nothing else, and no adjectives like "fully" or "seamlessly".

---

## 4. Known patient context (seed only: every item needs source reconciliation)

Load this as `PARENT_REPORT` or `EXTRACTED` seed data, with a `needs_source` flag. Do not present any of it as confirmed until linked to an original document.

**Shared:** Born **June 16, 2026** at about **33 weeks 4 days**. Monochorionic-diamniotic twin pregnancy with **TTTS**, fetal laser in April. Neonatal care at **McMaster Children's Hospital (Hamilton Health Sciences, HHS)** and **Cambridge Memorial Hospital (CMH)**. GP referenced: **Dr Amit Misra**. Pediatrician referenced: **Dr Porwal**. Confirm current roles and who holds which records. **Corrected age** = chronological age minus (40w − 33w4d) = **6 weeks 3 days**. Use corrected age for growth and development. Use chronological age for immunizations (Ontario schedule). Time zone: **America/Toronto**, DST-aware.

**Callum (Baby A, LEFT, TTTS recipient):** birth weight 2145 g (extracted). Jaundice and phototherapy, feeding and growth challenges, a possible breathing pause, a verbally reported small cardiac finding, elemental formula plus fortification, questions about growth and flow. Open items: newborn screening and imaging results not confirmed.

**Finnley (Baby B, RIGHT, TTTS donor):** birth weight 1620 g (extracted), IUGR. **June 27 SVT treated with adenosine.** Subsequent cardiology care on **propranolol**. PFO on the June echo. Holter after transfer back to CMH (parental account; report not located). Severe feeding difficulty: choking, nasal regurgitation, reflux, long feeds (~45 min reported). Elemental formula. Possible ENT, swallow/SLP, nutrition and head-ultrasound follow-up. Post-September growth trajectory unconfirmed.

**Medication reconciliation flag (must be the first live `CONFLICT`):** earlier pharmacy history says compounded propranolol **1 mg/mL**. The Oct 30 HHS MyChart extract says **5 mg/mL, 0.3 mL three times daily**. The system must keep both, show the conflict, show "verify against current bottle label and prescriber", and **never compute or suggest a dose.**

**Records still to obtain (track as records requests, all `prepared, not submitted`):**
- CMH: complete SCN/NICU files, nursing, feeding, MAR, consults, discharge, investigations, Finnley's SVT and Holter. ReleaseofInfo@cmh.org · 519-621-2333 ext. 1382.
- McMaster/HHS: birth and neonatal, inpatient and readmission, cardiology notes, ECGs, echos, Holter, labs, imaging, outpatient notes. 905-521-2100 ext. 75123.
- GP and pediatrician: complete office charts.

---

## 5. The product: three perspectives on one traceable record, plus extras

Each child's site has the same structure. A parent "Family" overview, reachable from either site, shows both boys side by side: A on the left, B on the right, always.

### 5.1 Home ("What matters now"), the landing screen
Top to bottom:
- Child identity banner: name, Baby A/LEFT or Baby B/RIGHT, colour-coded consistently, photo optional. Chronological age and **corrected age**.
- **Data freshness:** last successful sync per source, plus overall source-completeness (e.g. "Hospital records: 3 of 7 encounters have originals"). Stale data is visibly marked.
- **Today:** next feeds or meds due (from the parent-maintained schedule), today's log summary.
- **Medications:** each one labelled `Verified` or `Needs check`, with conflicts shown in red.
- **Next appointment**, with a "Prepare" button and its brief status (drafted, reviewed).
- **Open issues**, sorted by due date and urgency, each showing owner and next action.
- **Changes since last visit.**
- **Rapid log** box, always visible.

### 5.2 Clinical Record view (the MyChart side)
Chronological encounters (prenatal → NICU → readmissions → outpatient → today). Problems/diagnoses with verification class. Medications with strength, unit, dose, frequency, prescriber, start/end, dispense history and verification. Immunizations. Labs with trends. Imaging and tests. Growth charts: use the **Fenton preterm chart until 50 weeks post-menstrual age, then WHO**. Plot against corrected age and cite the chart used. Referrals. Consult letters and notes. Consent and release-of-information tracking. **Every value links one click to its original document page.** Footer: *"Family-controlled personal health record. Not a hospital EHR and not connected to MyChart."*

### 5.3 Family Life view (the parent side)
Feeds (volume, formula and recipe version, fortification, duration, difficulty, regurgitation), diapers, sleep, symptoms, observations, developmental milestones (corrected age), routines, photos and family memories, caregiver notes, supplies (formula stock, med refills), caregiver workload. Input methods: free text, quick-tap buttons, dictation, batch import. Natural-language entries are parsed into structured fields, **shown back for one-tap confirmation**, and stored as `PARENT_REPORT`. The raw text is kept alongside.

### 5.4 Intelligence view ("Ask" and "Review")
- **Ask:** natural-language questions answered **only** from that child's record. Every sentence cites dated sources. Each claim is labelled with its verification class. Before LLM approval (rule 10), this runs as structured queries plus full-text search with templated answers.
- **Review queue:** new extractions to confirm, patient-match confirmations, conflicts, observations worth raising with a clinician (e.g. "Feed duration ≥40 min logged 5 times in 7 days, linked to open issue *Finnley feeding/swallow assessment*"). Each item gets: accept / edit / reject / raise at next appointment.
- **Brief generator:** GP, pediatrician, cardiology, feeding/SLP, ENT, developmental, dietitian. Each pulls the open issues relevant to that specialty, recent changes, current meds (with conflicts), growth summary and questions to ask. Briefs are printable, can be read aloud, and can be shared as a signed, expiring, read-only link.

### 5.5 "And then some" (beyond MyChart)
- **Closed-loop referrals and records requests:** unraised → raised → ordered/sent → accepted → scheduled → completed → result received → result reviewed → communicated → closed. Each transition requires recorded evidence (who, when, source). Status history is never erased. Overdue transitions raise alerts with a drafted follow-up message for a parent to send.
- **Care-team roster and accountability:** every issue has a responsible provider (who orders, who receives results, who communicates).
- **After-visit reconciliation:** upload notes, a recording transcript or a photo of the instructions. The system drafts decisions, new tasks, due dates and follow-ups, and **an issue is never marked resolved just because it was discussed.**
- **Source coverage monitor:** per source, connected / degraded / disconnected, last success, and gaps (e.g. "No CMH documents after June 30").
- **Privacy-safe TV mode** (Fire TV, shared screens): first names and schedule only. No diagnoses, no meds, no notes.
- **Family memory layer:** milestones, firsts, photos. Medical complexity is one part of each boy's life, not his whole identity.

---

## 6. Architecture (decided; deviate only with a written ADR)

**Stack:** Cloudflare, because the zone and the repo already are. TypeScript end to end.

| Concern | Choice |
|---|---|
| Hosting and routing | One Worker (`familyos`) with custom domains `familyos.libbyhd.org` (household/parent view: each child's summary side by side, read-only, links down) plus `callum.libbyhd.org` and `finnley.libbyhd.org`. The **hostname selects the person context** (via a `presentation_preference`/host-mapping row, not hard-coded). A request's hostname person must equal the person on every resource it touches, or the response is a 404. |
| Frontend | Installable PWA served from Workers static assets. Use a small framework (Preact/React + Vite, or Hono JSX). It must work at iPhone 15 Pro Max width, with iPad keyboard navigation, and in a 10-foot TV layout. Service worker caches the shell only. **Never cache PHI responses offline** without an explicit, revocable per-device opt-in. |
| API | Hono on Workers, Zod validation on every input. |
| Relational and event store | **D1**. Append-only `events` table, plus projection tables for current state. Numbered migrations under `migrations/`. |
| Originals | **R2** bucket `familyos-originals`. Key = `person/{person_id}/sha256/{hash}`. Write-once in code; metadata stored in D1. |
| Background jobs | **Queues** (ingest, extract, reconcile, notify) with retries and a **dead-letter queue** surfaced in the UI. **Cron Triggers** for scheduled work (see §9). |
| Search | D1 FTS5 for full text. Semantic retrieval (Vectorize) only after rule 10 approval, and per-patient namespaces only. |
| AI | Off for PHI until approved. Then, if approved, use the Anthropic API (latest Claude model) or Workers AI per the approved data note. Tool-restricted: the model can only call read functions scoped to the hostname patient. |
| Auth | **Decided 2026-11-02: Google sign-in**, the method already live on `lifeos.libbyhd.org` (Google Cloud project "LifeOS", client "Life OS web"). The Worker verifies the Google ID token on every request (signature, client id, issuer, expiry, `email_verified`) against an `ALLOWED_EMAILS` allow-list, and holds it in a Secure HttpOnly cookie. A Cloudflare Access JWT is also accepted if Access is added later. Fail closed when neither is configured. |
| Deploy | **Cloudflare Workers Builds, already connected to this repo** (account `92ca8386…`, Worker `vault`). The root `wrangler.jsonc` is the production config, and merging to `main` deploys. `apps/familyos/wrangler.jsonc` is dev/test only, with no routes. |
| Secrets | Wrangler secrets only. Nothing in the repo. Add `.dev.vars` to `.gitignore`. |
| Environments | `dev` (local Miniflare, fixtures only, **no real PHI**), `staging` (synthetic data), `production`. |
| CI/CD | The existing Cloudflare Workers Builds git integration does the deploys. GitHub Actions run the checks: typecheck, lint, unit tests, Workers integration tests (vitest-pool-workers), secret scan (gitleaks), dependency audit, `wrangler deploy --dry-run`. Deploy to production only from `main` after the checks pass. Keep the previous version for `wrangler rollback`. |
| Backups | Nightly Cron: D1 export (Time Travel plus a SQL dump to a separate R2 bucket `familyos-backups`, retained 90 days). Monthly **restore drill** into staging, with the results logged. R2 originals are already content-addressed. Document how to replicate them off-Cloudflare (e.g. to the Toshiba box or Drive) as an optional extra copy. |
| Monitoring | Workers observability with **PHI-free logs** (IDs and codes only). An uptime and TLS check on both hostnames, plus a health endpoint that reports source-sync status without PHI. Alert email to the parents on failures. |
| Local core (optional) | The Toshiba box can later run a sync agent (e.g. watched-folder uploads, Cloudflare Tunnel). The service must keep working with it off. |

Write ADRs in `docs/adr/` for: platform choice, auth model, event sourcing, AI data handling, growth-chart choice.

---

## 7. Data model (D1)

Stable ULID ids. Every PHI table has `person_id NOT NULL` with a foreign key, plus `created_at`, `created_by` and `source_id`/`provenance_id` where applicable. Clinical tables are **append-only**: updates become new rows with `supersedes_id`, and current state is a view or projection.

Use the Part I object model. Health tables are LifeOS health-domain tables keyed by `person_id`. Nothing in the schema is twin-specific or patient-only.

Core tables: `person`, `household`, `household_membership`, `relationship`, `organization`, `presentation_preference`, `case`, `claim`, `consent`, `user` (a login, linked to a `person`), `role`, `person_access`, `provider`, `care_team_member` (person, provider, specialty, responsibility), `encounter`, `problem`, `observation` (code, value, unit, device, author, effective_at), `vital`, `growth_measurement`, `milestone`, `care_plan`, `medication` (name, form, strength_value, strength_unit, dose_value, dose_unit, frequency, route, prescriber, start, end), `medication_dispense`, `medication_admin` (optional), `allergy_intolerance`, `feeding_log`, `formula_recipe` (versioned), `sleep_event`, `diaper_event`, `immunization`, `procedure`, `order`, `result`, `referral`, `referral_status_event`, `records_request`, `records_request_status_event`, `correspondence`, `appointment` (with `discovered_via`, `discovered_at`, `source_id`), `brief` (versioned, with the list of issues included), `question`, `issue`, `issue_status_event`, `task`, `clinical_decision`, `authorization` (approvals, consents, AI data-handling approval), `document` (R2 key, sha256, mime, pages, original filename, received_at, origin), `evidence_link` (fact ↔ document + page/char span), `provenance` (verification class, asserted_by, asserted_at, method), `conflict` (subject, conflicting fact ids, status, resolution evidence), `source` (type, config ref, last_success_at, last_error, status), `import_job`, `automation_run` (job, started, finished, result, error), `access_log` (user, person, route, action, ip-hash, at), `events` (append-only domain event log), `notification`.

**Issue rules:** every issue has patient, title, specialty, first_reported_at, source links, current status, owner (provider and/or parent), due date, next action, last_reviewed_at, and closure evidence (required to close). Lifecycle: `unraised → raised → ordered → sent → accepted → scheduled → completed → result_reviewed → communicated → closed` (not every issue uses every step). Each transition is an `issue_status_event`. Never delete one.

---

## 8. Ingestion pipeline

Every inbound item, whether upload, email attachment, Drive file, calendar event or log entry, flows through:

`receive → quarantine (type/size/magic-byte check, reject executables) → SHA-256 + dedupe → store original in R2 → extract (PDF text; OCR later; CDA/FHIR parse when available) → patient match (name/DOB/MRN/hospital + A/B cues, confidence score; below threshold or any ambiguity goes to the review queue) → normalize (dates to America/Toronto, units, provider names) → reconcile (compare with existing facts; create CONFLICT records) → write events + projections → index → create review items/tasks → notify if meaningful`

- Idempotent by hash and source id. Replayable. Retries with backoff. Dead-letter queue visible in the UI.
- Uploading the same record twice is a dedupe. Uploading two different versions keeps both originals linked and reconciles field by field.
- Each `source` tracks `last_success_at` and coverage gaps. Errors are surfaced, never swallowed.

**Connectors, in priority order.** Each is `NOT IMPLEMENTED` until tested end to end.
1. **Manual upload** (web, mobile share sheet, drag-drop): Phase 1.
2. **Manual appointment entry**: Phase 1. This is the guaranteed fallback for the Nov 2 class of failure.
3. **Google Drive import** (one-time, plus incremental for a designated FamilyOS folder) via a Google service account or OAuth. **Needs the parents' authorization.**
4. **Google Calendar** (all relevant calendars, not just primary) and **Gmail** (appointment confirmations, filtered by sender and keyword) via OAuth with read-only scopes. **Needs authorization.**
5. **Operations Control Board** (Sheets): import APPOINTMENTS, WAITING_ON and TASKS, then decide in an ADR whether the Sheet stays a mirror or is retired. Never keep two editable sources of truth.
6. Later: HHS MyChart **exports** uploaded by a parent, formal records-release PDFs, pharmacy labels (photo), Otter/visit transcripts (with consent), BlueBubbles (only if lawful and authorized).

---

## 9. Automation (real Cron Triggers, not promises)

| Schedule (America/Toronto; store as UTC cron and document DST) | Job |
|---|---|
| Every 30 min | Sync connected sources; update source health; alert on degraded |
| Hourly | Appointment discovery and dedupe. For each appointment, check for briefs due at **T-7d, T-48h, T-12h**. If an appointment is discovered late, draft the brief **immediately**. |
| Daily 06:00 | Due/overdue sweep (issues, referrals, records requests, refills, formula supply). Immunization forecast (Ontario schedule, chronological age, verified rules with citation). Milestone surveillance (corrected age). One digest per day at most, no PHI in the notification body. |
| Daily 03:00 | Backup D1 to R2; verify the dump. |
| Weekly (Sun) | Longitudinal reconciliation: unresolved conflicts, stale issues (no review for 14 days or more), coverage gaps, missing originals per encounter. |
| Monthly | Restore drill to staging; record the result in `automation_run`. |

Every run writes an `automation_run` row. The UI shows the last run and result for each job. A job that hasn't succeeded in 2× its interval raises an alert. Notifications are deduped and sent only for meaningful changes.

Notification channel: email to the parents first (Cloudflare Email Routing/Workers email or a transactional provider). Web Push is optional. The body links to the app and contains no PHI.

---

## 10. Security, privacy and consent

- **Threat model** (`docs/security/threat-model.md`): twin mix-up, cross-patient access (IDOR), Access misconfiguration, a stolen phone or session, a compromised email account, prompt injection via documents, malicious uploads, PHI leaking into logs or LLMs, backup or restore failure, DNS hijack, an insider caregiver over-reach.
- **Ontario privacy assessment** (`docs/security/privacy-assessment.md`): explain whether PHIPA applies to the family as a non-custodian (it generally governs custodians such as hospitals and clinics, and the family's own PHR is likely outside its custodial duties), and what PIPEDA covers. Do not claim "PHIPA compliant". Cover consent, revocation, emergency access ("break-glass" with logging), retention, export and deletion, and an **age-transition plan** (records are the boys' own as their capacity grows).
- Encryption in transit (TLS everywhere, HSTS) and at rest (Cloudflare platform encryption; document exactly what it covers, with no overclaiming).
- Least privilege, roles, audit log of every PHI read and write, MFA or passkeys via Access, session lifetime ≤ 24 h, re-auth for sharing and exports.
- **Clinician share packages:** a signed, expiring (default 7 days), single-patient, read-only link or PDF. Every view is logged, and it can be revoked.
- Security headers: CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. `noindex` everywhere.

---

## 11. Accessibility and UX acceptance

WCAG 2.2 AA at minimum: high contrast, 44×44 px targets, full keyboard support, screen-reader labels, reduced-motion support, dark mode, text resizing to 200%, plain language. Colour is never the only signal (A/B also uses a label and a position). Read-aloud on briefs and summaries. Print stylesheet. Low-bandwidth behaviour (no heavy images, skeleton states). Run axe-core in CI. Do a manual VoiceOver pass on iPhone.

---

## 12. Build order with exit criteria

Work in dependency order. **Commit after each phase.** Each phase ends with its tests passing and the status ledger updated.

**Phase 0: Audit (read-only).** Inventory: this repo, the Cloudflare account and zone (via `wrangler whoami` once a token exists), DNS records, Drive folders, the Ops Board tabs, calendars, Gmail labels, existing scheduled tasks, any other repos the parents name (`mattherbert01`, `libbynatico`, `LibbytheLibrarian`, the `natico-*` repos). Use `list_repos` and request access through the session's repo tools; don't guess. Run read-only integration tests for each connector you can reach. Output: **the Master Architecture Registry (§I.6)**, `docs/audit/2026-11-inventory.md`, `docs/audit/claim-ledger.md` (each previously claimed capability, then evidence, then true/false/unknown), and the blocker register. **Do not ask the parents for anything you can discover yourself.**

**Phase 1: Secure shell, live on both domains.** Replace the template. D1 schema v1, R2, Access JWT verification, hostname → patient scoping, patient seed records, upload/download of originals with a hash, access log, manual appointment entry, health endpoint. Deploy. **Exit:** from an external network, both URLs serve over HTTPS, unauthenticated requests get the Access login (no PHI in the body), an authenticated parent sees persisted data, and Callum's site cannot fetch any Finnley object (404).

**Phase 2: Records.** Drive import, then dedupe, then bind originals to the correct child (review queue for matches). Chronology from prenatal to today. Missing-original markers. Records-request tracker with the CMH, HHS, GP and pediatrician requests seeded as `prepared`. **Propranolol conflict live.**

**Phase 3: Action layer.** Issues, questions, referrals with a closed loop, care-team roster, calendar and Gmail appointment discovery, source-health monitoring, T-7d/48h/12h briefs, after-visit reconciliation, Ops Board import.

**Phase 4: Family life and intelligence.** Rapid natural-language log, feeds/sleep/diapers, trends, growth charts with corrected age, milestones, specialty briefs, the Ask feature (rules and search first; LLM only after approval), TV mode, the family overview.

**Phase 5: Hardening.** Runbooks, backup/restore drill evidence, security review, accessibility audit, device acceptance (iPhone 15 Pro Max, iPad, Fire TV), alert tests, durable jobs, rollback test.

---

## 13. Acceptance tests (each must be automated where possible and logged with pass/fail)

Use **synthetic fixtures** in CI and public logs. Run the real-data checks only in production, by a parent or with their explicit go-ahead, and keep the results PHI-free.

1. **Twin isolation:** every API route, when called on the Callum host with a Finnley id, returns 404. A fuzz test covers all routes. An import with an ambiguous patient goes to the review queue, never auto-assigned.
2. **Finnley cardiac chain:** the June 27 SVT encounter links to hospital notes, outpatient cardiology, the Holter (shown as a **missing original** gap) and the propranolol conflict. There is no current dose anywhere unless it comes from a verified source.
3. **Callum GP packet:** feeding, growth and cardiac history produce a cited GP brief. Every line traces back to a source or is labelled `PARENT_REPORT` or `AI_INFERENCE`.
4. **The Nov 2 regression:** enter the Nov 2 vaccination appointment manually. It persists, triggers an immediate brief for both boys, creates follow-up tasks, and is visible on a second device after reload.
5. **Degraded source:** revoke or disconnect the calendar source. The UI shows DEGRADED with a last-success time and an alert is sent. The UI must not show "no upcoming appointments".
6. **Versioned records:** upload the same PDF twice (one original, deduped), then a revised version (two originals, field-level reconciliation, conflict where they differ).
7. **Closed loop:** a referral cannot move to `accepted` or `closed` without an evidence attachment or note. History is preserved.
8. **Time:** corrected age is right for a 33w4d birth on 2026-06-16. Due times survive the DST change (Nov 1 2026 and Mar 14 2027) in America/Toronto.
9. **Resilience:** data survives a Worker redeploy and a `wrangler rollback`. A backup restores into staging with matching row counts and hashes.
10. **Auth:** unauthenticated → Access wall. A forged or missing JWT is rejected by the app. The denial is logged. No PHI is in any unauthenticated response, header or error.
11. **Devices and accessibility:** axe-core has zero serious violations. iPhone and iPad manual checks are done. TV mode shows no clinical data.
12. **Live domains:** `https://familyos.libbyhd.org`, `https://callum.libbyhd.org` and `https://finnley.libbyhd.org` are reachable externally, TLS is valid, authentication is enforced, real persisted data renders after login, and the uptime/TLS monitor fires a test alert. **Domain reachability alone is not a pass.**
13. **The acceptance question** (§0) is answered for both boys with dated citations, verification labels and outstanding actions.

---

## 14. What to hand back (every session)

Create or update `docs/STATUS.md`, the status ledger:

| Feature | Status (`VERIFIED OPERATIONAL`/`PARTIAL`/`BLOCKED`/`NOT IMPLEMENTED`) | Evidence (test name, log, URL, commit) | Next step |

Also deliver: the commits and PR link, deployed URLs, ADRs, migrations, source inventory and gap list, import report, test matrix with real results, security and privacy docs, backup/restore proof, `docs/RUNBOOK.md` (operator), `docs/QUICKSTART.md` (one page for the parents, plain language, with screenshots taken from the **real** app using synthetic data), known limitations, and the **blocker register**.

No screenshots of mockups, Figma or Canva as proof. No "simulated" results. No executive-summary bragging.

---

## 15. Blocker protocol: the smallest action the parents need to take

When blocked, stop on that path, keep going on everything else, and record:

`BLOCKER | what's blocked | exact thing needed | where the parent does it (step by step, ≤5 steps) | what you'll do the moment it's provided`

Blockers you should expect. Ask for them **once, together, as a short checklist**:
1. **Cloudflare API token** (Workers Scripts:Edit, D1:Edit, R2:Edit, Queues:Edit, Zone DNS:Edit and Workers Routes:Edit for `libbyhd.org`, Access: Apps and Policies:Edit) plus the account id, stored as a CI/GitHub secret and a session env var. Never pasted into a committed file.
2. **Parent email addresses** for the Cloudflare Access allow-list (Matt's and Kellsie's).
3. **Google OAuth consent** for read-only Drive, Calendar and Gmail scopes, or sharing of a designated FamilyOS Drive folder with a service account.
4. **Approval of the AI data-handling note** (rule 10) before any LLM sees PHI.
5. Governance freeze v4.2.1 and gates A/B/C text, if it isn't found in Drive.
6. **GitHub move (decided: `LibbyHD/familyOS`).** The parents create the `LibbyHD` organization (if it doesn't exist) and transfer `gutsymatt/vault` into it, renamed `familyOS`. The Cloudflare GitHub app must then be granted access to the new org, or Workers Builds stops. Until the move happens, keep working in `gutsymatt/vault`.
7. **Access to the historical repos** (`natico-org`, `libby-live`, `sentinel-framework`, `natico-case-vault`, `LibbytheLibrarian/LibbyHD`, etc.) for read-only registry audit, and a pointer to the D-drive/Toshiba inventory if it isn't in Drive.

---

## 16. Out of scope (don't do it, and don't pretend to)

Building LifeOS, SENTINEL case tooling, Libby Live or NATICO public features beyond what Part II needs (they're registry and backlog items until this slice passes); live Epic/MyChart or ConnectMyHealth integration; submitting records requests or sending clinic messages without a parent pressing send; dosing calculators; diagnostic suggestions; public pages; creating extra Google Docs as a substitute for the app.

---

**Begin with Phase 0 now.** Implement as far as your actual permissions allow. When you are blocked, leave committed, tested code plus a precise blocker register. The family should never again have to audit an agent's claims to discover that nothing works.
