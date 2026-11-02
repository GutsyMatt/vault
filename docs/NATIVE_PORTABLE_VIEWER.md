# Existing FamilyOS offline viewer — native binary build

The existing `tools/offline-viewer.mjs` viewer now has a Node SEA native build pipeline for Windows x64, macOS Intel and macOS Apple Silicon. The build jobs are in `.github/workflows/familyos-native-viewer.yml`. Each produces an executable without requiring Node on the destination computer.

**Not yet a complete USB FamilyOS**: this is a read-only snapshot viewer for the existing `familyos-person-export/v1` export and original files. Use an encrypted `.fosbkp` archive with a passphrase supplied via `FAMILYOS_ARCHIVE_PASSWORD`. This environment-variable method can expose secrets to the OS/session; review alternatives before handling private medical data. A live cloud-to-local backup, offline writes, full restore and sync do not yet exist. On macOS, unsigned/notarized distribution may trigger Gatekeeper; ad hoc signing in CI is not notarization.

On clean devices, test actual binary startup, encrypted archive unlock, localhost read-only UI, integrity failure, safe eject/reinsert, privacy and recovery. A CI smoke test with invalid synthetic input does not establish these full acceptance requirements.
