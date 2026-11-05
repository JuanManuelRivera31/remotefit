// One request counter per model and provider quota day (Pacific), shared by `npm run eval` and `npm run classify`
// (locally, and the daily GitHub Actions run once published: S11). It also holds the "pending eval" reservation: an
// eval run has priority, so classify does not start while one is pending (started and not finished, e.g. stopped by
// the daily quota and waiting for the reset).
// Implementations: SqlQuotaLedger (PostgreSQL, the shared one), FileQuotaLedger (no database), MemoryQuotaLedger (tests).
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
  used(day: string): Promise<number>;
  record(day: string): Promise<void>;
}

export interface QuotaLedger {
  used(model: string, day: string): Promise<number>;
  record(model: string, day: string): Promise<void>;
  counterFor(model: string): SharedQuotaCounter;
  pendingEval(): Promise<PendingEval | null>;
  setPendingEval(pending: PendingEval): Promise<void>;
  clearPendingEval(): Promise<void>;
}

/** Ledger over a whole-state read and write (file or memory). */
abstract class StateQuotaLedger implements QuotaLedger {
  protected abstract readState(): QuotaState;
  protected abstract writeState(state: QuotaState): void;

  async used(model: string, day: string): Promise<number> {
    return usedOn(this.readState(), model, day);
  }

  async record(model: string, day: string): Promise<void> {
    this.writeState(withRequest(this.readState(), model, day));
  }

  counterFor(model: string): SharedQuotaCounter {
    return { used: (day) => this.used(model, day), record: (day) => this.record(model, day) };
  }

  async pendingEval(): Promise<PendingEval | null> {
    return this.readState().pendingEval;
  }

  async setPendingEval(pending: PendingEval): Promise<void> {
    this.writeState({ ...this.readState(), pendingEval: pending });
  }

  async clearPendingEval(): Promise<void> {
    this.writeState({ ...this.readState(), pendingEval: null });
  }
}

/** In-memory ledger for tests. */
export class MemoryQuotaLedger extends StateQuotaLedger {
  constructor(private state: QuotaState = emptyQuotaState()) {
    super();
  }

  protected readState(): QuotaState {
    return this.state;
  }

  protected writeState(state: QuotaState): void {
    this.state = state;
  }
}

/**
 * File-backed ledger (git-ignored JSON), for machines without the database. Every operation re-reads the file, so two
 * processes on the same machine see each other's requests; writes go through a temporary file and a rename.
 */
export class FileQuotaLedger extends StateQuotaLedger {
  private readonly path: string;

  constructor(path: string | URL) {
    super();
    this.path = typeof path === "string" ? path : fileURLToPath(path);
  }

  protected readState(): QuotaState {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return emptyQuotaState();
    }
    // A corrupt ledger must not silently reset the count to 0 (that would overspend the quota): fail loudly.
    return quotaStateSchema.parse(JSON.parse(text) as unknown);
  }

  protected writeState(state: QuotaState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`);
    renameSync(tmp, this.path);
  }
}

/** The subset of `pg.Pool` the SQL ledger needs (injected, so core does not depend on a driver). */
export type SqlRunner = (text: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

const countRow = z.object({ requests: z.coerce.number().int().nonnegative() });
const reservationRow = z.object({ data: pendingEvalSchema });

/**
 * PostgreSQL ledger: the request counter is `llm_usage_daily.requests` (one row per quota day, provider and model,
 * incremented atomically), and the reservation is the single row of `llm_eval_reservation`. Shared by every machine
 * that points at the same database (the local eval and the daily GitHub Actions run).
 */
export class SqlQuotaLedger implements QuotaLedger {
  constructor(
    private readonly run: SqlRunner,
    private readonly provider = "gemini",
  ) {}

  async used(model: string, day: string): Promise<number> {
    const { rows } = await this.run(
      "select requests from llm_usage_daily where usage_date = $1 and provider = $2 and model = $3",
      [day, this.provider, model],
    );
    return rows[0] === undefined ? 0 : countRow.parse(rows[0]).requests;
  }

  async record(model: string, day: string): Promise<void> {
    await this.run(
      "insert into llm_usage_daily (usage_date, provider, model, requests) values ($1, $2, $3, 1) " +
        "on conflict (usage_date, provider, model) do update set requests = llm_usage_daily.requests + 1",
      [day, this.provider, model],
    );
  }

  counterFor(model: string): SharedQuotaCounter {
    return { used: (day) => this.used(model, day), record: (day) => this.record(model, day) };
  }

  async pendingEval(): Promise<PendingEval | null> {
    const { rows } = await this.run("select data from llm_eval_reservation where id = 1", []);
    return rows[0] === undefined ? null : reservationRow.parse(rows[0]).data;
  }

  async setPendingEval(pending: PendingEval): Promise<void> {
    await this.run(
      "insert into llm_eval_reservation (id, data, updated_at) values (1, $1, now()) " +
        "on conflict (id) do update set data = excluded.data, updated_at = now()",
      [JSON.stringify(pendingEvalSchema.parse(pending))],
    );
  }

  async clearPendingEval(): Promise<void> {
    await this.run("delete from llm_eval_reservation where id = 1", []);
  }
}

/** Default file location: data/llm-quota.json at the repo root (git-ignored). */
export const DEFAULT_QUOTA_LEDGER_URL = new URL("../../../../data/llm-quota.json", import.meta.url);
