import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SqlQuotaLedger } from "@remotefit/core";
import type { createDb } from "../db/client.js";
import { getTestDatabaseUrl, openTestDatabase } from "../db/test-db.js";

const testDatabaseUrl = getTestDatabaseUrl();

const pending = {
  split: "test",
  model: "m",
  promptVersion: "eligibility-v5",
  postprocessVersion: "postprocess-v4",
  remaining: 150,
  since: "2026-11-05T09:00:00.000Z",
};

// The shared quota ledger of S11: the local eval and the daily GitHub Actions run count against this one database.
describe.skipIf(!testDatabaseUrl)("SqlQuotaLedger against PostgreSQL", () => {
  let connection: ReturnType<typeof createDb>;
  const ledger = () => new SqlQuotaLedger((text, params) => connection.pool.query(text, params));

  beforeAll(async () => {
    connection = await openTestDatabase(testDatabaseUrl ?? "");
  });
  beforeEach(async () => {
    await connection.db.execute(sql`truncate table llm_usage_daily, llm_eval_reservation`);
  });
  afterAll(async () => {
    await connection.db.execute(sql`truncate table llm_usage_daily, llm_eval_reservation`);
    await connection.pool.end();
  });

  it("counts per model and quota day, and two ledgers (two machines) add up atomically", async () => {
    const local = ledger();
    const ci = ledger();
    await Promise.all([
      ...Array.from({ length: 10 }, () => local.record("m", "2026-11-05")),
      ...Array.from({ length: 10 }, () => ci.record("m", "2026-11-05")),
    ]);
    await ci.record("other", "2026-11-05");
    expect(await local.used("m", "2026-11-05")).toBe(20);
    expect(await local.used("m", "2026-11-06")).toBe(0);
    expect(await ci.counterFor("other").used("2026-11-05")).toBe(1);
  });

  it("keeps a single pending-eval reservation that any machine can read and release", async () => {
    const local = ledger();
    const ci = ledger();
    expect(await ci.pendingEval()).toBeNull();
    await local.setPendingEval(pending);
    await local.setPendingEval({ ...pending, remaining: 40 });
    expect(await ci.pendingEval()).toEqual({ ...pending, remaining: 40 });
    await ci.clearPendingEval();
    expect(await local.pendingEval()).toBeNull();
  });
});
