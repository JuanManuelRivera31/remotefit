// Safety net for hand labels: for every case labelled APPLICABLE for Colombia, list the sentences of the FULL body that look
// like a residence / work-authorization / region restriction, so a human can confirm the label did not miss one (the label
// batches omit paragraphs shared by the company, which a labeller may not have seen).
// Usage: npx tsx scripts/scan-applicable-restrictions.ts <labels.tsv>
import { readFileSync } from "node:fs";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";
import { isApplicable } from "../packages/core/src/index.js";
import { parseLabelRows } from "../packages/core/evals/labels-v2.js";

const file = process.argv[2];
if (!file) throw new Error("usage: scan-applicable-restrictions.ts <labels.tsv>");
const rows = parseLabelRows(readFileSync(file, "utf8"));
const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as { cases: EvalCase[] };
const FLAG =
  /\b(must|need to|required to|have to)\s+(reside|live in|be located|be based|be a resident)|authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|\bcitizen|permanent resident|visa sponsorship|based in (the )?(united states|us|usa|u\.s\.|europe|emea|uk|canada)|\b(us|u\.s\.|european|eu)[- ]based|\beast(ern)? (coast|time)|\b(est|pst|cet|gmt|utc)\b|hours? overlap|overlap with|only (open|available) to|not (open|available) (to|for)|except in|candidates (located|based|residing)|\bresid(e|ing|ent)s? (in|of)/i;
let flagged = 0;
for (const row of rows) {
  const applicable = isApplicable(
    { label: row.label, workModel: row.workModel, countries: row.countries, excludedCountries: [] },
    "CO",
  );
  if (!applicable) continue;
  const item = all.cases.find((c) => c.id === row.id);
  if (!item) continue;
  const job = loadJob(item);
  const hits = job.descriptionText
    .split(/\n+|(?<=[.!?])\s+/)
    .filter((s) => FLAG.test(s))
    .map((s) => s.trim().slice(0, 190));
  if (hits.length === 0) continue;
  flagged += 1;
  console.log(`\n${row.id} | ${row.label} [${row.countries}] | ${job.title.slice(0, 50)}`);
  for (const h of [...new Set(hits)].slice(0, 4)) console.log(`   - ${h}`);
}
console.log(`\n${flagged} applicable cases with restriction-like sentences`);
