// npm run eval -- --split dev [--model gemini-3.5-flash-lite] [--limit N]
// Runs the eligibility classifier over an eval split and writes a Markdown report (see docs/progreso.md).
// The model's raw answers are cached (they cost quota); the deterministic post-processing is recomputed on every run.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  ELIGIBILITY_PROMPT_VERSION,
  GeminiProvider,
  MeteredProvider,
  POSTPROCESS_VERSION,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  RateLimiter,
  buildUserMessage,
  classifyRaw,
  effectiveLimits,
  finalizeOutcome,
  parseLimits,
  type RawOutcome,
} from "../src/index.js";
import { unclearResult } from "../src/eligibility/postprocess.js";
import {
  loadDailyUsage,
  loadRawCache,
  saveDailyUsage,
  saveRawCache,
} from "./cache.js";
import { loadCases, loadDevLabelRevision, loadJob } from "./loader.js";
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
async function withRetries(run: () => Promise<RawOutcome>): Promise<RawOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const waitMs = Math.min(120_000, 5_000 * 2 ** attempt);
      if (error instanceof RateLimitError && attempt < 4) {
        const wait = Math.max(waitMs, error.retryAfterMs ?? 0);
        console.log(`  429 (per minute): waiting ${Math.round(wait / 1000)} s`);
        await sleep(wait);
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

  const model = args.model || process.env["RF_LLM_MODEL_CLASSIFY"] || DEFAULT_MODEL;
  const config = parseLimits(JSON.parse(readFileSync(LIMITS_URL, "utf8")) as unknown);
  const limits = effectiveLimits(config, model);

  const cases = loadCases(split).slice(0, Number.isFinite(args.limit) ? args.limit : undefined);
  const jobs = cases.map((item) => {
    const job = loadJob(item);
    const prompt = {
      title: job.title,
      locationRaw: job.locationRaw,
      workplaceType: job.workplaceType,
      descriptionText: job.descriptionText,
    };
    return { item, job, prompt };
  });
  const cache = loadRawCache(ELIGIBILITY_PROMPT_VERSION, model);
  const pending = jobs.filter(({ job }) => !cache.has(job.contentHash));

  // The key is only needed when a call will actually be made; a fully cached run never needs it.
  const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["RF_LLM_API_KEY"];
  if (pending.length > 0 && !apiKey) {
    fail("GEMINI_API_KEY is not set (put it in .env or the environment). Nothing was sent.");
  }

  const stored = loadDailyUsage(model);
  const limiter = new RateLimiter({
    rpm: limits.rpm,
    rpd: limits.rpd,
    ...(stored ? { usedToday: stored.count, usedDay: stored.day } : {}),
  });
  console.log(
    `Eval ${split}: ${cases.length} cases · model ${model} (thinking ${limits.thinkingLevel}) · prompt ${ELIGIBILITY_PROMPT_VERSION} · postprocess ${POSTPROCESS_VERSION}`,
  );
  console.log(
    `${cases.length - pending.length} from cache · ${pending.length} to classify · limits ${limits.rpm} RPM / ${limits.rpd} RPD ` +
      `(after ${Math.round(config.safetyMargin * 100)} % margin; panel values verified ${config.verifiedAt ?? "never"}) · ` +
      `${limiter.usedTodayCount} requests already used today`,
  );

  const metered = apiKey
    ? new MeteredProvider(new GeminiProvider({ apiKey }), limiter, {
        sleep,
        onRequest: (current) => {
          saveDailyUsage(model, current.quotaDayKey, current.usedTodayCount);
          if (current.consumeWarning()) {
            console.warn(
              `WARNING: more than 80 % of today's ${limits.rpd} requests used for ${model}.`,
            );
          }
        },
      })
    : null;

  let callsMade = 0;
  let stoppedByQuota = false;
  for (const [index, { item, job, prompt }] of pending.entries()) {
    if (!metered) break;
    try {
      const outcome = await withRetries(() =>
        classifyRaw(metered, prompt, { model, thinkingLevel: limits.thinkingLevel }),
      );
      cache.set(job.contentHash, {
        raw: outcome.raw,
        usage: outcome.usage,
        attempts: outcome.attempts,
        problems: outcome.problems,
        promptVersion: outcome.promptVersion,
      });
      saveRawCache(ELIGIBILITY_PROMPT_VERSION, model, cache);
      callsMade += 1;
      if (split === "dev") {
        const u = outcome.usage;
        console.log(
          `[${index + 1}/${pending.length}] ${item.id} -> ${outcome.raw?.label ?? "(no valid answer)"} ` +
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

  const rows: EvalRow[] = [];
  const rawRows: EvalRow[] = [];
  for (const { item, job, prompt } of jobs) {
    const cached = cache.get(job.contentHash);
    if (!cached) throw new Error(`Missing outcome for ${item.id}`);
    const rawOutcome: RawOutcome = { ...cached, sentText: buildUserMessage(prompt) };
    const final = finalizeOutcome(rawOutcome, prompt);
    const expected = {
      label: item.label,
      workModel: item.workModel,
      countries: item.countries,
      excludedCountries: [],
    };
    const base = {
      id: item.id,
      title: job.title,
      expected,
      expectedEvidence: item.evidence,
      usage: final.usage,
      attempts: final.attempts,
    };
    rows.push({ ...base, predicted: final.result, status: final.status, notes: final.notes });
    // Ablation: the model's own answer, as if no deterministic rule existed.
    rawRows.push({
      ...base,
      predicted: rawOutcome.raw ?? unclearResult(prompt),
      status: rawOutcome.raw ? "ok" : "fallback_unclear",
      notes: [],
    });
  }
  const metrics = computeMetrics(rows, "CO");
  const date = new Date().toLocaleDateString("en-CA");
  const markdown = formatMarkdownReport(metrics, rows, {
    date,
    split,
    model,
    promptVersion: ELIGIBILITY_PROMPT_VERSION,
    postprocessVersion: POSTPROCESS_VERSION,
    labelRevision: split === "dev" ? loadDevLabelRevision() : null,
    thinkingLevel: limits.thinkingLevel,
    limits: { rpm: limits.rpm, rpd: limits.rpd, verifiedAt: config.verifiedAt },
    callsMade,
    fromCache: cases.length - pending.length,
    showCases: split === "dev",
    withoutPostprocess: computeMetrics(rawRows, "CO"),
  });
  mkdirSync(REPORTS_URL, { recursive: true });
  const reportFile = new URL(
    `${date}-${ELIGIBILITY_PROMPT_VERSION}-${model}-${split}.md`,
    REPORTS_URL,
  );
  writeFileSync(reportFile, markdown);

  const a = metrics.applicable;
  const raw = computeMetrics(rawRows, "CO").applicable;
  const pct = (value: number | null): string =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  console.log(
    `\nPrecision ${pct(a.precision)} · recall ${pct(a.recall)} (TP ${a.tp} FP ${a.fp} FN ${a.fn} TN ${a.tn}) · ` +
      `label accuracy ${pct(metrics.labelAccuracy)} · raw model only: precision ${pct(raw.precision)} recall ${pct(raw.recall)}`,
  );
  console.log(
    `visible output avg ${metrics.outputTokens.average.toFixed(0)} / max ${metrics.outputTokens.max} tokens · thinking avg ${metrics.thinkingTokens.average.toFixed(0)} · ` +
      `cost per offer $${metrics.costUsd.perOffer.toFixed(6)} · post-processing: ${JSON.stringify(metrics.noteCounts)} · statuses: ${JSON.stringify(metrics.statusCounts)}`,
  );
  console.log(`Report: ${reportFile.pathname.replace(/^\//, "")}`);
}

await main();
