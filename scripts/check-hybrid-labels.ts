// Sanity check for hand labels: for every onsite_or_hybrid row, shows whether the FULL body or the ATS metadata supports it.
import { readFileSync } from "node:fs";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";
const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as { cases: EvalCase[] };
const rows = readFileSync("data/eval-v2-labels-claude.tsv", "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split("\t"));
for (const r of rows.filter((x) => x[1] === "onsite_or_hybrid")) {
  const item = all.cases.find((c) => c.id === r[0]);
  if (!item) continue;
  const job = loadJob(item);
  const m = job.descriptionText.match(/[^.\n]*\b(hybrid|on-?site|in-office|in the office|in-person|office)\b[^.\n]*/gi) ?? [];
  console.log(`${r[0]} | wm=${r[3]} | ats=${job.workplaceType ?? "-"} | title=${job.title.slice(0, 60)} | bodyHits=${m.length}${m[0] ? " :: " + m[0].trim().slice(0, 110) : ""}`);
}
