// Validates a QC batch TSV: header, ids = the batch, valid labels, evidence literal in the posting (or verified metadata).
// Usage: npx tsx scripts/validate-qc-batch.ts data/eval-qc-batches/qc-01   (reads qc-01.ids and qc-01.labels.tsv)
import { readFileSync } from "node:fs";
import { verifyEvidence } from "../packages/core/evals/evidence.js";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";
import { ELIGIBILITY_LABELS } from "../packages/core/src/index.js";

export const QC_COLUMNS = [
  "id",
  "decision",
  "label",
  "countries",
  "workModel",
  "workModelConflict",
  "travelRequirement",
  "evidence",
  "note",
];
const base = process.argv[2];
if (!base) throw new Error("usage: validate-qc-batch.ts <batch path without extension>");
const ids = readFileSync(`${base}.ids`, "utf8").split(/\r?\n/).filter(Boolean);
const lines = readFileSync(`${base}.labels.tsv`, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "");
if ((lines[0] ?? "").split("\t").join(",") !== QC_COLUMNS.join(",")) {
  throw new Error(`Header must be: ${QC_COLUMNS.join("<TAB>")}`);
}
const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as { cases: EvalCase[] };
const problems: string[] = [];
const seen = new Set<string>();
for (const [n, line] of lines.slice(1).entries()) {
  const c = line.split("\t");
  const [id = "", decision = "", label = "", countries = "", wm = "", , , evidence = ""] = c;
  const where = `row ${n + 2} (${id.slice(0, 30)})`;
  if (c.length < 8) problems.push(`${where}: expected 9 columns`);
  if (!ids.includes(id)) problems.push(`${where}: id not in the batch`);
  seen.add(id);
  if (!["confirm", "change"].includes(decision)) problems.push(`${where}: decision must be confirm or change`);
  if (!(ELIGIBILITY_LABELS as readonly string[]).includes(label)) problems.push(`${where}: bad label`);
  if (!["remote", "hybrid", "onsite", "unknown"].includes(wm)) problems.push(`${where}: bad workModel`);
  for (const k of countries === "" ? [] : countries.split(","))
    if (!/^[A-Z]{2}$/.test(k)) problems.push(`${where}: bad country ${k}`);
  if ((label === "latam_eligible" || label === "worldwide") && wm !== "remote")
    problems.push(`${where}: ${label} needs workModel remote`);
  const item = all.cases.find((x) => x.id === id);
  if (item) {
    const verdict = verifyEvidence(evidence, loadJob(item));
    if (verdict === "fail_missing" || verdict === "fail_unverified")
      problems.push(
        `${where}: evidence is not literal in the posting (title, location or body). Quote exact words, or use the metadata form 'LOCATION: ...; ATS_WORKPLACE_TYPE: ...'`,
      );
  }
}
for (const id of ids) if (!seen.has(id)) problems.push(`missing row for ${id}`);
if (problems.length > 0) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log(`OK ${lines.length - 1} rows; changes=${lines.slice(1).filter((l) => l.split("\t")[1] === "change").length}`);
