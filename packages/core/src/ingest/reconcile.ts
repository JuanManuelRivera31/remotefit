import type { FetchJobsResult } from "../ats/http.js";

export interface StoredJobState {
  externalId: string;
  closedAt: Date | null;
}

export interface ReconcilePlan {
  /** Open in the database but absent from a healthy board response: mark closed (never delete). */
  toClose: string[];
  /** Closed in the database but listed again: reopen. */
  toReopen: string[];
  /** Why nothing was closed even though the board was reached, if that is the case. */
  skippedClosure: "board_not_found" | "empty_board" | null;
}

/**
 * Decides which stored postings to close or reopen after listing a board.
 * A board that failed never reaches this function (the connector throws), so a failure closes nothing.
 * We also refuse to close anything on `not_found` or on an empty list when postings are open:
 * a renamed board token or a glitchy empty response must not wipe a company's jobs.
 */
export function reconcileBoard(
  stored: readonly StoredJobState[],
  result: FetchJobsResult<{ externalId: string }>,
): ReconcilePlan {
  if (result.status === "not_found") {
    return { toClose: [], toReopen: [], skippedClosure: "board_not_found" };
  }
  const listed = new Set(result.jobs.map((job) => job.externalId));
  const open = stored.filter((job) => job.closedAt === null);
  const toReopen = stored
    .filter((job) => job.closedAt !== null && listed.has(job.externalId))
    .map((job) => job.externalId);
  if (listed.size === 0 && open.length > 0) {
    return { toClose: [], toReopen, skippedClosure: "empty_board" };
  }
  const toClose = open.filter((job) => !listed.has(job.externalId)).map((job) => job.externalId);
  return { toClose, toReopen, skippedClosure: null };
}
