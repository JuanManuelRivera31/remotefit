// Prints a case's current label and its full posting text. Usage: npx tsx scripts/show-case.ts <id substring>...
import { readFileSync } from "node:fs";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";

const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as { cases: EvalCase[] };
for (const needle of process.argv.slice(2)) {
  for (const item of all.cases.filter((c) => c.id.includes(needle))) {
    const job = loadJob(item);
    console.log(`\n==== ${item.id} | label=${item.label} countries=${(item.countries ?? []).join(",")} wm=${item.workModel}`);
    console.log(`TITLE: ${job.title}\nLOCATION: ${job.locationRaw}\nWORKPLACE: ${job.workplaceType ?? "(none)"}\n${job.descriptionText}`);
  }
}
