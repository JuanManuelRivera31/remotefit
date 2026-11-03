import { createDb } from "../db/client.js";
import { loadEnv } from "../db/env.js";
import { collectReport, formatReport } from "../prefilter/report.js";
import { runPrefilter } from "../prefilter/run.js";

loadEnv();
const reportOnly = process.argv.includes("--report-only");
const withReport = reportOnly || process.argv.includes("--report");

const { db, pool } = createDb();
try {
  if (!reportOnly) {
    const summary = await runPrefilter(db);
    console.log(
      `Prefilter ${summary.version}: evaluated ${summary.evaluated} · changed ${summary.changed} · discarded ${summary.discarded} · pass ${summary.passed}`,
    );
  }
  if (withReport) console.log(`\n${formatReport(await collectReport(db))}`);
} finally {
  await pool.end();
}
