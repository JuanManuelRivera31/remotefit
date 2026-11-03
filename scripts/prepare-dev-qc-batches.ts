// Batches for the evidence QC of the development split (cases whose stored evidence is missing or not literal in the body).
// Each batch file shows the CURRENT label next to the full posting so a labeller (Claude, never Gemini) can confirm it or change it.
// Usage: npx tsx scripts/check-evidence.ts --json data/eval-evidence-qc.json && npx tsx scripts/prepare-dev-qc-batches.ts [perBatch=14]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";

type Row = EvalCase & { labelStatus: string; evidence?: string | null; workModelConflict?: boolean; travelRequirement?: string };
const OUT = "data/eval-qc-batches";
const per = Number(process.argv[2] ?? 14);
const MIN = 80;
const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as { cases: Row[] };
const qc = JSON.parse(readFileSync("data/eval-evidence-qc.json", "utf8")) as { id: string; split: string; verdict: string }[];
const failing = new Set(qc.filter((r) => r.split === "dev" && r.verdict.startsWith("fail")).map((r) => r.id));
const items = all.cases.filter((c) => failing.has(c.id)).sort((a, b) => a.board.localeCompare(b.board) || a.id.localeCompare(b.id));

const norm = (t: string): string => t.replace(/\s+/g, " ").trim().toLowerCase();
const paragraphs = (t: string): string[] => t.split(/\n+/).map((p) => p.trim()).filter(Boolean);
const jobs = new Map(items.map((c) => [c.id, loadJob(c)]));
const boiler = new Map<string, Set<string>>();
for (const board of new Set(items.map((c) => c.board))) {
  const counts = new Map<string, number>();
  for (const c of items.filter((x) => x.board === board)) {
    for (const p of new Set(paragraphs(jobs.get(c.id)?.descriptionText ?? "").map(norm))) if (p.length >= MIN) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  boiler.set(board, new Set([...counts].filter(([, n]) => n >= 2).map(([p]) => p)));
}
mkdirSync(OUT, { recursive: true });
for (let b = 0; b * per < items.length; b += 1) {
  const slice = items.slice(b * per, (b + 1) * per);
  const lines: string[] = [];
  const shown = new Set<string>();
  for (const c of slice) {
    const job = jobs.get(c.id);
    if (!job) continue;
    const bp = boiler.get(c.board) ?? new Set<string>();
    if (!shown.has(c.board) && bp.size > 0) {
      shown.add(c.board);
      lines.push(`\n######## COMPANY PREAMBLE (${c.board}): paragraphs shared by several postings, shown once in this batch ########`);
      const printed = new Set<string>();
      for (const p of paragraphs(jobs.get(items.find((x) => x.board === c.board)?.id ?? c.id)?.descriptionText ?? "")) {
        if (bp.has(norm(p)) && !printed.has(norm(p))) { printed.add(norm(p)); lines.push(p); }
      }
    }
    lines.push(`\n==== ${c.id}`);
    lines.push(`CURRENT LABEL: ${c.label} | countries=[${(c.countries ?? []).join(",")}] | workModel=${c.workModel} | conflict=${c.workModelConflict ?? false} | status=${c.labelStatus}`);
    lines.push(`CURRENT EVIDENCE: ${c.evidence ?? "(none)"}`);
    lines.push(`TITLE: ${job.title}\nLOCATION: ${job.locationRaw}\nATS_WORKPLACE_TYPE: ${job.workplaceType ?? "(none)"}`);
    const own = paragraphs(job.descriptionText);
    lines.push(own.filter((p) => !bp.has(norm(p))).join("\n"));
    if (own.some((p) => bp.has(norm(p)))) lines.push(`[boilerplate omitted here, see the company preamble]`);
  }
  const name = `qc-${String(b + 1).padStart(2, "0")}`;
  writeFileSync(`${OUT}/${name}.txt`, lines.join("\n") + "\n");
  writeFileSync(`${OUT}/${name}.ids`, slice.map((c) => c.id).join("\n") + "\n");
  console.log(name, slice.length, [...new Set(slice.map((c) => c.board))].join(","));
}
