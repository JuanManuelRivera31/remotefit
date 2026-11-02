import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";
import { loadEnv } from "./env.js";

loadEnv();
const { db, pool } = createDb();
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)) });
  console.log("Migrations applied.");
} finally {
  await pool.end();
}
