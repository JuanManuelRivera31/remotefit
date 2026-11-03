import {
  classifyRaw,
  finalizeOutcome,
  type ClassifyOutcome,
  type RawOutcome,
} from "../eligibility/classify.js";
import type { PromptJob } from "../eligibility/prompt.js";
import {
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  type LLMProvider,
  type ThinkingLevel,
} from "../llm/types.js";

/** One posting waiting to be classified. The caller decides the order (new before changed) and dedupes by content_hash. */
export interface QueueJob {
  id: number;
  contentHash: string;
  prompt: PromptJob;
}

/** A model the queue may call. `provider` is expected to be metered (RPM spacing and local RPD) by the caller. */
export interface QueueModel {
  model: string;
  provider: LLMProvider;
  thinkingLevel?: ThinkingLevel;
}

export interface UsageDelta {
  requests?: number;
  rateLimited?: number;
  tokensIn?: number;
  tokensOut?: number;
  equivalentCostUsd?: number;
}

/** Persistence port. The queue never touches a database: the API app implements this with Drizzle. */
export interface QueueStore {
  /** Saves a finished classification under the model that really produced it (never under another model's key). */
  save(entry: {
    job: QueueJob;
    model: string;
    raw: RawOutcome;
    outcome: ClassifyOutcome;
  }): Promise<void>;
  /** Adds to the daily usage of a model (the quota day is the store's concern). */
  recordUsage(model: string, delta: UsageDelta): Promise<void>;
}

export type QueueStopReason =
  | "quota_exhausted" // daily quota of the active model (and the fallback, if any) is used up
  | "provider_unavailable" // sustained 429/5xx/network failures
  | "provider_error"; // non-retryable error (bad key, bad request): needs a human

export type QueueEvent =
  | { kind: "retry"; jobId: number; model: string; waitMs: number; why: "rate_limit" | "transient" }
  | { kind: "job_failed"; jobId: number; model: string }
  | {
      kind: "switched_to_fallback";
      from: string;
      to: string;
      why: "quota_exhausted" | "unavailable";
    }
  | { kind: "stopped"; reason: QueueStopReason; message: string };

export interface QueueOptions {
  jobs: readonly QueueJob[];
  primary: QueueModel;
  /** Only used when set. A fallback result is stored under its own model key and never under the primary's. */
  fallback?: QueueModel;
  store: QueueStore;
  sleep: (ms: number) => Promise<void>;
  /** Attempts per job for 429 and transient errors, the first one included. Default 5. */
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Consecutive jobs that exhausted their attempts before the provider counts as down. Default 3. */
  failuresBeforeStop?: number;
  onEvent?: (event: QueueEvent) => void;
}

export interface QueueSummary {
  total: number;
  classified: number;
  /** Postings that stay pending for the next run (everything not classified). */
  pending: number;
  /** Subset of `pending` that was tried and failed with a transient error. */
  failedJobIds: number[];
  rateLimitedResponses: number;
  classifiedByModel: Record<string, number>;
  usedFallback: boolean;
  stopped: { reason: QueueStopReason; message: string } | null;
}

type Attempt =
  | { kind: "done"; raw: RawOutcome; outcome: ClassifyOutcome }
  | { kind: "quota"; message: string }
  | { kind: "unavailable" }
  | { kind: "fatal"; message: string };

/**
 * Classifies postings one by one, respecting the free-tier pacing, and never loses a posting: whatever is not
 * classified (quota, outage, fatal error) is reported as pending and retried by the next run.
 * - 429 (per minute) and transient errors (5xx, network): exponential backoff, honouring `retryAfterMs`.
 * - Daily quota exhausted: stop (or switch to the fallback model when one was given).
 * - `failuresBeforeStop` consecutive postings that exhaust their attempts: the provider is down; switch or stop.
 * Quota and network errors never become an `unclear` result; only a model answer that never validates does.
 */
export async function runClassifyQueue(options: QueueOptions): Promise<QueueSummary> {
  const maxAttempts = options.maxAttempts ?? 5;
  const base = options.backoffBaseMs ?? 5_000;
  const cap = options.backoffMaxMs ?? 120_000;
  const failuresBeforeStop = options.failuresBeforeStop ?? 3;
  const emit = options.onEvent ?? (() => undefined);

  let active = options.primary;
  let usedFallback = false;
  let consecutiveFailures = 0;
  let rateLimited = 0;
  let classified = 0;
  const byModel: Record<string, number> = {};
  const failedJobIds: number[] = [];
  let stopped: QueueSummary["stopped"] = null;

  const stop = (reason: QueueStopReason, message: string): void => {
    stopped = { reason, message };
    emit({ kind: "stopped", reason, message });
  };

  /** Switches to the fallback once; false when there is none or it is already in use. */
  const switchToFallback = (why: "quota_exhausted" | "unavailable"): boolean => {
    if (!options.fallback || usedFallback) return false;
    emit({ kind: "switched_to_fallback", from: active.model, to: options.fallback.model, why });
    active = options.fallback;
    usedFallback = true;
    consecutiveFailures = 0;
    return true;
  };

  const attempt = async (job: QueueJob, model: QueueModel): Promise<Attempt> => {
    for (let n = 1; n <= maxAttempts; n += 1) {
      try {
        const raw = await classifyRaw(model.provider, job.prompt, {
          model: model.model,
          ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}),
        });
        return { kind: "done", raw, outcome: finalizeOutcome(raw, job.prompt) };
      } catch (error) {
        if (error instanceof QuotaExhaustedError) return { kind: "quota", message: error.message };
        const backoff = Math.min(cap, base * 2 ** (n - 1));
        if (error instanceof RateLimitError) {
          rateLimited += 1;
          await options.store.recordUsage(model.model, { rateLimited: 1 });
          if (n === maxAttempts) return { kind: "unavailable" };
          const waitMs = Math.max(backoff, error.retryAfterMs ?? 0);
          emit({ kind: "retry", jobId: job.id, model: model.model, waitMs, why: "rate_limit" });
          await options.sleep(waitMs);
        } else if (error instanceof ProviderError && error.retryable) {
          if (n === maxAttempts) return { kind: "unavailable" };
          emit({
            kind: "retry",
            jobId: job.id,
            model: model.model,
            waitMs: backoff,
            why: "transient",
          });
          await options.sleep(backoff);
        } else {
          return { kind: "fatal", message: error instanceof Error ? error.message : String(error) };
        }
      }
    }
    return { kind: "unavailable" };
  };

  // Postings that failed in the current streak; they are retried on the fallback if we switch to it.
  let streak: QueueJob[] = [];
  const todo = [...options.jobs];
  while (todo.length > 0 && !stopped) {
    const job = todo.shift() as QueueJob;
    const result = await attempt(job, active);
    if (result.kind === "done") {
      await options.store.save({
        job,
        model: active.model,
        raw: result.raw,
        outcome: result.outcome,
      });
      await options.store.recordUsage(active.model, {
        tokensIn: result.outcome.usage.inputTokens,
        tokensOut: result.outcome.usage.outputTokens + result.outcome.usage.thinkingTokens,
        equivalentCostUsd: result.outcome.usage.equivalentCostUsd,
      });
      classified += 1;
      byModel[active.model] = (byModel[active.model] ?? 0) + 1;
      consecutiveFailures = 0;
      streak = [];
    } else if (result.kind === "quota") {
      if (switchToFallback("quota_exhausted")) todo.unshift(job);
      else stop("quota_exhausted", result.message);
    } else if (result.kind === "fatal") {
      stop("provider_error", result.message);
    } else {
      // Sustained transient failure of this posting: it stays pending unless the fallback takes it.
      failedJobIds.push(job.id);
      streak.push(job);
      emit({ kind: "job_failed", jobId: job.id, model: active.model });
      consecutiveFailures += 1;
      if (consecutiveFailures >= failuresBeforeStop) {
        if (switchToFallback("unavailable")) {
          const retried = new Set(streak.map((item) => item.id));
          for (let i = failedJobIds.length - 1; i >= 0; i -= 1) {
            if (retried.has(failedJobIds[i] as number)) failedJobIds.splice(i, 1);
          }
          todo.unshift(...streak);
          streak = [];
        } else {
          stop(
            "provider_unavailable",
            `${consecutiveFailures} postings in a row failed after ${maxAttempts} attempts`,
          );
        }
      }
    }
  }

  return {
    total: options.jobs.length,
    classified,
    pending: options.jobs.length - classified,
    failedJobIds,
    rateLimitedResponses: rateLimited,
    classifiedByModel: byModel,
    usedFallback,
    stopped,
  };
}
