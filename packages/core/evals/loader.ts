import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { connectors, type AtsName, type NormalizedJob } from "../src/index.js";
import { ELIGIBILITY_LABELS } from "../src/eligibility/schema.js";

const ROOT = new URL("../../../", import.meta.url);
const CASES_URL = new URL("packages/core/evals/eligibility/cases.json", ROOT);
const BODIES_URL = new URL("data/seed-career-ops/bodies/", ROOT);

const caseSchema = z.looseObject({
  id: z.string(),
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  board: z.string(),
  externalId: z.string(),
  split: z.enum(["dev", "test"]),
  label: z.enum(ELIGIBILITY_LABELS),
  labelStatus: z.string(),
  countries: z.array(z.string()).default([]),
  workModel: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  evidence: z
    .string()
    .nullish()
    .transform((value) => value ?? "(sin evidencia anotada)"),
});
export type EvalCase = z.infer<typeof caseSchema>;

// Pending cases (test-v2 while it is being labelled) carry no label yet: only the labelled ones are validated strictly.
const caseEnvelopeSchema = z.looseObject({ id: z.string(), split: z.enum(["dev", "test"]), labelStatus: z.string() });
const casesFileSchema = z.looseObject({
  cases: z.array(caseEnvelopeSchema),
  testSet: z.looseObject({ status: z.string() }).optional(),
  devLabelRevision: z.looseObject({ date: z.string() }).optional(),
});

/** Date of the last owner revision of the development labels (cases.json `devLabelRevision`), for report headers. */
export function loadDevLabelRevision(): string | null {
  const file = casesFileSchema.parse(JSON.parse(readFileSync(CASES_URL, "utf8")) as unknown);
  return file.devLabelRevision?.date ?? null;
}

/** Cases of ONE split that have a confirmed label. Filtering happens before anything else touches the data. */
export function loadCases(split: "dev" | "test"): EvalCase[] {
  const file = casesFileSchema.parse(JSON.parse(readFileSync(CASES_URL, "utf8")) as unknown);
  return file.cases
    .filter((item) => item.split === split && item.labelStatus !== "pending")
    .map((item) => caseSchema.parse(item));
}

/**
 * The posting text the case was labelled against, rebuilt from the rescued raw ATS object with the real connector.
 * The text stays local (ADR 0002); only the public posting is later sent to the free-tier LLM.
 */
export function loadJob(item: EvalCase): NormalizedJob {
  const file = new URL(`${item.ats}/${item.board}/${item.externalId}.json`, BODIES_URL);
  if (!existsSync(file)) {
    throw new Error(`Missing rescued posting text for ${item.id} (expected ${file.pathname}).`);
  }
  const stored = z
    .looseObject({ raw: z.unknown() })
    .parse(JSON.parse(readFileSync(file, "utf8")) as unknown);
  return connectors[item.ats as AtsName].toNormalizedJob(stored.raw, {
    name: item.board,
    boardToken: item.board,
  });
}
