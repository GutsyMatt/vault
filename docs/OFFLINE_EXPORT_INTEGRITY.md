# Evidence export integrity verification (offline; Windows/macOS/Linux)

This utility is part of the EXISTING `LibbyHD/vault` repository. It is **not** another FamilyOS app. It audits the already-supported `GET /api/export` format (`familyos-person-export/v1`) and separately downloaded original documents.

## Procedure

1. Authenticate to the existing child portal; export that **one person's** JSON to `export.json`. Do not post it to GitHub or an issue.
2. Obtain all originals through the existing authenticated `GET /api/documents/:id/raw` route. Put them into `originals/`, named by each **document ID**, not original filename.
3. Disconnect from the network and run:

```sh
node tools/verify-offline-export.mjs export.json originals/ audit.json
node --test tools/verify-offline-export.test.mjs
```

Exit 0 means all document records in this export match the downloaded originals; exit 1 means a missing or mismatched original; exit 2 means malformed input or another error. It never claims a full backup, because existing exports omit photo bytes and no restore path exists. It refuses to overwrite an existing report.

**Privacy:** Export JSON, originals, and audit output can contain private medical details. Keep them on encrypted storage. Never commit them. This is an integrity audit, **not encryption**, offline login, an installer, or a recovery implementation.

## Remaining acceptance gates

- Add a single authenticated export of original evidence (not only JSON).
- Include and verify photo bytes/metadata.
- Specify schema versions, data ownership, encryption, consent, keys and recovery.
- Build a real local offline browser/data runtime and restore importer.
- Validate offline on clean Windows x64, macOS Intel and macOS Apple Silicon hosts.

Related: #14. CI on this branch must be rerun and independently reviewed before merge.
