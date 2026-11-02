# Next session: start here

Read `CLAUDE.md`, then this file, then `docs/STATUS.md`. Don't ask Matthew to re-explain anything.

## Live now (verified 2026-11-02)
- `familyos.libbyhd.org` (parent view), `callum.libbyhd.org`, `finnley.libbyhd.org`. Cloudflare Worker `vault`, deployed automatically on merge to `main`.
- Google sign-in works for Matthew. Kellsie (`hnatejkok@gmail.com`) is allow-listed and a Google test user.
- Both boys' profiles are set up (born 2026-06-16, 33w4d).
- Claude's automation key works. It's in Matthew's Drive: "FAMILYOS — Claude automation key (PRIVATE, do not share)". See CLAUDE.md rule 11.
- Features live: medication conflicts, visit briefs plus cron, closed-loop issues, quick log with urgent guidance, documents, source health, Story tab (Google Photos picker plus past events by week), monthly keepsake letters (stored; not emailed yet).

## Matthew's preferences
- **He does not want to be manually involved.** Do the work yourself with the automation key, merge your own PRs (he authorised this), and only ask for things only he can physically do.
- Keep messages short and plain. He gets confused by settings pages: give one direct link and the exact taps.
- No demo data, ever.

## Done 2026-11-02 (with the automation key)
- Past events loaded from the two HHS MyChart summaries (Oct 30): 6 for Callum, 7 for Finnley. All `EXTRACTED`, each with its source doc link. There's an idempotency guard (same date and title are skipped).
- Finnley's medications: propranolol 1 mg/mL (family report) vs 5 mg/mL (MyChart), so the CONFLICT is live; ferrous sulfate. Callum has no medications on record.
- Scripts call the API with a `user-agent` header, because Cloudflare blocks the default Python UA (403).

## Do next, in order
1. **Approved by Matthew 2026-11-02 ("Yes use drive records")**, which is the AI data-handling approval from the directive. add past life events for each boy from Drive (search "Callum", "Finnley", "NICU", "MyChart", "discharge", "cardiology", "Holter") using the automation key. Mark them `EXTRACTED` and include the source doc link in the note. Never mix the twins. Add the propranolol record pair (1 mg/mL vs 5 mg/mL) as two medication records, so the app flags the conflict.
2. **Google Calendar API:** Matthew was asked to enable it (https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=406206707598). Then build the background Google connection (one "Connect Google" tap; it needs offline OAuth and a client secret stored server-side). Use it for appointment detection from calendars and Gmail.
3. **Email the monthly keepsake letters** to the boys' Gmail addresses (Callum `hnatejkoc@gmail.com`, Finnley `hnatejkof@gmail.com`; enter them via each boy's Letters setting once email works) through the same Google connection.
4. Rename the repo `vault` → `familyOS` (Matthew's account is now `LibbyHD`).

## How to work
- Tests: `cd apps/familyos && npm run check` (typecheck, 41 tests, deploy dry-run).
- Ship: branch → PR → merge into `main` → wait for `https://callum.libbyhd.org/healthz` to show the new `APP_VERSION` → verify live.

## Drive sources not yet loaded
- `2026-09-02_finnley_cardiology-svt-dr-netto…` (`1dbGhWtE2lZ2_ZyjAiaE_qpLeZK5fNyWFYtQFtUwOFw0`): visit transcript, for cardiology questions and issues.
- `2026-08-19_finnley_vaccination-health-review…` (two copies: `1LMbsQ9l…`, `18njdKC1…`). Deduplicate first.
- `FamilyOS — Callum/Finnley — Longitudinal Patient File and Record Gaps` (`1O20VsCj…`, `1StK-mxk…`): turn record gaps into issues (records requests to CMH and HHS).
- `GP Vaccine Visit Brief and Open Referral Register` (`1pbZtBhP…`): add the Nov 2 vaccination appointment and the open referrals as issues.
- Cambridge Memorial (CMH) records: none in Drive yet. That's a records request to track as an issue.
