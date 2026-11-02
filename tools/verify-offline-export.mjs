import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

// Audits FamilyOS v1 JSON exports against manually downloaded document originals.
// Does NOT restore data, encrypt data or certify a full portable backup.
export async function audit(exportPath, originalsDir) {
  const raw = await readFile(exportPath);
  const parsed = JSON.parse(raw.toString("utf8"));
  if (parsed.format !== "familyos-person-export/v1" || !Array.isArray(parsed.tables?.documents)) {
    throw new Error("Unsupported export or missing documents table");
  }
  const files = new Set((await readdir(originalsDir, { withFileTypes: true }))
    .filter(x => x.isFile()).map(x => x.name));
  const seen = new Set();
  const documents = [];
  for (const doc of parsed.tables.documents) {
    if (typeof doc.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(doc.id) ||
      typeof doc.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(doc.sha256) || seen.has(doc.id))
      throw new Error("Invalid or duplicate document ID or checksum");
    seen.add(doc.id);
    if (!files.has(doc.id)) {
      documents.push({ id: doc.id, status: "MISSING" });
      continue;
    }
    const data = await readFile(join(originalsDir, doc.id));
    const hash = createHash("sha256").update(data).digest("hex");
    documents.push({ id: doc.id, status: hash.toLowerCase() === doc.sha256.toLowerCase() &&
      data.length === Number(doc.size) ? "VERIFIED" : "MISMATCH" });
  }
  const verified = documents.filter(x => x.status === "VERIFIED").length;
  return {
    format: "familyos-offline-audit/v1", source_format: parsed.format,
    export_sha256: createHash("sha256").update(raw).digest("hex"),
    documents_total: documents.length, verified,
    missing: documents.filter(x => x.status === "MISSING").length,
    mismatch: documents.filter(x => x.status === "MISMATCH").length,
    evidence_complete: verified === documents.length,
    full_portable_backup: false,
    limitations: ["Photo bytes are not audited", "No offline restore capability",
      "Unencrypted input/output must be kept in secure local storage"],
    documents,
  };
}
if (process.argv[1]?.endsWith("verify-offline-export.mjs")) {
  const [, , exportPath, originalsDir, reportPath] = process.argv;
  if (!exportPath || !originalsDir || !reportPath) {
    console.error("Usage: node tools/verify-offline-export.mjs export.json originals-dir report.json");
    process.exitCode = 2;
  } else {
    try {
      const result = await audit(exportPath, originalsDir);
      await writeFile(reportPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      console.log(`Verified ${result.verified}/${result.documents_total}. Full backup: NO.`);
      if (!result.evidence_complete) process.exitCode = 1;
    } catch (e) { console.error(e.message); process.exitCode = 2; }
  }
}
