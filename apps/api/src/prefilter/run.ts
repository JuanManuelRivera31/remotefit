import { and, eq } from "drizzle-orm";
import {
  PREFILTER_VERSION,
  prefilterJob,
  type PrefilterResult,
  type WorkplaceType,
} from "@remotefit/core";
import type { Db } from "../db/client.js";
import { jobs } from "../db/schema.js";

export interface PrefilterRunSummary {
  version: string;
  evaluated: number;
  /** Rows whose stored result was missing or different (new version, new rules or changed posting). */
  changed: number;
  discarded: number;
  passed: number;
}

function toWorkplaceType(value: string | null): WorkplaceType | null {
  return value === "remote" || value === "hybrid" || value === "onsite" ? value : null;
}

export function toRow(result: PrefilterResult) {
  return {
    prefilterVersion: PREFILTER_VERSION,
    prefilterOutcome: result.outcome,
    prefilterRule: result.outcome === "discarded" ? result.rule : null,
    prefilterRuleKind: result.outcome === "discarded" ? result.kind : null,
    prefilterMatchedText: result.outcome === "discarded" ? result.matchedText : null,
  };
}

/**
 * Applies the pre-filter to every active job and stores version, outcome, rule and matched text.
 * Each job is judged on its own title, location and metadata (siblings are never grouped). Idempotent: only rows whose
 * stored result differs are written, so running it after every ingest also refreshes postings whose location changed.
 */
export async function runPrefilter(db: Db): Promise<PrefilterRunSummary> {
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      locationRaw: jobs.locationRaw,
      workplaceType: jobs.workplaceType,
      descriptionText: jobs.descriptionText,
      version: jobs.prefilterVersion,
      outcome: jobs.prefilterOutcome,
      rule: jobs.prefilterRule,
      kind: jobs.prefilterRuleKind,
      matched: jobs.prefilterMatchedText,
    })
    .from(jobs)
    .where(eq(jobs.isActive, true));

  const summary: PrefilterRunSummary = {
    version: PREFILTER_VERSION,
    evaluated: rows.length,
    changed: 0,
    discarded: 0,
    passed: 0,
  };

  for (const row of rows) {
    const result = prefilterJob({
      title: row.title,
      locationRaw: row.locationRaw ?? "",
      workplaceType: toWorkplaceType(row.workplaceType),
      descriptionText: row.descriptionText,
    });
    if (result.outcome === "discarded") summary.discarded += 1;
    else summary.passed += 1;

    const next = toRow(result);
    const same =
      row.version === next.prefilterVersion &&
      row.outcome === next.prefilterOutcome &&
      row.rule === next.prefilterRule &&
      row.kind === next.prefilterRuleKind &&
      row.matched === next.prefilterMatchedText;
    if (same) continue;
    await db
      .update(jobs)
      .set(next)
      .where(and(eq(jobs.id, row.id)));
    summary.changed += 1;
  }
  return summary;
}
