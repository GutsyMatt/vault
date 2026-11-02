# FamilyOS source-to-document intake — existing API

A manifest maps existing source IDs and local files to the correct FamilyOS child. It hashes contents before upload and verifies the response returned by the **existing** authenticated /api/documents endpoint. No new database or storage endpoint is introduced.

Manifest: `{"format":"familyos-intake/v1","items":[{"person":"callum","source_id":"drive:<original-file-id>","file":"/private/path/report.pdf","sha256":"<64-character-hex>"}]}`.

Run `node tools/familyos-intake.mjs intake.json receipt.json` for a **strict DRY RUN** (validates/hashes, makes NO network requests). The `ingest()` library accepts an upload callback so a trusted authenticated connector can perform the actual upload, preserving user authorization and audit receipts. Do not embed or commit login cookies or bearer tokens. The CLI intentionally does not bypass Google authentication and cannot upload to production by itself.

**Not implemented:** a real Drive connector, bulk Drive file discovery, completed authorization through the user's account, clinical extraction, actionable second-brain indexing, complete audit history, parent approval, photo import, or background synchronization. No real patient information used in tests. Code must undergo review before merging. Related issue #14 and integrated PR #19.
