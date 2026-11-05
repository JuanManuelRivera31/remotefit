import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createDb } from "./client.js";
import { getTestDatabaseUrl, openTestDatabase } from "./test-db.js";

const testDatabaseUrl = getTestDatabaseUrl();

// Needs a migrated database whose name ends in _test. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!testDatabaseUrl)("database smoke test", () => {
  let connection: ReturnType<typeof createDb>;

  beforeAll(async () => {
    connection = await openTestDatabase(testDatabaseUrl ?? "");
  });
  afterAll(async () => {
    await connection.pool.end();
  });

  it("connects", async () => {
    const result = await connection.db.execute(sql`select 1 as ok`);
    expect(result.rows[0]).toEqual({ ok: 1 });
  });

  it("has every table from docs/03 after migrating", async () => {
    const result = await connection.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = result.rows.map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "companies",
        "jobs",
        "eligibility_results",
        "profiles",
        "fit_results",
        "llm_usage_daily",
        "llm_eval_reservation",
      ]),
    );
  });
});
