# FamilyOS status ledger

Last updated: 2026-11-02, by a Claude Code session. Status words: `VERIFIED OPERATIONAL` / `PARTIAL` / `BLOCKED` / `NOT IMPLEMENTED`.

**Deployed 2026-11-02 ~04:05 UTC** (merge of PRs #2, #3, #5 → Workers Builds → Worker `vault`, v0.3.0). Verified from outside the home network: `familyos.`, `callum.` and `finnley.libbyhd.org` resolve, serve valid HTTPS, and show only the Google sign-in page. `/api/summary` and `/api/export` return 401 without sign-in; a forged session cookie gets 401; a cross-site write gets 403; `vault.mattherbert01.workers.dev` now returns 404. **Not yet verified:** a successful sign-in with real data, because Google first needs the three addresses added as authorized JavaScript origins (Path to live, step 1).

Elsewhere, "verified" means verified **locally**: automated tests (synthetic values inside test files only) plus a real browser run against an empty store. The app contains no demo data. **Nothing is deployed yet**, so no feature is `VERIFIED OPERATIONAL` in production.

| Feature | Status | Evidence | Next step |
|---|---|---|---|
| App code: Worker, per-person Durable Object (SQLite), PWA shell | PARTIAL (built and tested locally) | `apps/familyos/`; `npm test` = 29/29 pass; `wrangler deploy --dry-run` OK; local browser run (phone and iPad sizes) | Deploy (blocked: B1–B3) |
| Household (parent) site `familyos.libbyhd.org`: both children side by side, read-only cards, "could not load" never shown as empty | PARTIAL (tested locally) | Tests "household (parent) view" | Deploy |
| No demo data in the app (no seed route, no demo button) | PARTIAL (tested locally) | Test "there is no demo-data route anywhere" | |
| Person isolation (hostname selects person; other person's ids are 404) | PARTIAL (tested locally) | Test "1. person isolation" | Re-run against production after deploy |
| Fail-closed sign-in: Google ID token verified on every request (signature, client, issuer, expiry, verified email, allow-list); Cloudflare Access also accepted; cross-site writes refused; no PHI on the sign-in page | PARTIAL (tested locally) | Tests "Google sign-in…", "10. authentication fails closed", "Access JWT verification" | Path-to-live steps 1–4 |
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
| Keepsake letters: parents write letters; "keep this for him" on log entries; a monthly letter per child (1st of the month, previous month), stored permanently and in the export; medical details excluded unless kept on purpose | PARTIAL (tested locally) | Tests "keepsake letters"; browser check of Letters tab | Email delivery (B7) |
| Keepsake email delivery to each boy's own address | NOT IMPLEMENTED | Each letter records `NOT_SENT_DELIVERY_NOT_CONNECTED` or `NOT_SENT_NO_ADDRESS`, never silent | B7 |
| Google Calendar / Gmail / Drive connectors | NOT IMPLEMENTED | Sources page shows them as NOT CONNECTED | Needs OAuth approval (B4) |
| Growth charts, milestones, specialty-specific brief templates, family overview, TV mode | NOT IMPLEMENTED | | Phase 4 |
| Notifications (email digest) | NOT IMPLEMENTED | | Phase 3 |
| Backups and restore drill | NOT IMPLEMENTED | Durable Objects have built-in point-in-time recovery, which is not yet tested | Phase 5 |
| AI features on PHI | NOT IMPLEMENTED (by design) | | Needs the parents' approval of an AI data-handling note (B5) |
| CI workflow running the app tests on GitHub | NOT IMPLEMENTED | The existing Workers Builds check covers only the root template | Add `.github/workflows` once allowed |

## Path to live (replaces the earlier Cloudflare Access plan)

Sign-in uses the **Google sign-in already live on `lifeos.libbyhd.org`** (Google Cloud project "LifeOS", client "Life OS web"). Deployment uses the **Cloudflare Workers Builds already connected to this repo** (account `92ca8386…`, Worker `vault`). No new Cloudflare key or Zero Trust setup is needed.

| # | Step | Who | Where |
|---|---|---|---|
| 1 | In Google Cloud → project **LifeOS** → APIs & Services → Credentials → **Life OS web** → Authorized JavaScript origins, add `https://familyos.libbyhd.org`, `https://callum.libbyhd.org`, `https://finnley.libbyhd.org` | Matthew | console.cloud.google.com |
| 2 | (For Kellsie) add her Google address as a **test user** on the LifeOS OAuth consent screen, and to `ALLOWED_EMAILS` in `wrangler.jsonc` | Matthew / Claude | Same project → OAuth consent screen |
| 3 | ~~Merge PR #2, then PR #3~~ **Done 2026-11-02 by Claude, at Matthew's request.** Workers Builds then deploys automatically. **This replaces the unused chat template currently deployed as the `vault` Worker.** | Matthew | GitHub |
| 4 | Verify from cellular: all three sites show Google sign-in, then empty setup; a non-approved Google account is refused | Claude, with Matthew's phone | |

Known risk at step 3: the Workers Builds token may lack permission to create the three custom domains. If the build log says so, add them by hand: Cloudflare → Workers & Pages → vault → Settings → Domains & Routes → Add → Custom domain (one per address).

## Other blockers
| # | Blocked | Needed |
|---|---|---|
| B7 | Emailing the boys' monthly letters | `libbyhd.org` mail runs on Google Workspace (MX → Google), so Cloudflare email can't be used without moving mail. Needs one Google sending credential (e.g. a `family@libbyhd.org` mailbox authorised for Gmail sending). The boys' Gmail addresses are already created; enter them in each boy's Letters tab |
| B4 | Calendar, Gmail and Drive connectors | Uses the same LifeOS Google project. Later phase |
| B5 | Any AI on health data | Approve a data-handling note |
| B6 | Repo name `LibbyHD/familyOS` | Account rename to `LibbyHD` is **done** (2026-11-02). Remaining: rename the repo `vault` → `familyOS` in Settings → General, then confirm Cloudflare → vault → Settings → Build still shows it connected |
