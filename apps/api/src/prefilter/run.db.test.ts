import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PREFILTER_VERSION } from "@remotefit/core";
import { createDb } from "../db/client.js";
import { loadEnv } from "../db/env.js";
import { companies, jobs } from "../db/schema.js";
import { runPrefilter } from "./run.js";

loadEnv();
const hasDatabase = Boolean(process.env["DATABASE_URL"]);

interface SeedJob {
  externalId: string;
  title: string;
  locationRaw: string;
  workplaceType?: "remote" | "hybrid" | "onsite";
  siblingGroup?: string;
  isActive?: boolean;
  descriptionText?: string;
}

// Needs a migrated database (npm run db:migrate). Skipped when DATABASE_URL is not set.
// WARNING: truncates jobs and companies, so never point DATABASE_URL at a database holding real ingested data.
describe.skipIf(!hasDatabase)("runPrefilter against PostgreSQL", () => {
  let connection: ReturnType<typeof createDb>;
  let companyId = 0;

  beforeAll(() => {
    connection = createDb();
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`truncate table fit_results, jobs, companies restart identity cascade`,
    );
    const [company] = await connection.db
      .insert(companies)
      .values({ name: "FakeCo", ats: "greenhouse", boardToken: "fakeco" })
      .returning({ id: companies.id });
    companyId = company?.id ?? 0;
  });
  afterAll(async () => {
    await connection.db.execute(
      sql`truncate table fit_results, jobs, companies restart identity cascade`,
    );
    await connection.pool.end();
  });

  const seed = (items: SeedJob[]) =>
    connection.db.insert(jobs).values(
      items.map((item) => ({
        companyId,
        source: "greenhouse",
        externalId: item.externalId,
        title: item.title,
        locationRaw: item.locationRaw,
        workplaceType: item.workplaceType ?? null,
        siblingGroup: item.siblingGroup ?? null,
        isActive: item.isActive ?? true,
        url: `https://example.test/${item.externalId}`,
        descriptionText: item.descriptionText ?? "Description",
        contentHash: `hash-${item.externalId}`,
      })),
    );
  const byId = async (externalId: string) => {
    const [row] = await connection.db.select().from(jobs).where(eq(jobs.externalId, externalId));
    if (!row) throw new Error(`missing job ${externalId}`);
    return row;
  };

  it("stores version, outcome, rule and matched text, judging siblings one by one", async () => {
    await seed([
      { externalId: "usa", title: "Backend Engineer", locationRaw: "New York", siblingGroup: "g1" },
      {
        externalId: "col",
        title: "Backend Engineer",
        locationRaw: "Colombia, Remote",
        siblingGroup: "g1",
      },
      {
        externalId: "hyb",
        title: "Backend Engineer",
        locationRaw: "Bogotá",
        workplaceType: "hybrid",
      },
      { externalId: "ae", title: "Account Executive", locationRaw: "Colombia, Remote" },
      { externalId: "closed", title: "Backend Engineer", locationRaw: "New York", isActive: false },
    ]);

    const summary = await runPrefilter(connection.db);
    expect(summary).toMatchObject({
      version: PREFILTER_VERSION,
      evaluated: 4,
      changed: 4,
      discarded: 3,
      passed: 1,
    });

    expect(await byId("usa")).toMatchObject({
      prefilterVersion: PREFILTER_VERSION,
      prefilterOutcome: "discarded",
      prefilterRule: "non_latam_location",
      prefilterMatchedText: "New York",
    });
    expect(await byId("col")).toMatchObject({
      prefilterOutcome: "pass",
      prefilterRule: null,
      prefilterMatchedText: null,
    });
    expect(await byId("hyb")).toMatchObject({
      prefilterOutcome: "discarded",
      prefilterRule: "onsite_or_hybrid_metadata",
      prefilterMatchedText: "workplaceType=hybrid",
    });
    expect(await byId("ae")).toMatchObject({
      prefilterOutcome: "discarded",
      prefilterRule: "non_tech_role",
    });
    // Closed postings are not evaluated.
    expect(await byId("closed")).toMatchObject({ prefilterVersion: null, prefilterOutcome: null });
  });

  it("is idempotent, and recomputes when the version or the posting changes", async () => {
    await seed([
      { externalId: "usa", title: "Backend Engineer", locationRaw: "New York" },
      { externalId: "col", title: "Backend Engineer", locationRaw: "Colombia, Remote" },
    ]);
    await runPrefilter(connection.db);
    expect((await runPrefilter(connection.db)).changed).toBe(0);

    // A stored result from an older rule set is recomputed.
    await connection.db
      .update(jobs)
      .set({ prefilterVersion: "prefilter-v0" })
      .where(eq(jobs.externalId, "usa"));
    expect((await runPrefilter(connection.db)).changed).toBe(1);
    expect(await byId("usa")).toMatchObject({ prefilterVersion: PREFILTER_VERSION });

    // The location changed on the ATS: the stored decision follows it.
    await connection.db
      .update(jobs)
      .set({ locationRaw: "Colombia, Remote" })
      .where(eq(jobs.externalId, "usa"));
    expect((await runPrefilter(connection.db)).changed).toBe(1);
    expect(await byId("usa")).toMatchObject({ prefilterOutcome: "pass", prefilterRule: null });
  });
});
