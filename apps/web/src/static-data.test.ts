import { describe, expect, it } from "vitest";
import { parsePublicData, staticJob, staticJobs, staticStatus } from "./static-data.js";

const now = new Date("2026-11-05T12:00:00Z");
const job = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Engineer ${id}`,
  company: "Acme",
  locationRaw: "Bogotá, Colombia",
  url: `https://jobs.example.com/${id}`,
  siblingGroup: null,
  postedAt: "2026-11-01T00:00:00.000Z",
  firstSeenAt: "2026-11-01T00:00:00.000Z",
  lastSeenAt: "2026-11-05T09:00:00.000Z",
  result: {
    label: "latam_eligible",
    countries: [],
    excludedCountries: [],
    workModel: "remote",
    seniority: "mid",
    evidence: ["Remote - LATAM"],
    status: "ok",
  },
  ...over,
});
const data = {
  generatedAt: "2026-11-05T09:30:00.000Z",
  classifier: { promptVersion: "eligibility-v4", postprocessVersion: "postprocess-v3", model: "m" },
  acceptance: {
    state: "accepted",
    decidedAt: "2026-11-04",
    testSet: "test-v3",
    precision: 0.978,
    recall: 0.957,
    precisionCi: [0.923, 0.994],
    recallCi: [0.893, 0.983],
  },
  measuredCountries: ["CO"],
  pendingClassification: 12,
  jobs: [
    job(1, { siblingGroup: "g", locationRaw: "Lima, Peru" }),
    job(2, { siblingGroup: "g" }),
    job(3, {
      locationRaw: "US Remote",
      result: { ...job(3).result, label: "us_only", evidence: ["US only"] },
    }),
  ],
};

describe("static data (published site, no server)", () => {
  const loaded = parsePublicData(data);

  it("answers the list like the API: one card per vacancy, led by the user's country", () => {
    const page = staticJobs(loaded, new URLSearchParams("country=CO&page=1"), now);
    expect(page.items.map((i) => i.id)).toEqual([2]);
    expect(page.items[0]).toMatchObject({ groupCountries: ["CO", "PE"], siblingCount: 1 });
  });

  it("answers the detail without an excerpt (the public file has only the short quote)", () => {
    const detail = staticJob(loaded, 2, "CO", now);
    expect(detail?.excerpt).toBeNull();
    expect(detail?.evidence).toEqual(["Remote - LATAM"]);
    expect(detail?.siblings).toEqual([
      {
        id: 1,
        location: "Lima, Peru",
        url: "https://jobs.example.com/1",
        countries: ["PE"],
        visible: true,
      },
    ]);
    expect(staticJob(loaded, 3, "CO", now)).toBeNull(); // US only: 404
    expect(staticJob(loaded, 99, "CO", now)).toBeNull();
  });

  it("answers the status with the data date and the measured intervals", () => {
    expect(staticStatus(loaded)).toMatchObject({
      dataGeneratedAt: "2026-11-05T09:30:00.000Z",
      acceptance: { state: "accepted", precisionCi: [0.923, 0.994] },
      pendingClassification: 12,
    });
  });

  it("rejects a public file with fields that must never be published", () => {
    const leaky = { ...data, jobs: [{ ...job(1), descriptionText: "full posting text" }] };
    expect(() => parsePublicData(leaky)).toThrow();
  });
});
