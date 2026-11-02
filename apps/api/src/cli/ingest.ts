import { readFileSync } from "node:fs";
import { createDb } from "../db/client.js";
import { loadEnv } from "../db/env.js";
import { companiesFileSchema, formatSummary, runIngest } from "../ingest/run.js";

loadEnv();
const file = new URL("../../../../data/companies.json", import.meta.url);
const { companies } = companiesFileSchema.parse(JSON.parse(readFileSync(file, "utf8")) as unknown);

const { db, pool } = createDb();
try {
  const summaries = await runIngest(db, companies);
  console.log(formatSummary(summaries));
  if (summaries.some((s) => s.status === "error")) process.exitCode = 1;
} finally {
  await pool.end();
}
