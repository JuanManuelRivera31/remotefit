// npm run pipeline [-- --out <file>]
// The daily job of the published site (GitHub Actions, or your PC as plan B): ingest → prefilter → classify → export.
// Needs DATABASE_URL and GEMINI_API_KEY (alias RF_LLM_API_KEY). Prints counts and ids only (public logs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CLASSIFY_MODEL,
  ELIGIBILITY_PROMPT_VERSION,
  GeminiProvider,
  POSTPROCESS_VERSION,
  SqlQuotaLedger,
  parseLimits,
} from "@remotefit/core";
import { createDb } from "../db/client.js";
import { loadEnv } from "../db/env.js";
import { companiesFileSchema } from "../ingest/run.js";
import { runPipeline } from "../pipeline/run.js";

const DEFAULT_OUT = fileURLToPath(new URL("../../../web/public/data/jobs.json", import.meta.url));

loadEnv();
const outIndex = process.argv.indexOf("--out");
const outFile = outIndex >= 0 ? (process.argv[outIndex + 1] ?? DEFAULT_OUT) : DEFAULT_OUT;
const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["RF_LLM_API_KEY"];
const databaseUrl = process.env["DATABASE_URL"];
if (!apiKey || !databaseUrl) {
  // Not an error in a fork or before the secrets exist: say what is missing (names only) and stop.
  console.log(
    `pipeline skipped: missing ${[!databaseUrl && "DATABASE_URL", !apiKey && "GEMINI_API_KEY"].filter(Boolean).join(" and ")}`,
  );
  process.exit(0);
}

const model = process.env["RF_LLM_MODEL_CLASSIFY"] || DEFAULT_CLASSIFY_MODEL;
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as unknown;
const { companies } = companiesFileSchema.parse(read("../../../../data/companies.json"));
const limits = parseLimits(read("../../../../data/llm-limits.json"));

const { db, pool } = createDb();
try {
  const summary = await runPipeline(db, {
    companies,
    classifier: {
      promptVersion: ELIGIBILITY_PROMPT_VERSION,
      postprocessVersion: POSTPROCESS_VERSION,
      model,
    },
    classify: {
      model,
      providerFor: () => new GeminiProvider({ apiKey }),
      limits,
      ledger: new SqlQuotaLedger((text, params) => pool.query(text, params)),
      lastBoardTokens: companies.filter((c) => c.classifyLast).map((c) => c.boardToken),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    outFile,
    log: (line) => console.log(line),
    secrets: [apiKey, databaseUrl],
  });
  if (!summary.ok) process.exitCode = 1;
} finally {
  await pool.end();
}
