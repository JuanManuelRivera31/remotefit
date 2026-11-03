import { describe, expect, it } from "vitest";
import {
  LABEL_COLUMNS,
  applyLabelRows,
  freezeSummary,
  parseLabelRows,
  type CasesFileLike,
} from "./labels-v2.js";

const header = LABEL_COLUMNS.join("\t");
const tsv = (...rows: string[]): string => [header, ...rows].join("\n");

describe("parseLabelRows", () => {
  it("parses valid rows", () => {
    const rows = parseLabelRows(
      tsv(
        "a:b:1\tcountry_specific\tCO\tremote\tno\tno\tColombia, Remote\t",
        "a:b:2\tlatam_eligible\t\tremote\tno\tyes\tLatin America [Remote]\tcheck",
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      label: "country_specific",
      countries: ["CO"],
      needsOwner: false,
    });
    expect(rows[1]).toMatchObject({
      label: "latam_eligible",
      countries: [],
      needsOwner: true,
      note: "check",
    });
  });

  it("reports every problem at once", () => {
    expect(() =>
      parseLabelRows(
        tsv(
          "a:b:1\tnonsense\tCO\tremote\tno\tno\tx\t",
          "a:b:2\tlatam_eligible\t\thybrid\tno\tno\tx\t",
          "a:b:3\tcountry_specific\tColombia\tremote\tno\tno\tx\t",
          "a:b:4\tus_only\t\tunknown\tno\tno\t\t",
          "a:b:4\tus_only\t\tunknown\tno\tno\tdup\t",
        ),
      ),
    ).toThrow(
      /bad label[\s\S]*requires workModel remote[\s\S]*bad country[\s\S]*evidence is required[\s\S]*duplicate id/,
    );
  });

  it("rejects a wrong header", () => {
    expect(() => parseLabelRows("id\tlabel\n")).toThrow(/Unexpected header/);
  });

  it("only allows a country_specific without countries when the note explains the region", () => {
    expect(() =>
      parseLabelRows(tsv("a:b:1\tcountry_specific\t\tremote\tno\tno\tEMEA only\t")),
    ).toThrow();
    expect(() =>
      parseLabelRows(
        tsv("a:b:1\tcountry_specific\t\tremote\tno\tno\tEMEA only\tregion outside LATAM"),
      ),
    ).not.toThrow();
  });
});

const pending = (id: string, board: string): Record<string, unknown> => ({
  id,
  board,
  split: "test",
  labelStatus: "pending",
});

describe("applyLabelRows and freezeSummary", () => {
  const make = (): CasesFileLike => ({
    cases: [
      pending("a:x:1", "x"),
      pending("a:x:2", "x"),
      pending("a:y:3", "y"),
      { id: "d:1", split: "dev", labelStatus: "labeled" },
    ],
    testSet: { name: "test-v2", status: "building" },
  });

  it("writes labels, marks the source and separates owner-review cases", () => {
    const data = make();
    const rows = parseLabelRows(
      tsv(
        "a:x:1\tcountry_specific\tCO\tremote\tno\tno\tColombia, Remote\t",
        "a:x:2\tunclear\t\tunknown\tno\tyes\tRemote\tambiguous",
      ),
    );
    expect(applyLabelRows(data, rows, "2026-11-04")).toBe(2);
    expect(data.cases[0]).toMatchObject({
      label: "country_specific",
      labelSource: "llm-assisted",
      labelStatus: "labeled",
      labeledAt: "2026-11-04",
    });
    expect(data.cases[1]).toMatchObject({ labelStatus: "needs_owner", labelNote: "ambiguous" });
  });

  it("refuses unknown ids and non-test cases", () => {
    const data = make();
    expect(() =>
      applyLabelRows(data, parseLabelRows(tsv("zzz\tus_only\t\tunknown\tno\tno\tx\t")), "d"),
    ).toThrow(/unknown case/);
    expect(() =>
      applyLabelRows(data, parseLabelRows(tsv("d:1\tus_only\t\tunknown\tno\tno\tx\t")), "d"),
    ).toThrow(/not a test case/);
  });

  it("is incomplete while cases are pending, provisional below the target and frozen at 60", () => {
    const data = make();
    expect(freezeSummary(data).status).toBe("incomplete");
    applyLabelRows(
      data,
      parseLabelRows(
        tsv(
          "a:x:1\tcountry_specific\tCO\tremote\tno\tno\tq1\t",
          "a:x:2\tlatam_eligible\t\tremote\tno\tno\tq2\t",
          "a:y:3\tus_only\t\tunknown\tno\tno\tq3\t",
        ),
      ),
      "d",
    );
    const summary = freezeSummary(data);
    expect(summary).toMatchObject({
      total: 3,
      pending: 0,
      applicableCO: 2,
      status: "provisional",
      missingForTarget: 58,
    });
    expect(summary.perCompany).toEqual({ x: { n: 2, applicable: 2 }, y: { n: 1, applicable: 0 } });
    expect(freezeSummary(data, 2).status).toBe("frozen");
  });
});
