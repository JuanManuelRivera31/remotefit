import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { requireDatabaseUrl } from "./env.js";
import * as schema from "./schema.js";

export function createDb(connectionString: string = requireDatabaseUrl()) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>["db"];
