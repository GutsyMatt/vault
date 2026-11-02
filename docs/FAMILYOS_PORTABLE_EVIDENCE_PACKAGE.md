# FamilyOS portable evidence package — scoped implementation
This extends the existing FamilyOS export format, not a replacement app.

Precondition: obtain a per-person `GET /api/export` JSON and every original via the existing authenticated `GET /api/documents/:id/raw`, saved locally under `originals/<document-id>`. Never commit these files.

Node 22 (Windows, macOS or Linux), with a local environment variable `FAMILYOS_ARCHIVE_PASSWORD` holding a 12+ character passphrase:
```
node tools/familyos-portable-archive.mjs pack export.json originals vault.fosbkp
node tools/familyos-portable-archive.mjs unpack vault.fosbkp newly-created-folder
node --test tools/familyos-portable-archive.test.mjs
```

The format uses scrypt + AES-256-GCM and validates each original against exported SHA-256 and size before writing the encrypted package and after decrypting it. It rejects overwriting archives and existing destination folders. The archive must be handled as sensitive; test with synthetic data until independent security review.

**Not a full backup or USB app.** Photos are not exported, database restore is not implemented, this implementation loads up to 256 MB in memory, and Node is required on the destination device. No automated authenticated bulk download exists. Cloudflare Durable Objects do not run offline. Missing original bytes cause an error rather than a falsely successful package. A user's export and its evidence remain private.
