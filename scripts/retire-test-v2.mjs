// Retires test-v2 (ADR 0004 section 6): its 157 cases become development cases (317 in total), flagged retiredFrom, and the
// run that rejected v4 is recorded in retiredTestSets. The test split is left empty until test-v3 is built.
import { readFileSync, writeFileSync } from "node:fs";
const P = "packages/core/evals/eligibility/cases.json";
const raw = readFileSync(P, "utf8");
const crlf = raw.includes("\r\n");
const d = JSON.parse(raw);
const date = "2026-11-03";
const run = d.testSet.runs[0];
let moved = 0;
for (const c of d.cases.filter((x) => x.split === "test")) {
  c.split = "dev";
  c.retiredFrom = "test-v2";
  c.movedToDevAt = date;
  moved += 1;
}
(d.retiredTestSets ??= []).push({
  name: "test-v2",
  frozenAt: d.testSet.frozenAt,
  retiredAt: date,
  cases: moved,
  applicableCO: d.testSet.applicableCO,
  perCompany: d.testSet.perCompany,
  preRunChanges: d.testSet.preRunChanges,
  acceptedRun: {
    date: run.date,
    model: run.model,
    thinkingLevel: "MINIMAL",
    promptVersion: run.promptVersion,
    postprocessVersion: run.postprocessVersion,
    precision: { value: run.precision.value, tp: run.precision.tp, fp: run.precision.fp, ci95Wilson: run.precision.wilson95 },
    recall: { value: run.recall.value, tp: run.recall.tp, fn: run.recall.fn, ci95Wilson: run.recall.wilson95 },
    costPerOfferUsd: 0.001062,
    accepted: false,
  },
  jointReading:
    "test-v1 (v3 + postprocess-v1) and test-v2 (v4 + postprocess-v2), two independent tests, give about 91 % precision and 96 % recall for gemini-3.5-flash-lite. Tuning the prompt raised development but not the test sets.",
  reason:
    "The set was seen by eligibility-v4 (one approved run, precision 90.7 % below the 95 % goal). A set that has already been seen cannot accept a later version without bias, so it was retired and its 157 cases moved to development (317 in total).",
});
d.testSet = {
  name: "test-v3",
  status: "to_build",
  note: "Fresh postings never in the eval (including Nortal, Praxent, Able, ThriveCart and the daily ingests). Same sampling rules as test-v2 (<= 25 per company, <= 3 per vacancy). Last cycle (ADR 0004): if it does not meet the criterion nothing is iterated again; it is accepted with the documented gap (ADR 0005).",
};
writeFileSync(P, JSON.stringify(d, null, 2).replace(/\n/g, crlf ? "\r\n" : "\n") + (raw.endsWith("\n") ? (crlf ? "\r\n" : "\n") : ""));
console.log("moved", moved, "dev total", d.cases.filter((c) => c.split === "dev").length);
