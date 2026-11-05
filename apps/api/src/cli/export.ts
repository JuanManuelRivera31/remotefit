// npm run export [-- --out <file>]: writes the public JSON of the static site from the current database, without
// ingesting or classifying (the pipeline does all four steps). Default: apps/web/public/data/jobs.json (git-ignored).
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CLASSIFY_MODEL,
  ELIGIBILITY_PROMPT_VERSION,
  POSTPROCESS_VERSION,
} from "@remotefit/core";
import { createDb } from "../db/client.js";
import { loadEnv } from "../db/env.js";
import { buildPublicData, writePublicData } from "../export/run.js";

loadEnv();
const outIndex = process.argv.indexOf("--out");
const outFile =
  outIndex >= 0
    ? (process.argv[outIndex + 1] ?? "")
    : fileURLToPath(new URL("../../../web/public/data/jobs.json", import.meta.url));
const { db, pool } = createDb();
try {
  const data = await buildPublicData(db, {
    classifier: {
      promptVersion: ELIGIBILITY_PROMPT_VERSION,
      postprocessVersion: POSTPROCESS_VERSION,
      model: process.env["RF_LLM_MODEL_CLASSIFY"] || DEFAULT_CLASSIFY_MODEL,
    },
    now: new Date(),
  });
  const { bytes } = writePublicData(outFile, data);
  console.log(`export: ${data.jobs.length} postings · ${Math.round(bytes / 1024)} KB`);
} finally {
  await pool.end();
}
