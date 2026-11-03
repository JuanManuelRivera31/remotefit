// Checks a hand-label batch TSV against its id list: valid rows (same rules as the importer) and exactly the ids of the batch.
// Usage: npx tsx scripts/validate-label-batch.ts data/eval-v2-batches/batch-01
import { readFileSync } from "node:fs";
import { parseLabelRows } from "../packages/core/evals/labels-v2.js";

const base = process.argv[2];
if (!base) throw new Error("usage: validate-label-batch.ts <batch path without extension>");
const expected = readFileSync(`${base}.ids`, "utf8").split(/\r?\n/).filter(Boolean);
const rows = parseLabelRows(readFileSync(`${base}.labels.tsv`, "utf8"));
const got = new Set(rows.map((r) => r.id));
const missing = expected.filter((id) => !got.has(id));
const extra = [...got].filter((id) => !expected.includes(id));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(`missing: ${missing.join(", ") || "none"} | unexpected: ${extra.join(", ") || "none"}`);
}
console.log(`OK ${rows.length} rows; needsOwner=${rows.filter((r) => r.needsOwner).length}`);
