# Google Drive → existing FamilyOS automatic ingestion

## Implemented
The existing FamilyOS Cloudflare Worker now has an optional cron-driven Google Drive folder reader in `apps/familyos/src/connectors/drive-sync.ts`. It uses the EXISTING `PersonVault` evidence storage and SHA-256 deduplication, with a per-person `drive_imports` receipt ledger (source file ID, revision, SHA-256, document ID, timestamp). It does NOT create another application or database. The runtime fetches a Google OAuth access token using a stored refresh token, lists up to 30 items per configured folder, accepts only supported non-executable files ≤20 MB, and imports them as `EXTRACTED` (not clinically verified). New/changed revisions are tracked. The existing scheduled handler invokes it only when explicitly enabled.

## Required authorization / rollout

1. In the existing LifeOS Google Cloud project, provision *offline-access* OAuth consent for a dedicated Google Workspace identity and grant minimal **Drive read-only scope** (`https://www.googleapis.com/auth/drive.readonly`). A refresh token must be issued through a user-approved OAuth authorization flow. Never paste tokens in the GitHub repository or issues.
2. Configure Cloudflare Worker secrets `DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`, `DRIVE_REFRESH_TOKEN` using Cloudflare's secret manager (not `wrangler.jsonc`).
3. Configure non-secret `DRIVE_FOLDER_PERSON_MAP` as JSON with explicit authorized folder IDs only, for example `{"callum":"<Drive folder ID>","finnley":"<Drive folder ID>"}`. Do NOT set arbitrary whole-Drive/root queries. Confirm Drive sharing/access and identity mapping against real records before enabling.
4. Keep `DRIVE_SYNC_ENABLED` absent/false until reviewed and tested. Turn on only after deploy validation and a rollback plan; disabling it stops the scheduled Drive calls.
5. Confirm `drive.sync` telemetry in Worker logs, verify person isolation and source receipts, and compare imported originals to primary-source checksums.

## Bounds and unresolved blockers
- **This code has not been deployed to production.** OAuth credentials and folder authorization are not configured or verified, so no real Google Drive records have been imported.
- The first 30 newest files in each authorized folder are scanned each cron invocation. No recursive traversal, pagination beyond first page, or automatic Google Docs/Sheets exports yet. Large folders require a cursor/indexing design.
- Google Workspace-native Docs/Sheets and unsupported binary types are skipped. No interpretation, clinical assertion, automatic task creation, or evidence promotion.
- Folder attribution must be human-approved before enabling. A misfiled clinical document could otherwise be assigned to the wrong person.
- Failed items produce error counts. Source-health integration, durable failure details and alerting remain to be implemented. Do not present background monitoring as operational without these.
- Repeated imports of unchanged source revisions should be skipped by the `drive_imports` receipt. Server SHA-256 deduplication is an additional safeguard.
- Cloudflare Durable Object copies are not an offline backup. Separate export/restore and portability gates remain open.

Run existing repo checks with `npm ci && npm run check`. Use the included synthetic `drive-sync.test.ts` to test disabled mode, file type restrictions, read-only listing, and correct person-specific ingestion.
