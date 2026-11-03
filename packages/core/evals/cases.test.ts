import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface CaseRecord {
  id: string;
  split: string;
  board: string;
  siblingKey?: string;
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
  excludedFromEval?: { id: string }[];
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

  it("keeps the retired test-v2 as development cases, flagged and recorded", () => {
    const retired = file.cases.filter((item) => item.retiredFrom === "test-v2");
    expect(retired).toHaveLength(157);
    expect(retired.every((item) => item.split === "dev")).toBe(true);
    const record = file.retiredTestSets?.find((set) => set.name === "test-v2");
    expect(record?.cases).toBe(157);
    expect(record?.acceptedRun.accepted).toBe(false);
    expect(file.cases.filter((item) => item.split === "dev")).toHaveLength(317);
  });

  it("describes the current test set as test-v3 (empty until it is built)", () => {
    expect(file.testSet.name).toBe("test-v3");
    const testCases = file.cases.filter((item) => item.split === "test");
    if (file.testSet.status === "to_build") expect(testCases).toHaveLength(0);
  });

  it("records where every relabel came from", () => {
    for (const item of file.cases) {
      if (item.relabelRule) expect(item.relabeledFrom, item.id).toBeDefined();
    }
  });
});

// The construction rules hold for the retired test-v2 and must hold for test-v3 when it exists.
describe("test set construction rules (ADR 0004)", () => {
  const testCases = file.cases.filter(
    (item) => item.split === "test" || item.retiredFrom === "test-v2",
  );

  it("keeps at most 25 cases per company", () => {
    const perBoard = new Map<string, number>();
    for (const item of testCases) perBoard.set(item.board, (perBoard.get(item.board) ?? 0) + 1);
    for (const [board, count] of perBoard) expect(count, board).toBeLessThanOrEqual(25);
  });

  it("keeps at most 3 variants of the same vacancy (sibling key)", () => {
    const perKey = new Map<string, number>();
    for (const item of testCases) {
      if (item.siblingKey) perKey.set(item.siblingKey, (perKey.get(item.siblingKey) ?? 0) + 1);
    }
    for (const [key, count] of perKey) expect(count, key).toBeLessThanOrEqual(3);
  });

  it("never shares a vacancy (sibling key) between development and a live test split", () => {
    const devKeys = new Set(
      file.cases
        .filter((item) => item.split === "dev" && item.retiredFrom !== "test-v2" && item.siblingKey)
        .map((item) => item.siblingKey),
    );
    for (const item of testCases) expect(devKeys.has(item.siblingKey), item.id).toBe(false);
  });

  it("keeps the left-out siblings out of every split", () => {
    const ids = new Set(file.cases.map((item) => item.id));
    for (const item of file.excludedFromEval ?? []) expect(ids.has(item.id), item.id).toBe(false);
  });
});
