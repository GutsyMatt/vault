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

## Do next, in order
1. **Approved by Matthew 2026-11-02 ("Yes use drive records")**, which is the AI data-handling approval from the directive. add past life events for each boy from Drive (search "Callum", "Finnley", "NICU", "MyChart", "discharge", "cardiology", "Holter") using the automation key. Mark them `EXTRACTED` and include the source doc link in the note. Never mix the twins. Add the propranolol record pair (1 mg/mL vs 5 mg/mL) as two medication records, so the app flags the conflict.
2. **Google Calendar API:** Matthew was asked to enable it (https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=406206707598). Then build the background Google connection (one "Connect Google" tap; it needs offline OAuth and a client secret stored server-side). Use it for appointment detection from calendars and Gmail.
3. **Email the monthly keepsake letters** to the boys' Gmail addresses (Callum `hnatejkoc@gmail.com`, Finnley `hnatejkof@gmail.com`; enter them via each boy's Letters setting once email works) through the same Google connection.
4. Rename the repo `vault` → `familyOS` (Matthew's account is now `LibbyHD`).

## How to work
- Tests: `cd apps/familyos && npm run check` (typecheck, 41 tests, deploy dry-run).
- Ship: branch → PR → merge into `main` → wait for `https://callum.libbyhd.org/healthz` to show the new `APP_VERSION` → verify live.
