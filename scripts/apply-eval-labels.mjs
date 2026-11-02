// One-off importer for the LLM-assisted eligibility labels (S7, ADR 0004).
// Reads data/seed-career-ops/eval-labels-claude.tsv (outside git) and writes the final labels into
// packages/core/evals/eligibility/cases.json. Short evidence quotes (<= 20 words) are stored with each label.
// Usage: node scripts/apply-eval-labels.mjs [YYYY-MM-DD]
import { readFile, writeFile } from "node:fs/promises";

const LABELS_TSV = "data/seed-career-ops/eval-labels-claude.tsv";
const CASES = "packages/core/evals/eligibility/cases.json";
const DATE = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const LABELS = new Set(["latam_eligible", "worldwide", "us_only", "country_specific", "onsite_or_hybrid", "unclear"]);
const WORK_MODELS = new Set(["remote", "hybrid", "onsite", "unknown"]);
// Cases the owner reviewed on 2026-11-01 (decisions in docs/progreso.md); labels stay as set by the LLM-assisted pass.
const OWNER_REVIEWED = new Set([
  "greenhouse:sezzle:7906408003",
  "greenhouse:sezzle:7906563003",
  "greenhouse:sezzle:8010090003",
  "greenhouse:planetscale:4251150009",
  "greenhouse:wizeline:7264950",
  "greenhouse:clara:5204916007",
  "greenhouse:clara:5204918007",
  "greenhouse:clara:5236289007",
  "greenhouse:canonical:7267884",
]);

// Remote-first body but with an in-person ramp-up stage: body and workModel disagree (ADR 0004).
const WORK_MODEL_CONFLICT = new Set(["greenhouse:clara:5236289007"]);

const [header, ...lines] = (await readFile(LABELS_TSV, "utf8")).trim().split(/\r?\n/);
const cols = header.split("\t");
const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
const byId = new Map(lines.map((l) => [l.split("\t")[0], l.split("\t")]));

const data = JSON.parse(await readFile(CASES, "utf8"));
if (byId.size !== data.cases.length) throw new Error(`label rows ${byId.size} != cases ${data.cases.length}`);

for (const c of data.cases) {
  const row = byId.get(c.id);
  if (!row) throw new Error(`no label for ${c.id}`);
  const label = row[idx.your_label];
  const workModel = row[idx.workModel];
  const countries = row[idx.countries] ? row[idx.countries].split(",") : [];
  if (!LABELS.has(label)) throw new Error(`bad label ${label} for ${c.id}`);
  if (!WORK_MODELS.has(workModel)) throw new Error(`bad workModel ${workModel} for ${c.id}`);
  if (!countries.every((x) => /^[A-Z]{2}$/.test(x))) throw new Error(`bad countries for ${c.id}`);
  const evidence = row[idx.evidencia] ?? "";
  if (evidence.split(/\s+/).filter(Boolean).length > 24) throw new Error(`evidence too long for ${c.id}`);
  c.label = label;
  c.countries = countries;
  c.workModel = workModel;
  c.evidence = evidence || null;
  c.bodyChecked = row[idx.verificar_cuerpo] === "si";
  c.labelSource = "llm-assisted";
  c.labeledAt = DATE;
  c.labelStatus = OWNER_REVIEWED.has(c.id) ? "owner_reviewed" : "labeled";
  c.workModelConflict = WORK_MODEL_CONFLICT.has(c.id);
}

data.note =
  "Ids and provenance only; posting text lives in data/seed-career-ops/bodies/ (ignored by git, ADR 0002). " +
  "Labels are LLM-assisted (Claude) under rules approved by the project owner (ADR 0004); human review is limited " +
  "to the 9 cases the owner reviewed (labelStatus 'owner_reviewed'). proposedLabel is the original heuristic suggestion, kept for reference.";
await writeFile(CASES, JSON.stringify(data, null, 2) + "\n");

// Colombia-applicable summary (ADR 0004): latam_eligible, worldwide, or country_specific that lists CO.
// ADR 0004 isApplicable for Colombia: workModel must be remote, then the label must allow CO.
const applicable = (c) =>
  c.workModel === "remote" &&
  (c.label === "latam_eligible" || c.label === "worldwide" || (c.label === "country_specific" && c.countries.includes("CO")));
for (const split of ["dev", "test"]) {
  const cs = data.cases.filter((c) => c.split === split);
  console.log(`${split}: ${cs.length} cases, ${cs.filter(applicable).length} applicable for Colombia`);
}
const status = {};
for (const c of data.cases) status[c.labelStatus] = (status[c.labelStatus] ?? 0) + 1;
console.log(status);
