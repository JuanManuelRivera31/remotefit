import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import {
  POSTPROCESS_VERSION,
  buildUserMessage,
  quotaDay,
  type QueueJob,
  type QueueStore,
  type UsageDelta,
  type WorkplaceType,
} from "@remotefit/core";
import type { Db } from "../db/client.js";
import { companies, eligibilityResults, jobs, llmUsageDaily } from "../db/schema.js";

export const LLM_PROVIDER_NAME = "gemini";

function toWorkplaceType(value: string | null): WorkplaceType | null {
  return value === "remote" || value === "hybrid" || value === "onsite" ? value : null;
}

/**
 * Active postings that passed the rules pre-filter and have no stored result for (content_hash, prompt_version, model).
 * Postings with identical content share one result, so each content_hash appears once. Newest first: postings seen for
 * the first time (new or with changed content) go before older ones that are merely missing a result.
 * Companies in `lastBoardTokens` (`classifyLast` in data/companies.json) go after every other company, so a board that
 * publishes hundreds of copies of the same role does not hold back the rest of the directory.
 */
export async function selectPendingJobs(
  db: Db,
  key: { promptVersion: string; model: string },
  limit?: number,
  order: { lastBoardTokens?: readonly string[] } = {},
): Promise<QueueJob[]> {
  const last = order.lastBoardTokens ?? [];
  const priority =
    last.length > 0
      ? [sql`case when ${inArray(companies.boardToken, [...last])} then 1 else 0 end`]
      : [];
  const rows = await db
    .select({
      id: jobs.id,
      contentHash: jobs.contentHash,
      title: jobs.title,
      locationRaw: jobs.locationRaw,
      workplaceType: jobs.workplaceType,
      descriptionText: jobs.descriptionText,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(jobs.isActive, true),
        eq(jobs.prefilterOutcome, "pass"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(eligibilityResults)
            .where(
              and(
                eq(eligibilityResults.contentHash, jobs.contentHash),
                eq(eligibilityResults.promptVersion, key.promptVersion),
                eq(eligibilityResults.model, key.model),
              ),
            ),
        ),
      ),
    )
    .orderBy(...priority, sql`${jobs.firstSeenAt} desc`, sql`${jobs.id} desc`);

  const seen = new Set<string>();
  const queue: QueueJob[] = [];
  for (const row of rows) {
    if (seen.has(row.contentHash)) continue;
    seen.add(row.contentHash);
    queue.push({
      id: row.id,
      contentHash: row.contentHash,
      prompt: {
        title: row.title,
        locationRaw: row.locationRaw ?? "",
        workplaceType: toWorkplaceType(row.workplaceType),
        descriptionText: row.descriptionText ?? "",
      },
    });
  }
  return limit === undefined ? queue : queue.slice(0, limit);
}

/** How many postings of the queue could be classified right now (for the "pending" report). */
export async function countPendingJobs(
  db: Db,
  key: { promptVersion: string; model: string },
): Promise<number> {
  return (await selectPendingJobs(db, key)).length;
}

/** Pending postings per company, in queue order (for the backlog report). */
export async function pendingByCompany(
  db: Db,
  key: { promptVersion: string; model: string },
  order: { lastBoardTokens?: readonly string[] } = {},
): Promise<{ company: string; pending: number }[]> {
  const queue = await selectPendingJobs(db, key, undefined, order);
  const rows = await db
    .select({ id: jobs.id, company: companies.name })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId));
  const nameOf = new Map(rows.map((r) => [r.id, r.company]));
  const counts = new Map<string, number>();
  for (const job of queue) {
    const name = nameOf.get(job.id) ?? "?";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([company, pending]) => ({ company, pending }));
}

/** Requests already counted today for a model, so the limiter survives between runs. */
/** Adds to llm_usage_daily (per quota day and model). Atomic: safe if two processes ever run together. */
export async function addUsage(db: Db, model: string, delta: UsageDelta, now: Date): Promise<void> {
  const values = {
    requests: delta.requests ?? 0,
    rateLimited: delta.rateLimited ?? 0,
    tokensIn: delta.tokensIn ?? 0,
    tokensOut: delta.tokensOut ?? 0,
    equivalentCostUsd: String(delta.equivalentCostUsd ?? 0),
  };
  await db
    .insert(llmUsageDaily)
    .values({ usageDate: quotaDay(now), provider: LLM_PROVIDER_NAME, model, ...values })
    .onConflictDoUpdate({
      target: [llmUsageDaily.usageDate, llmUsageDaily.provider, llmUsageDaily.model],
      set: {
        requests: sql`${llmUsageDaily.requests} + ${values.requests}`,
        rateLimited: sql`${llmUsageDaily.rateLimited} + ${values.rateLimited}`,
        tokensIn: sql`${llmUsageDaily.tokensIn} + ${values.tokensIn}`,
        tokensOut: sql`${llmUsageDaily.tokensOut} + ${values.tokensOut}`,
        equivalentCostUsd: sql`${llmUsageDaily.equivalentCostUsd} + ${values.equivalentCostUsd}::numeric`,
      },
    });
}

/** The queue's persistence port, backed by eligibility_results and llm_usage_daily. */
export function createDbQueueStore(db: Db, now: () => Date = () => new Date()): QueueStore {
  return {
    async save({ job, model, raw, outcome }) {
      const result = outcome.result;
      const values = {
        contentHash: job.contentHash,
        promptVersion: outcome.promptVersion,
        model,
        decidedBy: "llm",
        label: result.label,
        countries: result.countries,
        excludedCountries: result.excludedCountries,
        workModel: result.workModel,
        workModelConflict: result.workModelConflict,
        seniority: result.seniority,
        minYearsExperience: result.minYearsExperience,
        hiringModel: result.hiringModel,
        timezoneRequirement: result.timezoneRequirement,
        requiresUsWorkAuthorization: result.requiresUsWorkAuthorization,
        postingLanguage: result.postingLanguage,
        evidence: result.evidence,
        tokensIn: outcome.usage.inputTokens,
        tokensOut: outcome.usage.outputTokens + outcome.usage.thinkingTokens,
        equivalentCostUsd: String(outcome.usage.equivalentCostUsd),
        postprocessVersion: outcome.postprocessVersion ?? POSTPROCESS_VERSION,
        status: outcome.status,
        rawOutput: raw.raw,
      };
      await db
        .insert(eligibilityResults)
        .values(values)
        .onConflictDoUpdate({
          target: [
            eligibilityResults.contentHash,
            eligibilityResults.promptVersion,
            eligibilityResults.model,
          ],
          set: values,
        });
    },
    async recordUsage(model, delta) {
      await addUsage(db, model, delta, now());
    },
  };
}

/** The exact text the model receives for a posting (used by tests and by the dry run). */
export function promptTextFor(job: QueueJob): string {
  return buildUserMessage(job.prompt);
}
