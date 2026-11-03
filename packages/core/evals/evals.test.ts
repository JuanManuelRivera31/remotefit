import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Eligibility } from "../src/index.js";
import { loadCases, loadJob } from "./loader.js";
import { computeMetrics, type EvalRow, type ExpectedLabel } from "./metrics.js";
import { formatMarkdownReport, type ReportContext } from "./report.js";

const predicted = (overrides: Partial<Eligibility> = {}): Eligibility => ({
  label: "country_specific",
  countries: ["CO"],
  excludedCountries: [],
  workModel: "remote",
  workModelConflict: false,
  seniority: "mid",
  minYearsExperience: null,
  hiringModel: "unknown",
  timezoneRequirement: null,
  requiresUsWorkAuthorization: null,
  postingLanguage: "en",
  evidence: ["Colombia, Remote"],
  ...overrides,
});

const expected = (overrides: Partial<ExpectedLabel> = {}): ExpectedLabel => ({
  label: "country_specific",
  workModel: "remote",
  countries: ["CO"],
  excludedCountries: [],
  ...overrides,
});

const usage = (
  inputTokens: number,
  outputTokens: number,
  thinkingTokens: number,
  cost: number,
) => ({
  inputTokens,
  outputTokens,
  thinkingTokens,
  equivalentCostUsd: cost,
});

const row = (
  id: string,
  e: Partial<ExpectedLabel>,
  p: Partial<Eligibility>,
  u = usage(1000, 100, 10, 0.001),
): EvalRow => ({
  id,
  title: `Title ${id}`,
  expected: expected(e),
  expectedEvidence: "owner evidence",
  predicted: predicted(p),
  status: "ok",
  notes: [],
  usage: u,
  attempts: 1,
});

// Hand-built set: 4 applicable for CO (3 found, 1 missed), 3 not applicable (1 wrongly predicted applicable).
const rows: EvalRow[] = [
  row("tp1", {}, {}),
  row(
    "tp2",
    { label: "latam_eligible", countries: [] },
    { label: "latam_eligible", countries: [] },
  ),
  row("tp3", {}, {}, usage(3000, 300, 30, 0.003)),
  row("fn1", {}, { label: "unclear", countries: [] }), // applicable missed
  row(
    "fp1",
    { label: "country_specific", countries: ["VE"] },
    { label: "country_specific", countries: ["CO"] },
  ), // wrongly applicable
  row("tn1", { label: "us_only", countries: [] }, { label: "us_only", countries: [] }),
  row(
    "tn2",
    { label: "onsite_or_hybrid", workModel: "hybrid", countries: [] },
    { label: "onsite_or_hybrid", workModel: "hybrid", countries: [] },
  ),
];

describe("computeMetrics", () => {
  const metrics = computeMetrics(rows, "CO");

  it("computes precision and recall of applicables for the user's country", () => {
    expect(metrics.applicable).toMatchObject({
      tp: 3,
      fp: 1,
      fn: 1,
      tn: 2,
      positives: 4,
      negatives: 3,
    });
    expect(metrics.applicable.precision).toBeCloseTo(3 / 4, 10);
    expect(metrics.applicable.recall).toBeCloseTo(3 / 4, 10);
  });

  it("builds the confusion matrix with expected labels as rows", () => {
    expect(metrics.confusion.country_specific.country_specific).toBe(3); // tp1, tp3, fp1
    expect(metrics.confusion.country_specific.unclear).toBe(1); // fn1
    expect(metrics.confusion.latam_eligible.latam_eligible).toBe(1);
    expect(metrics.confusion.us_only.us_only).toBe(1);
    expect(metrics.labelAccuracy).toBeCloseTo(6 / 7, 10);
  });

  it("aggregates tokens per offer and the equivalent cost", () => {
    expect(metrics.inputTokens).toMatchObject({ max: 3000, total: 1000 * 6 + 3000 });
    expect(metrics.outputTokens.max).toBe(300);
    expect(metrics.thinkingTokens.max).toBe(30);
    expect(metrics.costUsd.total).toBeCloseTo(0.006 + 0.003, 10);
    expect(metrics.costUsd.perOffer).toBeCloseTo(0.009 / 7, 10);
  });

  it("returns null instead of dividing by zero", () => {
    const none = computeMetrics([
      row("x", { label: "us_only", countries: [] }, { label: "us_only", countries: [] }),
    ]);
    expect(none.applicable.precision).toBeNull();
    expect(none.applicable.recall).toBeNull();
  });

  it("depends on the user's country", () => {
    expect(computeMetrics(rows, "VE").applicable.positives).toBe(1 + 1); // latam_eligible row + the VE-labelled one
  });
});

describe("formatMarkdownReport", () => {
  const context: ReportContext = {
    date: "2026-11-02",
    split: "dev",
    model: "gemini-3.5-flash-lite",
    promptVersion: "eligibility-v3",
    postprocessVersion: "postprocess-v1",
    labelRevision: "2026-11-03",
    thinkingLevel: "MINIMAL",
    limits: { rpm: 12, rpd: 400, verifiedAt: "2026-11-02" },
    callsMade: 7,
    fromCache: 0,
    showCases: true,
  };
  const metrics = computeMetrics(rows, "CO");

  it("includes the model, prompt version, matrix, precision, recall, tokens, cost and the failures with evidence", () => {
    const report = formatMarkdownReport(metrics, rows, context);
    expect(report).toContain("gemini-3.5-flash-lite");
    expect(report).toContain("eligibility-v3");
    expect(report).toContain("postprocess-v1");
    expect(report).toContain("revisión del dueño 2026-11-03");
    expect(report).toContain("Matriz de confusión");
    expect(report).toContain("75.0% (3/4)");
    expect(report).toContain("Salida visible");
    expect(report).toContain("Thinking");
    expect(report).toContain("Costo equivalente");
    expect(report).toContain("### fp1");
    expect(report).toContain("FALSO POSITIVO");
    expect(report).toContain("### fn1");
    expect(report).toContain("FALSO NEGATIVO");
    expect(report).toContain("Evidencia del modelo");
    expect(report).toContain("owner evidence");
    expect(report).not.toContain("### tp1");
  });

  it("never lists cases for the frozen test split", () => {
    const report = formatMarkdownReport(metrics, rows, {
      ...context,
      split: "test",
      showCases: false,
    });
    expect(report).not.toContain("### fp1");
    expect(report).toContain("no se listan casos");
  });
});

// The rescued posting texts live outside git (ADR 0002), so this check only runs where they exist.
const hasBodies = existsSync(new URL("../../../data/seed-career-ops/bodies/", import.meta.url));
describe.skipIf(!hasBodies)("loader (needs the local rescued postings)", () => {
  it("loads only the requested split and rebuilds the text of every development case", () => {
    const cases = loadCases("dev");
    expect(cases.length).toBe(48);
    expect(cases.every((item) => item.split === "dev")).toBe(true);
    for (const item of cases) {
      const job = loadJob(item);
      expect(job.descriptionText.length, item.id).toBeGreaterThan(200);
      expect(job.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
