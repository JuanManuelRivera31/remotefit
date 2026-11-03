// Label quality control (no LLM): does the evidence of each labelled case appear LITERALLY in its posting?
// Quoted segments must appear in title + location + body; metadata-style evidence is checked against the structured fields.
// Usage: npx tsx scripts/check-evidence.ts [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { verifyEvidence } from "../packages/core/evals/evidence.js";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";

type Row = EvalCase & { labelStatus: string; evidence?: string | null };
const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as { cases: Row[] };
const out: { id: string; split: string; label: string; verdict: string; evidence: string }[] = [];
for (const item of all.cases) {
  if (item.labelStatus === "pending") continue;
  out.push({
    id: item.id,
    split: item.split,
    label: item.label,
    verdict: verifyEvidence(item.evidence, loadJob(item)),
    evidence: item.evidence ?? "",
  });
}
const tally: Record<string, Record<string, number>> = {};
for (const r of out) {
  const bucket = (tally[r.split === "test" ? "test-v2" : "dev"] ??= {});
  bucket[r.verdict] = (bucket[r.verdict] ?? 0) + 1;
}
console.log(JSON.stringify(tally));
const i = process.argv.indexOf("--json");
if (i > 0) writeFileSync(process.argv[i + 1] as string, JSON.stringify(out, null, 1));
