// npm run eval -- --split dev [--model gemini-3.5-flash-lite] [--limit N]
// Runs the eligibility classifier over an eval split and writes a Markdown report (see docs/progreso.md).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  ELIGIBILITY_PROMPT_VERSION,
  GeminiProvider,
  MeteredProvider,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  RateLimiter,
  classifyJob,
  effectiveLimits,
  parseLimits,
  type ClassifyOutcome,
} from "../src/index.js";
import { loadDailyUsage, loadOutcomeCache, saveDailyUsage, saveOutcomeCache } from "./cache.js";
import { loadCases, loadJob } from "./loader.js";
import { computeMetrics, type EvalRow } from "./metrics.js";
import { formatMarkdownReport } from "./report.js";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const LIMITS_URL = new URL("../../../data/llm-limits.json", import.meta.url);
const REPORTS_URL = new URL("reports/", import.meta.url);

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args = { split: "", model: "", limit: Infinity, approvedByOwner: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--split") args.split = argv[(i += 1)] ?? "";
    else if (arg === "--model") args.model = argv[(i += 1)] ?? "";
    else if (arg === "--limit") args.limit = Number(argv[(i += 1)]);
    else if (arg === "--approved-by-owner") args.approvedByOwner = true;
    else if (arg === "--") continue;
    else fail(`Unknown argument: ${arg}`);
  }
  return args;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries a classification on per-minute 429s and transient provider errors; daily quota ends the run. */
async function classifyWithRetries(run: () => Promise<ClassifyOutcome>): Promise<ClassifyOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const waitMs = Math.min(120_000, 5_000 * 2 ** attempt);
      if (error instanceof RateLimitError && attempt < 4) {
        console.log(
          `  429 (per minute): waiting ${Math.round(Math.max(waitMs, error.retryAfterMs ?? 0) / 1000)} s`,
        );
        await sleep(Math.max(waitMs, error.retryAfterMs ?? 0));
      } else if (error instanceof ProviderError && error.retryable && attempt < 2) {
        console.log(
          `  transient provider error (${error.status ?? "network"}): retrying in ${waitMs / 1000} s`,
        );
        await sleep(waitMs);
      } else {
        throw error;
      }
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.split !== "dev" && args.split !== "test")
    fail("Use --split dev (or test, which needs --approved-by-owner).");
  const split = args.split;
  if (split === "test" && !args.approvedByOwner) {
    fail(
      "The frozen test split only accepts candidate versions the owner approved (ADR 0004). " +
        "Run with --approved-by-owner once they have said so; nothing was read or sent.",
    );
  }

  // The runner (not Claude) loads .env so GEMINI_API_KEY reaches the process; real env vars win.
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url));
  } catch {
    // No .env file: rely on the real environment.
  }
  const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["RF_LLM_API_KEY"];
  if (!apiKey)
    fail("GEMINI_API_KEY is not set (put it in .env or the environment). Nothing was sent.");

  const model = args.model || process.env["RF_LLM_MODEL_CLASSIFY"] || DEFAULT_MODEL;
  const config = parseLimits(JSON.parse(readFileSync(LIMITS_URL, "utf8")) as unknown);
  const limits = effectiveLimits(config, model);

  const cases = loadCases(split).slice(0, Number.isFinite(args.limit) ? args.limit : undefined);
  const jobs = cases.map((item) => ({ item, job: loadJob(item) }));
  const cache = loadOutcomeCache(ELIGIBILITY_PROMPT_VERSION, model);
  const pending = jobs.filter(({ job }) => !cache.has(job.contentHash));

  const stored = loadDailyUsage(model);
  const limiter = new RateLimiter({
    rpm: limits.rpm,
    rpd: limits.rpd,
    ...(stored ? { usedToday: stored.count, usedDay: stored.day } : {}),
  });
  console.log(
    `Eval ${split}: ${cases.length} cases · model ${model} (thinking ${limits.thinkingLevel}) · prompt ${ELIGIBILITY_PROMPT_VERSION}`,
  );
  console.log(
    `${cases.length - pending.length} from cache · ${pending.length} to classify · limits ${limits.rpm} RPM / ${limits.rpd} RPD ` +
      `(after ${Math.round(config.safetyMargin * 100)} % margin; panel values verified ${config.verifiedAt ?? "never"}) · ` +
      `${limiter.usedTodayCount} requests already used today`,
  );

  const metered = new MeteredProvider(new GeminiProvider({ apiKey }), limiter, {
    sleep,
    onRequest: (current) => {
      saveDailyUsage(model, current.quotaDayKey, current.usedTodayCount);
      if (current.consumeWarning()) {
        console.warn(
          `WARNING: more than 80 % of today's ${limits.rpd} requests used for ${model}.`,
        );
      }
    },
  });

  let callsMade = 0;
  let stoppedByQuota = false;
  for (const [index, { item, job }] of pending.entries()) {
    try {
      const outcome = await classifyWithRetries(() =>
        classifyJob(
          metered,
          {
            title: job.title,
            locationRaw: job.locationRaw,
            workplaceType: job.workplaceType,
            descriptionText: job.descriptionText,
          },
          { model, thinkingLevel: limits.thinkingLevel },
        ),
      );
      cache.set(job.contentHash, outcome);
      saveOutcomeCache(ELIGIBILITY_PROMPT_VERSION, model, cache);
      callsMade += 1;
      if (split === "dev") {
        const u = outcome.usage;
        console.log(
          `[${index + 1}/${pending.length}] ${item.id} -> ${outcome.result.label} (${outcome.status}) ` +
            `in ${u.inputTokens} · out ${u.outputTokens} · think ${u.thinkingTokens}`,
        );
      } else {
        console.log(`[${index + 1}/${pending.length}] classified`);
      }
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        stoppedByQuota = true;
        console.log(
          `Daily quota reached (${error.message}). ${pending.length - index} cases remain.`,
        );
        break;
      }
      throw error;
    }
  }

  const remaining = jobs.filter(({ job }) => !cache.has(job.contentHash)).length;
  if (remaining > 0) {
    console.log(
      `\nIncomplete: ${remaining} of ${cases.length} cases are still unclassified${stoppedByQuota ? " (daily quota)" : ""}. ` +
        "No report was written because partial metrics would mislead. Run the same command after the Pacific-midnight quota reset: finished cases come from the cache.",
    );
    process.exit(3);
  }

  const rows: EvalRow[] = jobs.map(({ item, job }) => {
    const outcome = cache.get(job.contentHash);
    if (!outcome) throw new Error(`Missing outcome for ${item.id}`);
    return {
      id: item.id,
      title: job.title,
      expected: {
        label: item.label,
        workModel: item.workModel,
        countries: item.countries,
        excludedCountries: [],
      },
      expectedEvidence: item.evidence,
      predicted: outcome.result,
      status: outcome.status,
      usage: outcome.usage,
      attempts: outcome.attempts,
    };
  });
  const metrics = computeMetrics(rows, "CO");
  const date = new Date().toLocaleDateString("en-CA");
  const markdown = formatMarkdownReport(metrics, rows, {
    date,
    split,
    model,
    promptVersion: ELIGIBILITY_PROMPT_VERSION,
    thinkingLevel: limits.thinkingLevel,
    limits: { rpm: limits.rpm, rpd: limits.rpd, verifiedAt: config.verifiedAt },
    callsMade,
    fromCache: cases.length - pending.length,
    showCases: split === "dev",
  });
  mkdirSync(REPORTS_URL, { recursive: true });
  const reportFile = new URL(
    `${date}-${ELIGIBILITY_PROMPT_VERSION}-${model}-${split}.md`,
    REPORTS_URL,
  );
  writeFileSync(reportFile, markdown);

  const a = metrics.applicable;
  const pct = (value: number | null): string =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  console.log(
    `\nPrecision ${pct(a.precision)} · recall ${pct(a.recall)} (TP ${a.tp} FP ${a.fp} FN ${a.fn} TN ${a.tn}) · ` +
      `label accuracy ${pct(metrics.labelAccuracy)} · visible output avg ${metrics.outputTokens.average.toFixed(0)} / max ${metrics.outputTokens.max} tokens · ` +
      `thinking avg ${metrics.thinkingTokens.average.toFixed(0)} · cost per offer $${metrics.costUsd.perOffer.toFixed(6)}`,
  );
  console.log(`Report: ${reportFile.pathname.replace(/^\//, "")}`);
}

await main();
