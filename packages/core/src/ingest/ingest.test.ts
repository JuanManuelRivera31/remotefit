import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectors } from "../ats/index.js";
import { assignSiblingGroups, isReliableRequisitionId } from "./siblings.js";
import { reconcileBoard } from "./reconcile.js";

const sezzleJobs = (() => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../fixtures/greenhouse/sezzle-siblings.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  const company = { name: "Sezzle", boardToken: "sezzle" };
  const jobs = (fixture as { jobs: unknown[] }).jobs;
  return jobs.map((raw) => connectors.greenhouse.toNormalizedJob(raw, company));
})();

describe("isReliableRequisitionId", () => {
  it.each(["TBD", "tbc", "TBDDDDD", "0000", "10000", "", null, "N/A", "-"])(
    "treats %j as a placeholder",
    (value) => expect(isReliableRequisitionId(value)).toBe(false),
  );
  it.each(["481", "RF-2024-21", "REQ-1234"])("treats %j as reliable", (value) =>
    expect(isReliableRequisitionId(value)).toBe(true),
  );
});

describe("assignSiblingGroups with real Sezzle postings", () => {
  const groups = assignSiblingGroups(sezzleJobs);
  const groupOf = (title: string, location: string) => {
    const index = sezzleJobs.findIndex(
      (j) => j.title.trim() === title && j.locationRaw.startsWith(location),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    return groups[index];
  };

  it("groups the same posting published per country", () => {
    const latam = groupOf("Solutions Engineer", "Latin America");
    expect(groupOf("Solutions Engineer", "Bogota, Colombia")).toBe(latam);
    expect(groupOf("Solutions Engineer", "Mexico, Remote")).toBe(latam);
  });

  it("does not merge a different posting that has the same title (other requisition id)", () => {
    expect(groupOf("Solutions Engineer", "United States, Remote")).not.toBe(
      groupOf("Solutions Engineer", "Latin America"),
    );
  });

  it("groups siblings by title when the requisition id is a placeholder", () => {
    const fraud = sezzleJobs
      .map((job, index) => ({ job, group: groups[index] }))
      .filter(({ job }) => job.title.trim() === "Fraud Operations Intern");
    expect(fraud.length).toBeGreaterThan(1);
    expect(new Set(fraud.map(({ group }) => group)).size).toBe(1);
  });

  it("never merges different companies or different titles", () => {
    const keys = assignSiblingGroups([
      { source: "greenhouse", boardToken: "a", title: "Engineer", requisitionId: null },
      { source: "greenhouse", boardToken: "b", title: "Engineer", requisitionId: null },
      { source: "greenhouse", boardToken: "a", title: "Designer", requisitionId: null },
    ]);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("reconcileBoard", () => {
  const stored = [
    { externalId: "1", closedAt: null },
    { externalId: "2", closedAt: null },
    { externalId: "3", closedAt: new Date("2026-10-01") },
  ];
  const listed = (...ids: string[]) => ({
    status: "ok" as const,
    jobs: ids.map((externalId) => ({ externalId })),
  });

  it("closes an absent posting without deleting anything and reopens a returning one", () => {
    expect(reconcileBoard(stored, listed("1", "3"))).toEqual({
      toClose: ["2"],
      toReopen: ["3"],
      skippedClosure: null,
    });
  });

  it("closes nothing when the board is not found", () => {
    expect(reconcileBoard(stored, { status: "not_found" })).toEqual({
      toClose: [],
      toReopen: [],
      skippedClosure: "board_not_found",
    });
  });

  it("closes nothing when a healthy board suddenly lists zero postings", () => {
    expect(reconcileBoard(stored, listed()).toClose).toEqual([]);
    expect(reconcileBoard(stored, listed()).skippedClosure).toBe("empty_board");
  });

  it("leaves everything alone when nothing changed", () => {
    expect(reconcileBoard(stored.slice(0, 2), listed("1", "2"))).toEqual({
      toClose: [],
      toReopen: [],
      skippedClosure: null,
    });
  });
});
