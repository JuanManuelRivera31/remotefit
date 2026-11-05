// npm run classify [-- --limit N] [--model m] [--allow-fallback] [--dry-run]
// Classifies pending postings with the free Gemini tier. The key comes from GEMINI_API_KEY (alias RF_LLM_API_KEY).
import { readFileSync } from "node:fs";
import {
  DEFAULT_CLASSIFY_MODEL,
  DEFAULT_QUOTA_LEDGER_URL,
  ELIGIBILITY_PROMPT_VERSION,
  FileQuotaLedger,
  GeminiProvider,
  POSTPROCESS_VERSION,
  parseLimits,
} from "@remotefit/core";
import { createDb } from "../db/client.js";
import { loadEnv } from "../db/env.js";
import { runClassify } from "../classify/run.js";
import { pendingByCompany, selectPendingJobs } from "../classify/store.js";
import { companiesFileSchema } from "../ingest/run.js";
import { effectiveLimits } from "@remotefit/core";

const DEFAULT_MODEL = DEFAULT_CLASSIFY_MODEL;
const FALLBACK_MODEL = "gemini-3.1-flash-lite";
const LIMITS_URL = new URL("../../../../data/llm-limits.json", import.meta.url);
const COMPANIES_URL = new URL("../../../../data/companies.json", import.meta.url);

function readArgs(argv: string[]) {
  const args = {
    limit: undefined as number | undefined,
    model: "",
    allowFallback: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") args.limit = Number(argv[(i += 1)]);
    else if (arg === "--model") args.model = argv[(i += 1)] ?? "";
    else if (arg === "--allow-fallback") args.allowFallback = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.limit !== undefined && !(args.limit > 0))
    throw new Error("--limit must be a positive number");
  return args;
}

loadEnv();
const args = readArgs(process.argv.slice(2));
const model = args.model || process.env["RF_LLM_MODEL_CLASSIFY"] || DEFAULT_MODEL;
const limits = parseLimits(JSON.parse(readFileSync(LIMITS_URL, "utf8")) as unknown);
const lastBoardTokens = companiesFileSchema
  .parse(JSON.parse(readFileSync(COMPANIES_URL, "utf8")) as unknown)
  .companies.filter((c) => c.classifyLast)
  .map((c) => c.boardToken);
const { db, pool } = createDb();
try {
  const key = { promptVersion: ELIGIBILITY_PROMPT_VERSION, model };
  const ledger = new FileQuotaLedger(DEFAULT_QUOTA_LEDGER_URL);
  const pending = await selectPendingJobs(db, key, args.limit, { lastBoardTokens });
  console.log(
    `Prompt ${key.promptVersion} · postprocess ${POSTPROCESS_VERSION} · model ${model} · ${pending.length} postings to classify`,
  );
  const pendingEval = ledger.pendingEval();
  if (pendingEval) {
    // The eval has priority on the shared daily quota (owner decision, 2026-11-04).
    console.log(
      `An eval run is pending (${pendingEval.split}, ${pendingEval.model}, ${pendingEval.promptVersion}, ` +
        `${pendingEval.remaining} cases left): classify does not run until it finishes. Nothing was sent.`,
    );
  } else if (args.dryRun || pending.length === 0) {
    if (args.dryRun) {
      // Backlog report: queue order by company and quota days at the daily limit (retries make it a little slower).
      const rpd = effectiveLimits(limits, model).rpd;
      const byCompany = await pendingByCompany(db, key, { lastBoardTokens });
      let cumulative = 0;
      for (const { company, pending: n } of byCompany) {
        cumulative += n;
        console.log(`  ${company.padEnd(22)} ${String(n).padStart(5)} · done by quota day ${Math.ceil(cumulative / rpd)}`);
      }
      console.log(`Backlog: ${cumulative} postings · ${Math.ceil(cumulative / rpd)} quota days at ${rpd} RPD (no eval that day).`);
      console.log("Dry run: nothing was sent.");
    }
  } else {
    const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["RF_LLM_API_KEY"];
    if (!apiKey)
      throw new Error(
        "GEMINI_API_KEY is not set (put it in .env or the environment). Nothing was sent.",
      );
    if (args.allowFallback) {
      console.log(
        `Warning: fallback ${FALLBACK_MODEL} enabled. It has no accepted measurement; its results are stored under its own model key.`,
      );
    }
    const summary = await runClassify(db, {
      model,
      ...(args.allowFallback ? { fallbackModel: FALLBACK_MODEL } : {}),
      providerFor: () => new GeminiProvider({ apiKey }),
      limits,
      ledger,
      lastBoardTokens,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onEvent: (event) => {
        if (event.kind === "retry") {
          console.log(
            `  job ${event.jobId}: ${event.why} on ${event.model}, waiting ${Math.round(event.waitMs / 1000)} s`,
          );
        } else if (event.kind === "switched_to_fallback") {
          console.log(`  switching ${event.from} -> ${event.to} (${event.why})`);
        } else if (event.kind === "stopped") {
          console.log(`  stopped: ${event.reason} (${event.message})`);
        }
      },
      onWarn: (message) => console.log(`  warning: ${message}`),
    });
    console.log(
      `Classified ${summary.classified} of ${summary.total} · ${summary.rateLimitedResponses} rate-limited responses · ` +
        `${summary.pendingAfter} still pending for ${summary.model}` +
        (summary.stopped ? ` · stopped early: ${summary.stopped.reason}` : ""),
    );
  }
} finally {
  await pool.end();
}
