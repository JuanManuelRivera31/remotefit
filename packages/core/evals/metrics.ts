import {
  ELIGIBILITY_LABELS,
  isApplicable,
  type ClassifyStatus,
  type Eligibility,
  type EligibilityLabel,
  type LLMUsage,
} from "../src/index.js";

/** What the owner-approved label says (cases.json) — only the fields that decide applicability. */
export interface ExpectedLabel {
  label: EligibilityLabel;
  workModel: Eligibility["workModel"];
  countries: string[];
  excludedCountries: string[];
}

export interface EvalRow {
  id: string;
  title: string;
  expected: ExpectedLabel;
  expectedEvidence: string;
  predicted: Eligibility;
  status: ClassifyStatus;
  /** What the deterministic post-processing did, e.g. "title_country:CO". */
  notes: string[];
  usage: LLMUsage;
  attempts: number;
}

export interface TokenStats {
  average: number;
  max: number;
  total: number;
}

export interface ApplicableMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  positives: number;
  negatives: number;
  /** null when undefined (no predicted positives / no actual positives). */
  precision: number | null;
  recall: number | null;
}

export interface Metrics {
  n: number;
  country: string;
  confusion: Record<EligibilityLabel, Record<EligibilityLabel, number>>;
  labelAccuracy: number;
  workModelAccuracy: number;
  applicable: ApplicableMetrics;
  statusCounts: Record<ClassifyStatus, number>;
  /** How many times each post-processing rule fired ("title_country", "evidence_trimmed", ...). */
  noteCounts: Record<string, number>;
  attempts: number;
  inputTokens: TokenStats;
  outputTokens: TokenStats;
  thinkingTokens: TokenStats;
  costUsd: { total: number; perOffer: number };
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

function tokenStats(values: number[]): TokenStats {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    average: values.length === 0 ? 0 : total / values.length,
    max: values.length === 0 ? 0 : Math.max(...values),
    total,
  };
}

/** Is the (predicted or labelled) result applicable for the user's country? Same rule as the product (ADR 0004). */
export const applicableFor = (value: ExpectedLabel | Eligibility, country: string): boolean =>
  isApplicable(value, country);

export function computeMetrics(rows: readonly EvalRow[], country = "CO"): Metrics {
  const confusion = Object.fromEntries(
    ELIGIBILITY_LABELS.map((expected) => [
      expected,
      Object.fromEntries(ELIGIBILITY_LABELS.map((predicted) => [predicted, 0])),
    ]),
  ) as Metrics["confusion"];
  const statusCounts: Record<ClassifyStatus, number> = {
    ok: 0,
    evidence_unverified: 0,
    fallback_unclear: 0,
  };
  const noteCounts: Record<string, number> = {};
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let labelHits = 0;
  let workModelHits = 0;
  let attempts = 0;

  for (const row of rows) {
    confusion[row.expected.label][row.predicted.label] += 1;
    statusCounts[row.status] += 1;
    for (const note of row.notes) {
      const key = note.split(":")[0] ?? note;
      noteCounts[key] = (noteCounts[key] ?? 0) + 1;
    }
    attempts += row.attempts;
    if (row.expected.label === row.predicted.label) labelHits += 1;
    if (row.expected.workModel === row.predicted.workModel) workModelHits += 1;
    const actual = applicableFor(row.expected, country);
    const predicted = applicableFor(row.predicted, country);
    if (actual && predicted) tp += 1;
    else if (!actual && predicted) fp += 1;
    else if (actual && !predicted) fn += 1;
    else tn += 1;
  }

  const costTotal = rows.reduce((sum, row) => sum + row.usage.equivalentCostUsd, 0);
  return {
    n: rows.length,
    country,
    confusion,
    labelAccuracy: ratio(labelHits, rows.length) ?? 0,
    workModelAccuracy: ratio(workModelHits, rows.length) ?? 0,
    applicable: {
      tp,
      fp,
      fn,
      tn,
      positives: tp + fn,
      negatives: fp + tn,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
    },
    statusCounts,
    noteCounts,
    attempts,
    inputTokens: tokenStats(rows.map((row) => row.usage.inputTokens)),
    outputTokens: tokenStats(rows.map((row) => row.usage.outputTokens)),
    thinkingTokens: tokenStats(rows.map((row) => row.usage.thinkingTokens)),
    costUsd: { total: costTotal, perOffer: rows.length === 0 ? 0 : costTotal / rows.length },
  };
}
