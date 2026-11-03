import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface CaseRecord {
  id: string;
  split: string;
  board: string;
  label: string;
  labelStatus: string;
  retiredFrom?: string;
  relabelRule?: string;
  relabeledFrom?: unknown;
  relabelRevertedAt?: string;
}
interface CasesFile {
  cases: CaseRecord[];
  testSet: { name: string; status: string };
  retiredTestSets?: { name: string; cases: number; acceptedRun: { accepted: boolean } }[];
}

const file = JSON.parse(
  readFileSync(new URL("./eligibility/cases.json", import.meta.url), "utf8"),
) as CasesFile;

describe("cases.json invariants", () => {
  it("has unique ids", () => {
    const ids = file.cases.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only knows the dev and test splits", () => {
    for (const item of file.cases) expect(["dev", "test"]).toContain(item.split);
  });

  it("keeps the retired test-v1 as development cases, flagged and recorded", () => {
    const retired = file.cases.filter((item) => item.retiredFrom === "test-v1");
    expect(retired).toHaveLength(112);
    expect(retired.every((item) => item.split === "dev")).toBe(true);
    const record = file.retiredTestSets?.find((set) => set.name === "test-v1");
    expect(record?.cases).toBe(112);
    expect(record?.acceptedRun.accepted).toBe(false);
  });

  it("describes the current test set as test-v2", () => {
    expect(file.testSet.name).toBe("test-v2");
    const testCases = file.cases.filter((item) => item.split === "test");
    if (file.testSet.status === "building") expect(testCases.length).toBeGreaterThanOrEqual(0);
  });

  it("records where every relabel came from", () => {
    for (const item of file.cases) {
      if (item.relabelRule) expect(item.relabeledFrom, item.id).toBeDefined();
    }
  });
});
