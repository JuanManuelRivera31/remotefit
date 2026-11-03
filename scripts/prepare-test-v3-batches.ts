// Splits the pending test-v3 cases into self-contained batches for parallel hand labelling (by Claude subagents,
// never by Gemini). Each batch file holds the full bodies; paragraphs shared by several postings of the same company
// are printed once as that company's preamble inside the batch. Output: data/eval-v3-batches/batch-NN.txt (outside git).
// Usage: npx tsx scripts/prepare-test-v3-batches.ts [casesPerBatch=13]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";

const CASES = "packages/core/evals/eligibility/cases.json";
const OUT = "data/eval-v3-batches";
const MIN_BOILERPLATE_CHARS = 80;
const size = Number(process.argv[2] ?? 13);

const all = JSON.parse(readFileSync(CASES, "utf8")) as { cases: (EvalCase & { labelStatus: string })[] };
const testCases = all.cases
  .filter((item) => item.split === "test" && item.labelStatus === "pending")
  .sort((a, b) => a.board.localeCompare(b.board) || a.id.localeCompare(b.id));

const norm = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
const paragraphs = (text: string): string[] => text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);

const jobs = new Map(testCases.map((item) => [item.id, loadJob(item)]));
const boilerplate = new Map<string, Set<string>>();
for (const board of new Set(testCases.map((item) => item.board))) {
  const counts = new Map<string, number>();
  for (const item of testCases.filter((c) => c.board === board)) {
    const seen = new Set(paragraphs(jobs.get(item.id)?.descriptionText ?? "").map(norm));
    for (const p of seen) if (p.length >= MIN_BOILERPLATE_CHARS) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  boilerplate.set(board, new Set([...counts].filter(([, n]) => n >= 2).map(([p]) => p)));
}

mkdirSync(OUT, { recursive: true });
const batchCount = Math.ceil(testCases.length / size);
for (let b = 0; b < batchCount; b += 1) {
  const items = testCases.slice(b * size, (b + 1) * size);
  const lines: string[] = [];
  const preambleShown = new Set<string>();
  for (const item of items) {
    const job = jobs.get(item.id);
    if (!job) throw new Error("missing job " + item.id);
    const bp = boilerplate.get(item.board) ?? new Set<string>();
    if (!preambleShown.has(item.board) && bp.size > 0) {
      preambleShown.add(item.board);
      lines.push(`\n######## COMPANY PREAMBLE (${item.board}): paragraphs shared by several postings, shown once in this batch ########`);
      const printed = new Set<string>();
      for (const p of paragraphs(jobs.get(testCases.find((c) => c.board === item.board)?.id ?? item.id)?.descriptionText ?? "")) {
        if (bp.has(norm(p)) && !printed.has(norm(p))) {
          printed.add(norm(p));
          lines.push(p);
        }
      }
    }
    lines.push(`\n==== ${item.id}`);
    lines.push(`TITLE: ${job.title}\nLOCATION: ${job.locationRaw}\nATS_WORKPLACE_TYPE: ${job.workplaceType ?? "(none)"}`);
    const own = paragraphs(job.descriptionText);
    const kept = own.filter((p) => !bp.has(norm(p)));
    lines.push(kept.join("\n"));
    if (kept.length < own.length) lines.push(`[boilerplate: ${own.length - kept.length} shared paragraphs of ${item.board} omitted here, see the company preamble]`);
  }
  const name = `batch-${String(b + 1).padStart(2, "0")}`;
  writeFileSync(`${OUT}/${name}.txt`, lines.join("\n") + "\n");
  writeFileSync(`${OUT}/${name}.ids`, items.map((i) => i.id).join("\n") + "\n");
  console.log(`${name}: ${items.length} cases, ${items.map((i) => i.board).filter((v, i, a) => a.indexOf(v) === i).join(",")}`);
}
