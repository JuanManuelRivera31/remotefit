// Prints test-v2 postings for hand labelling (by Claude, never by Gemini): the FULL body, except that paragraphs
// shared by several postings of the same company (legal text, benefits...) are printed once per company and then
// marked [boilerplate]. Nothing is skipped without having been printed once.
// Usage: npx tsx scripts/print-test-v2.ts <start> <count>   (indexes over pending cases sorted by company, id)
//        npx tsx scripts/print-test-v2.ts --stats
// Progress (which companies' boilerplate was already shown) lives in data/eval-v2-seen.json (outside git).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";

const CASES = "packages/core/evals/eligibility/cases.json";
const SEEN = "data/eval-v2-seen.json";
const LABELS = "data/eval-v2-labels-claude.tsv";
const MIN_BOILERPLATE_CHARS = 80;

const all = JSON.parse(readFileSync(CASES, "utf8")) as { cases: (EvalCase & { labelStatus: string })[] };
const labelled = new Set(
  existsSync(LABELS)
    ? readFileSync(LABELS, "utf8").split(/\r?\n/).slice(1).map((line) => line.split("\t")[0] ?? "").filter(Boolean)
    : [],
);
const testCases = all.cases
  .filter((item) => item.split === "test" && !labelled.has(item.id))
  .sort((a, b) => a.board.localeCompare(b.board) || a.id.localeCompare(b.id));
const allTest = all.cases.filter((item) => item.split === "test");

const norm = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
const paragraphs = (text: string): string[] =>
  text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);

// Boilerplate = a paragraph (>= 80 chars) that appears in at least 2 postings of the same company's test-v2 cases.
const jobs = new Map(allTest.map((item) => [item.id, loadJob(item)]));
const boilerplate = new Map<string, Set<string>>();
for (const board of new Set(allTest.map((item) => item.board))) {
  const counts = new Map<string, number>();
  for (const item of allTest.filter((c) => c.board === board)) {
    const seen = new Set(paragraphs(jobs.get(item.id)?.descriptionText ?? "").map(norm));
    for (const p of seen) if (p.length >= MIN_BOILERPLATE_CHARS) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  boilerplate.set(board, new Set([...counts].filter(([, n]) => n >= 2).map(([p]) => p)));
}

if (process.argv[2] === "--stats") {
  let full = 0;
  let deduped = 0;
  for (const item of allTest) {
    const text = jobs.get(item.id)?.descriptionText ?? "";
    full += text.length;
    const bp = boilerplate.get(item.board) ?? new Set();
    deduped += paragraphs(text).filter((p) => !bp.has(norm(p))).join("\n").length;
  }
  const preamble = [...boilerplate.values()].reduce((s, set) => s + [...set].reduce((n, p) => n + p.length, 0), 0);
  console.log(`test-v2 cases ${allTest.length} | still unlabelled ${testCases.length}`);
  console.log(`full body chars ${full} (~${Math.round(full / 4)} tokens) | deduped ${deduped} + preambles ${preamble} (~${Math.round((deduped + preamble) / 4)} tokens)`);
  process.exit(0);
}

const start = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 10);
const seen: Record<string, boolean> = existsSync(SEEN) ? (JSON.parse(readFileSync(SEEN, "utf8")) as Record<string, boolean>) : {};

for (const item of testCases.slice(start, start + count)) {
  const job = jobs.get(item.id);
  if (!job) throw new Error("missing job " + item.id);
  const bp = boilerplate.get(item.board) ?? new Set();
  if (!seen[item.board] && bp.size > 0) {
    console.log(`\n######## COMPANY PREAMBLE (${item.board}): paragraphs shared by several postings, shown once ########`);
    const printed = new Set<string>();
    for (const p of paragraphs(jobs.get(testCases.find((c) => c.board === item.board)?.id ?? item.id)?.descriptionText ?? "")) {
      if (bp.has(norm(p)) && !printed.has(norm(p))) {
        printed.add(norm(p));
        console.log(p);
      }
    }
    seen[item.board] = true;
  }
  console.log(`\n==== ${item.id} [${item.subtype}]`);
  console.log(`TITLE: ${job.title}\nLOCATION: ${job.locationRaw}\nATS_WORKPLACE_TYPE: ${job.workplaceType ?? "(none)"}`);
  const own = paragraphs(job.descriptionText);
  const kept = own.filter((p) => !bp.has(norm(p)));
  console.log(kept.join("\n"));
  if (kept.length < own.length) console.log(`[boilerplate: ${own.length - kept.length} shared paragraphs of ${item.board} omitted here, shown in the company preamble]`);
}
writeFileSync(SEEN, JSON.stringify(seen, null, 1));
