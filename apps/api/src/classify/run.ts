import {
  ELIGIBILITY_PROMPT_VERSION,
  MeteredProvider,
  RateLimiter,
  effectiveLimits,
  runClassifyQueue,
  type LLMProvider,
  type PendingEval,
  type SharedQuotaCounter,
  type LlmLimitsConfig,
  type QueueEvent,
  type QueueSummary,
} from "@remotefit/core";
import type { Db } from "../db/client.js";
import { addUsage, createDbQueueStore, selectPendingJobs } from "./store.js";

/** The shared quota ledger (FileQuotaLedger in the CLI): one counter per model and Pacific day, plus the eval reservation. */
export interface ClassifyQuotaLedger {
  pendingEval(): PendingEval | null;
  counterFor(model: string): SharedQuotaCounter;
}

export interface ClassifyRunOptions {
  /** Primary model (default in the CLI: gemini-3.5-flash-lite). */
  model: string;
  /** Opt-in only. A fallback result is stored under its own model key and has no accepted measurement yet. */
  fallbackModel?: string;
  /** Builds the provider for a model. Tests pass a FakeLLMProvider; the CLI passes GeminiProvider. */
  providerFor: (model: string) => LLMProvider;
  limits: LlmLimitsConfig;
  /** Shared with `npm run eval`. The eval has priority: while one is pending, classify makes no call. */
  ledger: ClassifyQuotaLedger;
  /** Maximum postings to classify in this run (a manual cap while the pipeline is young). */
  limit?: number;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
  onEvent?: (event: QueueEvent) => void;
  /** Called when the 80 % of a model's daily limit is crossed. */
  onWarn?: (message: string) => void;
  maxAttempts?: number;
  backoffBaseMs?: number;
  failuresBeforeStop?: number;
}

export interface ClassifyRunSummary extends QueueSummary {
  promptVersion: string;
  model: string;
  /** Postings still without a result for this prompt and model after the run (includes those never attempted). */
  pendingAfter: number;
  /** Set when the run did not start because an eval run is pending (it has priority on the shared quota). */
  blockedByEval: PendingEval | null;
}

/**
 * `npm run classify`: classifies the active postings that passed the pre-filter and have no stored result for the
 * current prompt version and model, newest first, within the free tier's pacing. Whatever cannot be classified stays
 * pending (nothing is written for it) and is picked up by the next run.
 */
export async function runClassify(
  db: Db,
  options: ClassifyRunOptions,
): Promise<ClassifyRunSummary> {
  const now = options.now ?? (() => new Date());
  const pending = await selectPendingJobs(
    db,
    { promptVersion: ELIGIBILITY_PROMPT_VERSION, model: options.model },
    options.limit,
  );

  const blockedByEval = options.ledger.pendingEval();
  if (blockedByEval) {
    // Nothing is sent: the pending eval keeps its share of the daily quota. Everything stays pending for the next run.
    const pendingAfter = (
      await selectPendingJobs(db, { promptVersion: ELIGIBILITY_PROMPT_VERSION, model: options.model })
    ).length;
    return {
      total: pending.length,
      classified: 0,
      pending: pending.length,
      failedJobIds: [],
      rateLimitedResponses: 0,
      classifiedByModel: {},
      usedFallback: false,
      stopped: null,
      promptVersion: ELIGIBILITY_PROMPT_VERSION,
      model: options.model,
      pendingAfter,
      blockedByEval,
    };
  }

  const makeModel = (model: string) => {
    const limits = effectiveLimits(options.limits, model);
    // The limit is enforced on the shared ledger (eval + classify); llm_usage_daily keeps the history with tokens.
    const limiter = new RateLimiter({ rpm: limits.rpm, rpd: limits.rpd, now });
    const provider = new MeteredProvider(options.providerFor(model), limiter, {
      sleep: options.sleep,
      shared: options.ledger.counterFor(model),
      onRequest: (l) => {
        // History row per quota day (not the gate). Awaited at the end of the run.
        pendingWrites.push(addUsage(db, model, { requests: 1 }, now()));
        if (l.consumeWarning()) {
          options.onWarn?.(
            `${model}: 80 % of the daily request limit used (${l.usedTodayCount}/${limits.rpd})`,
          );
        }
      },
    });
    return { model, provider, thinkingLevel: limits.thinkingLevel };
  };
  const pendingWrites: Promise<void>[] = [];

  const primary = makeModel(options.model);
  const fallback = options.fallbackModel ? makeModel(options.fallbackModel) : undefined;

  const summary = await runClassifyQueue({
    jobs: pending,
    primary,
    ...(fallback ? { fallback } : {}),
    store: createDbQueueStore(db, now),
    sleep: options.sleep,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.backoffBaseMs !== undefined ? { backoffBaseMs: options.backoffBaseMs } : {}),
    ...(options.failuresBeforeStop !== undefined
      ? { failuresBeforeStop: options.failuresBeforeStop }
      : {}),
  });
  await Promise.all(pendingWrites);

  const pendingAfter = (
    await selectPendingJobs(db, {
      promptVersion: ELIGIBILITY_PROMPT_VERSION,
      model: options.model,
    })
  ).length;
  return {
    ...summary,
    promptVersion: ELIGIBILITY_PROMPT_VERSION,
    model: options.model,
    pendingAfter,
    blockedByEval: null,
  };
}
