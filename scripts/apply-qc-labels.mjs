// Applies the evidence QC of the development split (data/eval-qc-batches/qc-*.labels.tsv, outside git) to cases.json.
// The decision is computed by diffing, not trusted: a row changes the label only if label / countries / workModel /
// workModelConflict really differ from the stored case. Every changed case keeps relabeledFrom (first change) or
// relabelHistory (later ones); every case gets the literal evidence. Dev split only.
// Usage: node scripts/apply-qc-labels.mjs [--dry-run]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const P = "packages/core/evals/eligibility/cases.json";
const DIR = "data/eval-qc-batches";
const date = "2026-11-03";
const dry = process.argv.includes("--dry-run");
const raw = readFileSync(P, "utf8");
const crlf = raw.includes("\r\n");
const data = JSON.parse(raw);

const snap = (c) => ({
  label: c.label,
  workModel: c.workModel,
  countries: c.countries,
  workModelConflict: c.workModelConflict ?? false,
  evidence: c.evidence ?? null,
  travelRequirement: c.travelRequirement ?? null,
  labelStatus: c.labelStatus,
});
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// Owner decisions that the QC must not undo: Canals US roles stay workModel unknown (ADR 0004, Canals revert of 2026-11-03).
const KEEP_WORK_MODEL = new Set(["ashby:canals:195c6203-ec1d-49e5-a9d0-e17f81832b6d", "ashby:canals:d4b698c6-95f6-4d91-913e-54d0cd765c82"]);

const report = { rows: 0, evidenceOnly: 0, changed: [], ownerReviewedChanged: [] };
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".labels.tsv")).sort()) {
  const lines = readFileSync(`${DIR}/${file}`, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const [id, , label, countries, , conflict, travel, evidence, note] = cells;
    let workModel = cells[4];
    const c = data.cases.find((x) => x.id === id);
    if (!c) throw new Error("unknown case " + id);
    if (c.split !== "dev") throw new Error("not a dev case: " + id);
    report.rows += 1;
    if (KEEP_WORK_MODEL.has(id)) workModel = c.workModel;
    const list = countries ? countries.split(",") : [];
    const differs =
      c.label !== label ||
      !same(c.countries ?? [], list) ||
      c.workModel !== workModel ||
      (c.workModelConflict ?? false) !== (conflict === "yes");
    const before = snap(c);
    if (differs) {
      if (c.relabeledFrom) (c.relabelHistory ??= []).push({ ...before, relabelRule: c.relabelRule, relabeledAt: c.relabeledAt });
      else c.relabeledFrom = before;
      c.label = label;
      c.countries = list;
      c.workModel = workModel;
      c.workModelConflict = conflict === "yes";
      c.relabelRule = "evidence_qc";
      c.relabeledAt = date;
      c.relabelNote = note;
      report.changed.push(`${id} | ${before.label}[${before.countries}]/${before.workModel} -> ${label}[${list}]/${workModel} | status ${before.labelStatus} | ${note}`);
      if (/owner/.test(before.labelStatus)) report.ownerReviewedChanged.push(id);
    } else report.evidenceOnly += 1;
    if (!c.evidenceBeforeQc && c.evidence) c.evidenceBeforeQc = c.evidence;
    c.evidence = evidence;
    c.evidenceCheckedAt = date;
    if (travel) c.travelRequirement = travel;
  }
}
console.log(JSON.stringify({ rows: report.rows, evidenceOnly: report.evidenceOnly, changed: report.changed.length, ownerReviewedChanged: report.ownerReviewedChanged }, null, 1));
for (const line of report.changed) console.log(" -", line);
if (!dry) {
  data.devLabelRevision.revisions.push({
    date,
    decidedBy: "owner (rule) + Claude (reading each body)",
    scope: "development split: evidence QC (cases whose evidence was missing or not literal in the posting)",
    rules: ["Evidence must be a literal quote of the title, location or body (or verified metadata form).", "ADR 0004 guide rule 6 (remote-first with periodic travel is remote; hybrid = regular weekly presence)."],
    changedCases: report.changed.length,
    evidenceFixed: report.rows,
  });
  writeFileSync(P, JSON.stringify(data, null, 2).replace(/\n/g, crlf ? "\r\n" : "\n") + (raw.endsWith("\n") ? (crlf ? "\r\n" : "\n") : ""));
}
