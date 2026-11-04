import { sql } from "drizzle-orm";
import { createDb } from "./client.js";
import { loadEnv } from "./env.js";

const TEST_DB_SUFFIX = "_test";

/** Name of the database a connection string points to (last path segment), without ever echoing credentials. */
function databaseNameOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid connection URL.");
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

/**
 * Database tests truncate tables, so they only ever run against a database whose name ends in "_test".
 * Throws (the suite fails, it does not silently skip) when the name does not.
 */
export function assertTestDatabaseName(name: string): void {
  if (!name.endsWith(TEST_DB_SUFFIX) || name.length === TEST_DB_SUFFIX.length) {
    throw new Error(
      `Refusing to run database tests against "${name}": the database name must end in "${TEST_DB_SUFFIX}" ` +
        "(set TEST_DATABASE_URL to a throwaway database, never the real one).",
    );
  }
}

/**
 * Pure core of getTestDatabaseUrl. Reads TEST_DATABASE_URL only (never DATABASE_URL). When it is missing:
 * - in a full run (RF_REQUIRE_DB_TESTS=1, set by `npm test` at the repo root) it throws, so the suite FAILS;
 * - otherwise (one workspace, one file) it returns null and the database tests are skipped.
 */
export function resolveTestDatabaseUrl(env: Record<string, string | undefined>): string | null {
  const url = env["TEST_DATABASE_URL"];
  if (!url) {
    if (env["RF_REQUIRE_DB_TESTS"] === "1") {
      throw new Error(
        "TEST_DATABASE_URL is not set, but this is a full test run (RF_REQUIRE_DB_TESTS=1): the database tests " +
          "must run, not be skipped. Add TEST_DATABASE_URL to .env (see .env.example).",
      );
    }
    return null;
  }
  assertTestDatabaseName(databaseNameOf(url));
  return url;
}

export function getTestDatabaseUrl(): string | null {
  loadEnv();
  return resolveTestDatabaseUrl(process.env);
}

/** Connects and double-checks the server-side database name before the caller can truncate anything. */
export async function openTestDatabase(url: string): Promise<ReturnType<typeof createDb>> {
  assertTestDatabaseName(databaseNameOf(url));
  const connection = createDb(url);
  try {
    const result = await connection.db.execute<{ name: string }>(
      sql`select current_database() as name`,
    );
    assertTestDatabaseName(result.rows[0]?.name ?? "");
  } catch (error) {
    await connection.pool.end();
    throw error;
  }
  return connection;
}
