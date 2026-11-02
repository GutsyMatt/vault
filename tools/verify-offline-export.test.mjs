import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { audit } from "./verify-offline-export.mjs";
async function fixture(data = "synthetic evidence") {
  const dir = await mkdtemp(join(tmpdir(), "familyos-export-"));
  const originals = join(dir, "originals"); await mkdir(originals);
  const doc = { id: "sample_01", size: Buffer.byteLength(data),
    sha256: createHash("sha256").update(data).digest("hex") };
  const file = join(dir, "export.json");
  const save = docs => writeFile(file, JSON.stringify({
    format: "familyos-person-export/v1", tables: { documents: docs, photos: [] }
  }));
  await save([doc]);
  return { file, originals, doc, save, data };
}
test("valid source passes; full backup remains false", async () => {
  const f = await fixture(); await writeFile(join(f.originals, f.doc.id), f.data);
  const result = await audit(f.file, f.originals);
  assert.equal(result.verified, 1);
  assert.equal(result.full_portable_backup, false);
});
test("missing evidence fails", async () => {
  const f = await fixture();
  const result = await audit(f.file, f.originals);
  assert.equal(result.evidence_complete, false);
  assert.equal(result.missing, 1);
});
test("tampered evidence fails", async () => {
  const f = await fixture(); await writeFile(join(f.originals, f.doc.id), "tampered");
  assert.equal((await audit(f.file, f.originals)).mismatch, 1);
});
test("path traversal IDs rejected", async () => {
  const f = await fixture(); await f.save([{ ...f.doc, id: "../escape" }]);
  await assert.rejects(audit(f.file, f.originals), /Invalid/);
});
test("duplicate IDs rejected", async () => {
  const f = await fixture(); await f.save([f.doc, f.doc]);
  await assert.rejects(audit(f.file, f.originals), /duplicate/);
});
