# FamilyOS (LibbyHD → FamilyOS)

| Site | What it is |
|---|---|
| `familyos.libbyhd.org` | Parent/household view: both boys side by side (Callum left, Finnley right). Read-only summary, links down |
| `callum.libbyhd.org` | CallumOS: Callum's full record |
| `finnley.libbyhd.org` | FinnleyOS: Finnley's full record |

Build brief: `docs/ONE_SHOT_PROMPT.md`. Status: `docs/STATUS.md`.

## How it is built
- **One Cloudflare Worker** serves all three sites. The **hostname decides the person** (or the household view). There is no other way to choose one.
- **One Durable Object (SQLite) per person** (`src/storage/person-vault.ts`). A child's records, documents, logs and audit trail live only in his object. Ids from the other child are not found (404). The household site can read only each child's compact summary card, with no write routes.
- **Append-only:** status changes, medication verifications and conflict resolutions are new rows. Nothing clinical is updated in place or deleted.
- **Fail-closed sign-in:** every request must carry a valid Cloudflare Access JWT for an allow-listed email. Until Access is configured, every site is locked. `workers.dev` and preview URLs are off.
- **No demo data.** The app starts empty and asks for each child's basics once.
- **No AI and no external calls with health data.** Briefs and patterns are deterministic rules, labelled "system pattern".

## Code layout
```
src/core/       auth (Access JWT), ids, hashing, America/Toronto time, upload checks
src/medical/    corrected age, quick-log parsing, urgent-phrase rules, issue lifecycle
src/storage/    PersonVault Durable Object: records, documents, briefs, cron work
src/index.ts    routing: household vs person, security headers, cron
public/         the web app (no build step)
test/           automated tests (synthetic values inside tests only)
```

## Run locally (empty store)
```bash
npm ci                       # at repo root
cd apps/familyos && cp .dev.vars.example .dev.vars
npm run dev:family           # http://127.0.0.1:8789  household view
npm run dev:callum           # http://127.0.0.1:8787  (second terminal)
npm run dev:finnley          # http://127.0.0.1:8788  (third terminal)
```

## Test
```bash
cd apps/familyos && npm run check   # typecheck + 25 tests + deploy dry-run
```

## Deploy (see blockers in docs/STATUS.md)
```bash
cd apps/familyos
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ALLOWED_EMAILS        # e.g. a@x.com,b@y.com
npx wrangler deploy --var ACCESS_TEAM_DOMAIN:<team>.cloudflareaccess.com
```
Then, from a phone on cellular, open all three sites. You should get the sign-in, then the empty setup screens.
