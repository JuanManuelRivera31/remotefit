// One request counter per model and provider quota day (Pacific), shared by `npm run eval` and `npm run classify`.
// Before this, the eval counted in a JSON file and classify in llm_usage_daily, and the two never added up.
// The ledger also holds the "pending eval" reservation: an eval run has priority, so classify does not start while one
// is pending (started and not finished, e.g. stopped by the daily quota and waiting for the reset).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const pendingEvalSchema = z.object({
  split: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  postprocessVersion: z.string(),
  /** Cases still without a cached answer when the reservation was last updated. */
  remaining: z.number().int().nonnegative(),
  since: z.string(),
});
export type PendingEval = z.infer<typeof pendingEvalSchema>;

export const quotaStateSchema = z.object({
  usage: z.record(
    z.string(),
    z.object({ day: z.string(), requests: z.number().int().nonnegative() }),
  ),
  pendingEval: pendingEvalSchema.nullable(),
});
export type QuotaState = z.infer<typeof quotaStateSchema>;

export const emptyQuotaState = (): QuotaState => ({ usage: {}, pendingEval: null });

/** Requests already made for `model` on quota day `day` (a count from another day is stale: 0). */
export function usedOn(state: QuotaState, model: string, day: string): number {
  const entry = state.usage[model];
  return entry && entry.day === day ? entry.requests : 0;
}

/** New state with one more request for `model` on `day` (a new day restarts the count). */
export function withRequest(state: QuotaState, model: string, day: string): QuotaState {
  return {
    ...state,
    usage: { ...state.usage, [model]: { day, requests: usedOn(state, model, day) + 1 } },
  };
}

/** The per-model view MeteredProvider needs: read the shared count, add one request. */
export interface SharedQuotaCounter {
  used(day: string): number;
  record(day: string): void;
}

/** Ledger operations over a whole-state read and write; subclasses decide where the state lives. */
export abstract class QuotaLedger {
  abstract read(): QuotaState;
  protected abstract write(state: QuotaState): void;

  used(model: string, day: string): number {
    return usedOn(this.read(), model, day);
  }

  record(model: string, day: string): void {
    this.write(withRequest(this.read(), model, day));
  }

  counterFor(model: string): SharedQuotaCounter {
    return { used: (day) => this.used(model, day), record: (day) => this.record(model, day) };
  }

  pendingEval(): PendingEval | null {
    return this.read().pendingEval;
  }

  setPendingEval(pending: PendingEval): void {
    this.write({ ...this.read(), pendingEval: pending });
  }

  clearPendingEval(): void {
    this.write({ ...this.read(), pendingEval: null });
  }
}

/** In-memory ledger for tests (and for callers that share one process). */
export class MemoryQuotaLedger extends QuotaLedger {
  constructor(private state: QuotaState = emptyQuotaState()) {
    super();
  }

  read(): QuotaState {
    return this.state;
  }

  protected write(state: QuotaState): void {
    this.state = state;
  }
}

/**
 * File-backed ledger (git-ignored JSON). Every operation re-reads the file, so two processes on the same machine see
 * each other's requests; writes go through a temporary file and a rename so a crash never leaves half a file.
 * When the pipeline is deployed, a database-backed ledger with the same methods replaces this one.
 */
export class FileQuotaLedger extends QuotaLedger {
  private readonly path: string;

  constructor(path: string | URL) {
    super();
    this.path = typeof path === "string" ? path : fileURLToPath(path);
  }

  read(): QuotaState {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return emptyQuotaState();
    }
    // A corrupt ledger must not silently reset the count to 0 (that would overspend the quota): fail loudly.
    return quotaStateSchema.parse(JSON.parse(text) as unknown);
  }

  protected write(state: QuotaState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 1)}
`);
    renameSync(tmp, this.path);
  }
}

/** Default location: data/llm-quota.json at the repo root (git-ignored). */
export const DEFAULT_QUOTA_LEDGER_URL = new URL("../../../../data/llm-quota.json", import.meta.url);
