# FamilyOS app: CallumOS + FinnleyOS

The first working slice of the NATICO platform (see `docs/ONE_SHOT_PROMPT.md`, Part II). Status: `docs/STATUS.md`.

## How it is built
- **One Cloudflare Worker** serves `callum.libbyhd.org` and `finnley.libbyhd.org`. The **hostname decides the person**. There is no other way to choose one.
- **One Durable Object (SQLite) per person** (`PersonVault`). A person's records, documents, logs and audit trail live only in that person's object. An id from the other child is simply not found (404).
- **Append-only:** status changes, medication verifications and conflict resolutions are new rows. Nothing clinical is updated in place or deleted.
- **Fail-closed auth:** every request must carry a valid Cloudflare Access JWT for an allow-listed email. With Access not configured, the site is locked. `workers.dev` and preview URLs are off.
- **No AI and no external calls with health data.** Briefs and patterns are deterministic rules, labelled "system pattern".

## Run locally (demo data only)
```bash
npm ci                         # at repo root
cd apps/familyos
cp .dev.vars.example .dev.vars
npm run dev:callum             # http://127.0.0.1:8787 (Callum)
npm run dev:finnley            # http://127.0.0.1:8788 (Finnley), in a second terminal
```
On first open, tap **Load demo data**. Demo data is invented and bannered as such.

## Test
```bash
cd apps/familyos && npm run check   # typecheck + 22 tests + deploy dry-run
```

## Deploy (needs blockers B1–B3 in docs/STATUS.md)
```bash
cd apps/familyos
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ALLOWED_EMAILS        # e.g. a@x.com,b@y.com
npx wrangler deploy --var ACCESS_TEAM_DOMAIN:<team>.cloudflareaccess.com
```
Then from a phone on cellular: open both URLs. You should see the Access login, then the setup screen. Enter each child's details once.
