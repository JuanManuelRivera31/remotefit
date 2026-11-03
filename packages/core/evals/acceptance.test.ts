import { describe, expect, it } from "vitest";
import { acceptanceVerdict, formatAcceptanceSections } from "./acceptance.js";
import type { EvalRow } from "./metrics.js";

const predicted = (
  label: "latam_eligible" | "onsite_or_hybrid",
  workModel: "remote" | "hybrid",
) => ({
  label,
  countries: [],
  excludedCountries: [],
  workModel,
  workModelConflict: false,
  seniority: "mid" as const,
  minYearsExperience: null,
  hiringModel: "unknown" as const,
  timezoneRequirement: null,
  requiresUsWorkAuthorization: null,
  postingLanguage: "en" as const,
  evidence: ["quote"],
});

function row(
  id: string,
  board: string,
  ats: string,
  expectApplicable: boolean,
  predictApplicable: boolean,
): EvalRow {
  return {
    id,
    board,
    ats,
    title: id,
    expected: {
      label: expectApplicable ? "latam_eligible" : "onsite_or_hybrid",
      workModel: expectApplicable ? "remote" : "hybrid",
      countries: [],
      excludedCountries: [],
    },
    expectedEvidence: "label evidence",
    predicted: predicted(
      predictApplicable ? "latam_eligible" : "onsite_or_hybrid",
      predictApplicable ? "remote" : "hybrid",
    ),
    status: "ok",
    notes: [],
    usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, equivalentCostUsd: 0 },
    attempts: 1,
  };
}

describe("acceptance report", () => {
  const rows = [
    ...Array.from({ length: 19 }, (_, i) => row(`tp${i}`, "canonical", "greenhouse", true, true)),
    row("fp", "sezzle", "greenhouse", false, true),
    row("fn", "ciandt", "lever", true, false),
    row("tn", "ciandt", "lever", false, false),
  ];

  it("judges the point values, not the interval (precision 19/20 = 95 %, recall 19/20 = 95 %)", () => {
    expect(acceptanceVerdict(rows)).toMatchObject({ accepted: true });
    expect(
      acceptanceVerdict([...rows, row("fp2", "sezzle", "greenhouse", false, true)]).accepted,
    ).toBe(false);
  });

  it("lists the breakdown, the three exclusions and every false positive and negative with evidence", () => {
    const text = formatAcceptanceSections(rows).join("\n");
    expect(text).toContain("**Resultado: ACEPTADA**");
    for (const scope of ["Total", "Sin Sezzle", "Sin Canonical", "Sin Lever", "Empresa: ciandt"]) {
      expect(text).toContain(`| ${scope} |`);
    }
    expect(text).toContain("## Falsos positivos (1)");
    expect(text).toContain("## Falsos negativos (1)");
    expect(text).toContain("label evidence");
  });
});
