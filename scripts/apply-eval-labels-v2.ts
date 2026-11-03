// Imports the hand labels of test-v2 (data/eval-v2-labels-claude.tsv, outside git) into cases.json and, with
// --freeze, freezes the set (>= 60 applicable for Colombia) or marks it provisional (D2) when every case is labelled.
// Usage: npx tsx scripts/apply-eval-labels-v2.ts [--freeze] [YYYY-MM-DD]
import { readFileSync, writeFileSync } from "node:fs";
import {
  applyLabelRows,
  freezeSummary,
  parseLabelRows,
  type CasesFileLike,
} from "../packages/core/evals/labels-v2.js";

const CASES = "packages/core/evals/eligibility/cases.json";
const labelsArg = process.argv.indexOf("--labels");
const LABELS = labelsArg > 0 ? (process.argv[labelsArg + 1] as string) : "data/eval-v2-labels-claude.tsv";
const freeze = process.argv.includes("--freeze");
const date = process.argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? new Date().toISOString().slice(0, 10);

const data = JSON.parse(readFileSync(CASES, "utf8")) as CasesFileLike;
const rows = parseLabelRows(readFileSync(LABELS, "utf8"));
console.log(`applied ${applyLabelRows(data, rows, date)} labels`);

const summary = freezeSummary(data);
console.log(JSON.stringify(summary, null, 1));
if (freeze) {
  if (summary.status === "incomplete") throw new Error(`${summary.pending} cases are still pending; label them first.`);
  data.testSet = {
    ...data.testSet,
    status: summary.status,
    frozenAt: date,
    applicableCO: summary.applicableCO,
    cases: summary.total,
    perCompany: summary.perCompany,
    ...(summary.status === "provisional" ? { missingForTarget: summary.missingForTarget } : {}),
  };
  console.log(`test-v2 ${summary.status}: ${summary.applicableCO} applicable for CO`);
}
writeFileSync(CASES, JSON.stringify(data, null, 2).replace(/\n/g, "\r\n") + "\r\n");
