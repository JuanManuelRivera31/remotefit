import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  ApiStatusSchema,
  JobDetailSchema,
  JobsPageSchema,
  type ClassifierDecision,
} from "@remotefit/core";
import { createApp } from "../app.js";
import type { createDb } from "../db/client.js";
import { companies, eligibilityResults, jobs } from "../db/schema.js";
import { getTestDatabaseUrl, openTestDatabase } from "../db/test-db.js";

const testDatabaseUrl = getTestDatabaseUrl();

const classifier = {
  promptVersion: "eligibility-test",
  postprocessVersion: "postprocess-test",
  model: "model-a",
};
const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

interface Seed {
  key: string;
  location: string;
  label: string;
  countries?: string[];
  workModel?: string;
  siblingGroup?: string;
  isActive?: boolean;
  postedDaysAgo?: number;
  version?: Partial<typeof classifier>;
  body?: string;
  evidence?: string[];
}

// Needs a migrated database whose name ends in _test (it truncates jobs, companies and the result tables).
describe.skipIf(!testDatabaseUrl)("jobs API against PostgreSQL", () => {
  let connection: ReturnType<typeof createDb>;
  let server: Server;
  let base = "";
  const ids = new Map<string, number>();
  let decisions: ClassifierDecision[] = [];

  const wipe = () =>
    connection.db.execute(
      sql`truncate table eligibility_results, llm_usage_daily, fit_results, jobs, companies restart identity cascade`,
    );

  const seed = async (items: Seed[]) => {
    const [company] = await connection.db
      .insert(companies)
      .values({ name: "FakeCo", ats: "greenhouse", boardToken: "fakeco" })
      .returning({ id: companies.id });
    for (const item of items) {
      const [job] = await connection.db
        .insert(jobs)
        .values({
          companyId: company?.id ?? 0,
          source: "greenhouse",
          externalId: item.key,
          siblingGroup: item.siblingGroup ?? null,
          title: `Engineer ${item.key}`,
          locationRaw: item.location,
          url: `https://example.test/${item.key}`,
          descriptionText:
            item.body ??
            `${"Intro. ".repeat(40)}We hire remotely anywhere in Latin America. Thanks.`,
          contentHash: `hash-${item.key}`,
          postedAt: daysAgo(item.postedDaysAgo ?? 1),
          firstSeenAt: daysAgo(1),
          lastSeenAt: daysAgo(0),
          isActive: item.isActive ?? true,
          prefilterVersion: "prefilter-v1",
          prefilterOutcome: "pass",
        })
        .returning({ id: jobs.id });
      ids.set(item.key, job?.id ?? 0);
      const version = { ...classifier, ...item.version };
      await connection.db.insert(eligibilityResults).values({
        contentHash: `hash-${item.key}`,
        promptVersion: version.promptVersion,
        model: version.model,
        postprocessVersion: version.postprocessVersion,
        decidedBy: "llm",
        label: item.label,
        countries: item.countries ?? [],
        workModel: item.workModel ?? "remote",
        seniority: "mid",
        evidence: item.evidence ?? ["anywhere in Latin America"],
        status: "ok",
      });
    }
  };

  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: (await response.json()) as unknown };
  };

  beforeAll(async () => {
    connection = await openTestDatabase(testDatabaseUrl ?? "");
    server = createApp({
      jobs: {
        db: connection.db,
        classifier,
        now: () => now,
        get decisions() {
          return decisions;
        },
      },
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    decisions = [];
    ids.clear();
    await wipe();
    await seed([
      { key: "latam", location: "Remote - LATAM", label: "latam_eligible" },
      { key: "hybrid", location: "Bogotá", label: "latam_eligible", workModel: "hybrid" },
      { key: "mx-only", location: "Mexico", label: "country_specific", countries: ["MX"] },
      {
        key: "sib-co",
        location: "Colombia",
        label: "latam_eligible",
        siblingGroup: "g1",
        postedDaysAgo: 5,
      },
      {
        key: "sib-pe",
        location: "Peru",
        label: "latam_eligible",
        siblingGroup: "g1",
        postedDaysAgo: 2,
      },
      { key: "closed", location: "Remote - LATAM", label: "worldwide", isActive: false },
      {
        key: "old-version",
        location: "Remote",
        label: "worldwide",
        version: { postprocessVersion: "postprocess-old" },
      },
      { key: "unclear", location: "Remote", label: "unclear", workModel: "unknown" },
      { key: "us", location: "US Remote", label: "us_only" },
    ]);
  });
  afterAll(async () => {
    server.close();
    await wipe();
    await connection.pool.end();
  });

  it("lists only what is applicable from Colombia: one card per sibling group, nothing closed or from another version", async () => {
    const { status, body } = await get("/api/jobs");
    expect(status).toBe(200);
    const page = JobsPageSchema.parse(body);
    expect(page.items.map((i) => i.id)).toEqual([ids.get("latam"), ids.get("sib-pe")]);
    expect(page.items[1]).toMatchObject({ siblingCount: 1, siblingLocations: ["Colombia"] });
    expect(page.counts).toEqual({ applicable: 2, unconfirmed: 1 });
    expect(page.items[0]?.evidence).toEqual(["anywhere in Latin America"]);
    expect(page.items[0]?.lastVerifiedAt).toBe(daysAgo(0).toISOString());
  });

  it("shows unconfirmed postings only on request", async () => {
    const page = JobsPageSchema.parse((await get("/api/jobs?showUnconfirmed=1")).body);
    expect(page.items.map((i) => [i.id, i.verdict])).toContainEqual([
      ids.get("unclear"),
      "unconfirmed",
    ]);
  });

  it("decides per country with the same isApplicable as the eval", async () => {
    const page = JobsPageSchema.parse((await get("/api/jobs?country=MX")).body);
    expect(page.items.map((i) => i.id)).toContain(ids.get("mx-only"));
  });

  it("returns the detail with the quote in context, siblings and provenance", async () => {
    const { status, body } = await get(`/api/jobs/${ids.get("sib-co")}`);
    expect(status).toBe(200);
    const detail = JobDetailSchema.parse(body);
    expect(detail.excerpt?.match).toBe("anywhere in Latin America");
    expect(detail.excerpt?.before.startsWith("…")).toBe(true);
    expect(detail.siblings.map((s) => s.id)).toEqual([ids.get("sib-pe")]);
    expect(detail.provenance).toMatchObject({
      model: "model-a",
      postprocessVersion: "postprocess-test",
    });
  });

  it("answers 404 for closed, hidden or unknown postings, and 400 for a bad query, in one error format", async () => {
    for (const path of [
      `/api/jobs/${ids.get("closed")}`,
      `/api/jobs/${ids.get("us")}`,
      `/api/jobs/${ids.get("hybrid")}`,
      "/api/jobs/999999",
      "/api/nope",
    ]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(404);
      expect(ApiErrorSchema.parse(body).error.code).toBe("not_found");
    }
    const bad = await get("/api/jobs?country=colombia");
    expect(bad.status).toBe(400);
    expect(ApiErrorSchema.parse(bad.body).error.code).toBe("invalid_query");
  });

  it("reports the classifier as not accepted until a decision exists, and the pending count", async () => {
    let status = ApiStatusSchema.parse((await get("/api/status")).body);
    expect(status.acceptance.state).toBe("not_accepted");
    expect(status.measuredCountries).toEqual(["CO"]);
    expect(status.pendingClassification).toBe(0);

    decisions = [
      {
        ...classifier,
        state: "accepted",
        decidedAt: "2026-11-04",
        testSet: "test-v3",
        precision: 0.96,
        recall: 0.9,
        precisionCi: [0.9, 0.98],
        recallCi: [0.8, 0.95],
        measuredCountries: ["CO"],
      },
    ];
    status = ApiStatusSchema.parse((await get("/api/status")).body);
    expect(status.acceptance).toMatchObject({
      state: "accepted",
      testSet: "test-v3",
      precision: 0.96,
    });
  });
});
