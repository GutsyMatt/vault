# FamilyOS offline snapshot viewer

Read-only local viewer of the **existing** `familyos-person-export/v1` data contract. This does not replace the Cloudflare app. Put `export.json` and `originals/<document-id>` inside a trusted private directory, each downloaded through the currently authenticated FamilyOS APIs. On Windows/macOS/Linux with Node.js 22 installed: `node tools/offline-viewer.mjs path/to/snapshot`; open the localhost URL printed. Original documents are checked against their exported SHA-256 and size on every download; corrupted originals are not served. Run `node --test tools/offline-viewer.test.mjs`.

This is NOT a production secure offline client: exports are plaintext on disk, URL-token access is not multi-user authentication, no restore or sync, no photos, no native executable, no device-independent USB test. Use synthetic or securely stored development data only. Do not commit patient records. PR requires security review before merging.

## Open an encrypted archive without extracting files

Set `FAMILYOS_ARCHIVE_PASSWORD` as an environment variable locally, then run `node tools/offline-viewer.mjs /path/to/vault.fosbkp`. The archive is decrypted into process memory and its original evidence is SHA-256 checked; it is not expanded into plaintext files. Do not expose the localhost URL, and exit the process when finished. This does NOT protect against an attacker with access to the running computer, process memory, or an unlocked user session. Node 22 remains required; no native USB executable or cloud sync is provided.
