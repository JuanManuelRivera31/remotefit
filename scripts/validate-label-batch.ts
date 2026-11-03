// Checks a hand-label batch TSV against its id list: valid rows (same rules as the importer), exactly the ids of the batch
// and evidence that is a LITERAL quote of the title, location or body (or the verified metadata form).
// Usage: npx tsx scripts/validate-label-batch.ts data/eval-v3-batches/batch-01
import { readFileSync } from "node:fs";
import { verifyEvidence } from "../packages/core/evals/evidence.js";
import { parseLabelRows } from "../packages/core/evals/labels-v2.js";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";

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
const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as { cases: EvalCase[] };
const notLiteral = rows.filter((row) => {
  const item = all.cases.find((c) => c.id === row.id);
  if (!item) return false;
  const verdict = verifyEvidence(row.evidence, loadJob(item));
  return verdict === "fail_missing" || verdict === "fail_unverified";
});
if (notLiteral.length > 0) {
  console.log(
    notLiteral
      .map(
        (r) =>
          `evidence is not literal in the posting for ${r.id}: quote exact words from the title, location or body, or use the form 'LOCATION: ...; ATS_WORKPLACE_TYPE: ...'`,
      )
      .join("\n"),
  );
  process.exit(1);
}
console.log(`OK ${rows.length} rows; needsOwner=${rows.filter((r) => r.needsOwner).length}`);
