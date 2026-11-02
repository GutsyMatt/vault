# FamilyOS status ledger

Last updated: 2026-11-02, by a Claude Code session. Status words: `VERIFIED OPERATIONAL` / `PARTIAL` / `BLOCKED` / `NOT IMPLEMENTED`.

"Verified" below means verified **locally**: automated tests (synthetic values inside test files only) plus a real browser run against an empty store. The app contains no demo data. **Nothing is deployed yet**, so no feature is `VERIFIED OPERATIONAL` in production.

| Feature | Status | Evidence | Next step |
|---|---|---|---|
| App code: Worker, per-person Durable Object (SQLite), PWA shell | PARTIAL (built and tested locally) | `apps/familyos/`; `npm test` = 25/25 pass; `wrangler deploy --dry-run` OK; local browser run (phone and iPad sizes) | Deploy (blocked: B1–B3) |
| Household (parent) site `familyos.libbyhd.org`: both children side by side, read-only cards, "could not load" never shown as empty | PARTIAL (tested locally) | Tests "household (parent) view" | Deploy |
| No demo data in the app (no seed route, no demo button) | PARTIAL (tested locally) | Test "there is no demo-data route anywhere" | |
| Person isolation (hostname selects person; other person's ids are 404) | PARTIAL (tested locally) | Test "1. person isolation" | Re-run against production after deploy |
| Fail-closed auth: Cloudflare Access JWT verified in-app; refuses everything when not configured; no PHI in denial pages | PARTIAL (tested locally) | Tests "10. authentication fails closed", "Access JWT verification" | Configure Access (B2), then test from outside the home network |
| `workers.dev` and preview URLs disabled for the app | PARTIAL | `apps/familyos/wrangler.jsonc` (`workers_dev: false`, `preview_urls: false`) | Confirm in Cloudflare dashboard after first deploy |
| Medication conflict detection (never picks or computes a dose; resolution needs evidence; old record kept as historical) | PARTIAL (tested locally) | Test "2. medication conflict" | Enter the real propranolol records after deploy |
| Appointment entry, immediate brief when discovered late, T-7d/48h/12h briefs via cron | PARTIAL (tested locally; cron not yet running) | Tests "4. appointment…" | Deploy; confirm the first cron run appears under Sources → Automatic checks |
| Visit brief (open issues, meds with conflicts, 14-day observations, system patterns, questions; print and read-aloud; versions kept) | PARTIAL (tested locally) | Test 4; screenshot 2 | Parent review of wording |
| Issue tracking with closed loop (evidence required past "raised"; history never erased) | PARTIAL (tested locally) | Test "7. closed loop"; screenshot 4 | |
| Quick log (one sentence → parsed parent report) and urgent-phrase 911/811 guidance | PARTIAL (tested locally) | Tests "rapid log + safety"; screenshot 3 | Care team to review the red-flag list in `src/lib.ts` |
| Documents: originals stored byte-for-byte, SHA-256, dedupe, receipts, executable rejection | PARTIAL (tested locally) | Test "6. originals" | Bulk import of Drive records (Phase 2) |
| Source health: NOT CONNECTED / DEGRADED shown, never "nothing found" | PARTIAL (tested locally) | Test "5. degraded sources" | Build real connectors |
| Corrected age and America/Toronto DST handling | PARTIAL (tested locally) | Test "8. time and corrected age" | |
| Full JSON export per person | PARTIAL (tested locally) | Test "export" | |
| Google Calendar / Gmail / Drive connectors | NOT IMPLEMENTED | Sources page shows them as NOT CONNECTED | Needs OAuth approval (B4) |
| Growth charts, milestones, specialty-specific brief templates, family overview, TV mode | NOT IMPLEMENTED | | Phase 4 |
| Notifications (email digest) | NOT IMPLEMENTED | | Phase 3 |
| Backups and restore drill | NOT IMPLEMENTED | Durable Objects have built-in point-in-time recovery, which is not yet tested | Phase 5 |
| AI features on PHI | NOT IMPLEMENTED (by design) | | Needs the parents' approval of an AI data-handling note (B5) |
| CI workflow running the app tests on GitHub | NOT IMPLEMENTED | The existing Workers Builds check covers only the root template | Add `.github/workflows` once allowed |

## Blockers (smallest action needed)

| # | Blocked | Needed | Where |
|---|---|---|---|
| B0 | Confirm sign-in | Sign-in is believed live, but on 2026-11-02 no Cloudflare Access login appeared on any reachable `libbyhd.org` host (`libbyhd.org` is public; `app.` shows a Cloudflare DNS error). Provide the Zero Trust **team domain** and either add `familyos.`, `callum.` and `finnley.libbyhd.org` to the existing Access application (then send its **AUD tag**) or create one | Cloudflare Zero Trust → Access → Applications |
| B1 | Deploying to `familyos.`, `callum.` and `finnley.libbyhd.org` | Either run `cd apps/familyos && npx wrangler deploy` yourself while logged in to Cloudflare, or provide a Cloudflare API token (Workers Scripts, Workers Routes, DNS edit on `libbyhd.org`) as a session secret | Cloudflare dashboard → My Profile → API Tokens |
| B2 | Sign-in | Ensure a Cloudflare Access application covers all three hostnames, allowing Matt's and Kellsie's emails. Copy its **AUD tag** and your **team domain** | Cloudflare Zero Trust → Access → Applications |
| B3 | App-layer allow-list | Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS` (`npx wrangler secret put …` or dashboard → Worker → Settings → Variables) | Same |
| B4 | Calendar, Gmail and Drive connectors | Approve read-only Google access | Later phase |
| B5 | Any AI on health data | Approve a data-handling note | Later phase |

| B6 | Move repo to `LibbyHD/familyOS` | Create the `LibbyHD` GitHub org if needed, then transfer `gutsymatt/vault` to it and rename it to `familyOS`. Afterwards, give the Cloudflare GitHub app access to the org so builds keep working | GitHub → repo Settings → Transfer |
