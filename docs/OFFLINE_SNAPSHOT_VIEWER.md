# FamilyOS offline snapshot viewer

Read-only local viewer of the **existing** `familyos-person-export/v1` data contract. This does not replace the Cloudflare app. Put `export.json` and `originals/<document-id>` inside a trusted private directory, each downloaded through the currently authenticated FamilyOS APIs. On Windows/macOS/Linux with Node.js 22 installed: `node tools/offline-viewer.mjs path/to/snapshot`; open the localhost URL printed. Original documents are checked against their exported SHA-256 and size on every download; corrupted originals are not served. Run `node --test tools/offline-viewer.test.mjs`.

This is NOT a production secure offline client: exports are plaintext on disk, URL-token access is not multi-user authentication, no restore or sync, no photos, no native executable, no device-independent USB test. Use synthetic or securely stored development data only. Do not commit patient records. PR requires security review before merging.
