import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ELIGIBILITY_PROMPT_VERSION,
  FakeLLMProvider,
  MemoryQuotaLedger,
  QuotaExhaustedError,
  RateLimitError,
  parseLimits,
  type FakeStep,
} from "@remotefit/core";
import type { createDb } from "../db/client.js";
import { getTestDatabaseUrl, openTestDatabase } from "../db/test-db.js";
import { companies, eligibilityResults, jobs, llmUsageDaily } from "../db/schema.js";
import { runClassify } from "./run.js";

const testDatabaseUrl = getTestDatabaseUrl();

const limits = parseLimits({
  source: "test",
  verifiedAt: null,
  safetyMargin: 0,
  models: {
    "model-a": { rpm: 6000, tpm: 1000000, rpd: 1000, thinkingLevel: "MINIMAL" },
    "model-b": { rpm: 6000, tpm: 1000000, rpd: 1000, thinkingLevel: "MINIMAL" },
  },
});

const answer = {
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
};
const ok: FakeStep = { data: answer };

let ledger = new MemoryQuotaLedger();
const base = {
  sleep: async () => undefined,
  limits,
  backoffBaseMs: 1,
  get ledger() {
    return ledger;
  },
};

// Needs a migrated database whose name ends in _test (it truncates jobs, companies and the result tables).
// Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!testDatabaseUrl)("runClassify against PostgreSQL", () => {
  let connection: ReturnType<typeof createDb>;
  let companyId = 0;

  const wipe = () =>
    connection.db.execute(
      sql`truncate table eligibility_results, llm_usage_daily, fit_results, jobs, companies restart identity cascade`,
    );

  beforeAll(async () => {
    connection = await openTestDatabase(testDatabaseUrl ?? "");
  });
  beforeEach(async () => {
    ledger = new MemoryQuotaLedger();
    await wipe();
    const [company] = await connection.db
      .insert(companies)
      .values({ name: "FakeCo", ats: "greenhouse", boardToken: "fakeco" })
      .returning({ id: companies.id });
    companyId = company?.id ?? 0;
  });
  afterAll(async () => {
    await wipe();
    await connection.pool.end();
  });

  const seed = (
    items: {
      externalId: string;
      contentHash?: string;
      outcome?: "pass" | "discarded" | null;
      isActive?: boolean;
    }[],
  ) =>
    connection.db.insert(jobs).values(
      items.map((item) => ({
        companyId,
        source: "greenhouse",
        externalId: item.externalId,
        title: "Software Engineer",
        locationRaw: "Colombia, Remote",
        workplaceType: null,
        isActive: item.isActive ?? true,
        url: `https://example.test/${item.externalId}`,
        descriptionText: "Fully remote role.",
        contentHash: item.contentHash ?? `hash-${item.externalId}`,
        prefilterVersion: "prefilter-v1",
        prefilterOutcome: item.outcome === undefined ? "pass" : item.outcome,
      })),
    );

  const results = () => connection.db.select().from(eligibilityResults);

  it("classifies only active postings that passed the pre-filter, once per content_hash, and stores the audit columns", async () => {
    await seed([
      { externalId: "1" },
      { externalId: "2", contentHash: "hash-1" }, // same content as 1: shares its result
      { externalId: "3", outcome: "discarded" },
      { externalId: "4", outcome: null },
      { externalId: "5", isActive: false },
      { externalId: "6" },
    ]);
    const provider = new FakeLLMProvider([ok, ok]);
    const summary = await runClassify(connection.db, {
      ...base,
      model: "model-a",
      providerFor: () => provider,
    });
    expect(summary).toMatchObject({
      total: 2,
      classified: 2,
      pending: 0,
      pendingAfter: 0,
      stopped: null,
    });
    expect(provider.callCount).toBe(2);
    const rows = await results();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      decidedBy: "llm",
      model: "model-a",
      promptVersion: ELIGIBILITY_PROMPT_VERSION,
      label: "country_specific",
      status: "ok",
    });
    expect(rows[0]?.postprocessVersion).toMatch(/^postprocess-v/);
    expect(rows[0]?.rawOutput).toMatchObject({ label: "country_specific" });
    const [usage] = await connection.db.select().from(llmUsageDaily);
    expect(usage).toMatchObject({ model: "model-a", requests: 2, rateLimited: 0 });
    expect(usage?.tokensIn).toBeGreaterThan(0);
  });

  it("is idempotent: a second run finds nothing pending and makes no calls", async () => {
    await seed([{ externalId: "1" }]);
    await runClassify(connection.db, {
      ...base,
      model: "model-a",
      providerFor: () => new FakeLLMProvider([ok]),
    });
    const provider = new FakeLLMProvider([]);
    const summary = await runClassify(connection.db, {
      ...base,
      model: "model-a",
      providerFor: () => provider,
    });
    expect(summary).toMatchObject({ total: 0, classified: 0, pendingAfter: 0 });
    expect(provider.callCount).toBe(0);
  });

  it("(backlog 'hecho cuando') 429 and then an exhausted quota: terminates, loses nothing and reports what is pending", async () => {
    await seed([
      { externalId: "1" },
      { externalId: "2" },
      { externalId: "3" },
      { externalId: "4" },
    ]);
    const provider = new FakeLLMProvider([ok, new RateLimitError(), ok, new QuotaExhaustedError()]);
    const summary = await runClassify(connection.db, {
      ...base,
      model: "model-a",
      providerFor: () => provider,
    });
    expect(summary.classified).toBe(2);
    expect(summary.stopped?.reason).toBe("quota_exhausted");
    expect(summary.pending).toBe(2);
    expect(summary.pendingAfter).toBe(2);
    expect(await results()).toHaveLength(2);
    const [usage] = await connection.db.select().from(llmUsageDaily);
    expect(usage).toMatchObject({ requests: 4, rateLimited: 1 });

    // The next run (quota back) picks up exactly the two that were left.
    const next = await runClassify(connection.db, {
      ...base,
      model: "model-a",
      providerFor: () => new FakeLLMProvider([ok, ok]),
    });
    expect(next).toMatchObject({ total: 2, classified: 2, pendingAfter: 0 });
    expect(await results()).toHaveLength(4);
  });

  it("stores fallback results under the fallback's own model key, never under the primary's", async () => {
    await seed([{ externalId: "1" }, { externalId: "2" }]);
    const primary = new FakeLLMProvider([ok, new QuotaExhaustedError()]);
    const fallback = new FakeLLMProvider([ok]);
    const summary = await runClassify(connection.db, {
      ...base,
      model: "model-a",
      fallbackModel: "model-b",
      providerFor: (model) => (model === "model-a" ? primary : fallback),
    });
    expect(summary.usedFallback).toBe(true);
    const rows = await results();
    expect(rows.map((r) => r.model).sort()).toEqual(["model-a", "model-b"]);
    // model-a still lacks one posting: the pending count is per primary model and prompt version.
    expect(summary.pendingAfter).toBe(1);
  });

  it("does not run while an eval is pending: no call, nothing written, everything stays pending", async () => {
    await seed([{ externalId: "1" }, { externalId: "2" }]);
    ledger.setPendingEval({
      split: "test",
      model: "model-a",
      promptVersion: "eligibility-v4",
      postprocessVersion: "postprocess-v3",
      remaining: 144,
      since: "2026-11-04T22:00:00Z",
    });
    const fake = new FakeLLMProvider([ok, ok]);
    const summary = await runClassify(connection.db, {
      ...base,
      model: "model-a",
      providerFor: () => fake,
    });
    expect(summary).toMatchObject({ classified: 0, pendingAfter: 2 });
    expect(summary.blockedByEval?.split).toBe("test");
    expect(fake.callCount).toBe(0);
    expect(await connection.db.select().from(eligibilityResults)).toHaveLength(0);
  });

  it("counts against the same ledger the eval uses (one counter per model and day)", async () => {
    await seed([{ externalId: "1" }, { externalId: "2" }, { externalId: "3" }]);
    const now = new Date("2026-11-04T20:00:00Z");
    for (let i = 0; i < 999; i += 1) ledger.record("model-a", "2026-11-04"); // the eval spent 999 of 1000
    const summary = await runClassify(connection.db, {
      ...base,
      now: () => now,
      model: "model-a",
      providerFor: () => new FakeLLMProvider([ok, ok, ok]),
    });
    expect(summary.classified).toBe(1);
    expect(summary.stopped?.reason).toBeDefined();
    expect(ledger.used("model-a", "2026-11-04")).toBe(1000);
  });

  it("respects --limit and reuses the requests already counted today", async () => {
    await seed([{ externalId: "1" }, { externalId: "2" }, { externalId: "3" }]);
    const first = await runClassify(connection.db, {
      ...base,
      model: "model-a",
      limit: 1,
      providerFor: () => new FakeLLMProvider([ok]),
    });
    expect(first).toMatchObject({ total: 1, classified: 1, pendingAfter: 2 });
    await runClassify(connection.db, {
      ...base,
      model: "model-a",
      providerFor: () => new FakeLLMProvider([ok, ok]),
    });
    const [usage] = await connection.db
      .select()
      .from(llmUsageDaily)
      .where(eq(llmUsageDaily.model, "model-a"));
    expect(usage?.requests).toBe(3);
    expect(ledger.used("model-a", usage?.usageDate ?? "")).toBe(3);
  });
});
