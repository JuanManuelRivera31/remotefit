import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assignSiblingGroups,
  connectors as realConnectors,
  reconcileBoard,
  type AtsConnector,
  type AtsName,
  type NormalizedJob,
} from "@remotefit/core";
import type { Db } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";

export const companyEntrySchema = z.object({
  name: z.string().min(1),
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  boardToken: z.string().min(1),
  active: z.boolean(),
  /** Classified after every other company (e.g. a board that repeats the same role per country). */
  classifyLast: z.boolean().optional(),
});
export const companiesFileSchema = z.object({ companies: z.array(companyEntrySchema) });
export type CompanyEntry = z.infer<typeof companyEntrySchema>;

export interface BoardSummary {
  company: string;
  status: "ok" | "not_found" | "error" | "inactive";
  fetched: number;
  inserted: number;
  updated: number;
  closed: number;
  reopened: number;
  skippedJobs: number;
  note?: string;
}

export interface IngestOptions {
  connectors?: Record<AtsName, AtsConnector>;
  /** Pause between board requests, to be polite to the ATS. */
  pauseMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const CHUNK = 100;
const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** Upserts every active company's board, closes postings that disappeared, reopens returning ones. */
export async function runIngest(
  db: Db,
  entries: readonly CompanyEntry[],
  options: IngestOptions = {},
): Promise<BoardSummary[]> {
  const connectors = options.connectors ?? realConnectors;
  const pauseMs = options.pauseMs ?? 1000;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const summaries: BoardSummary[] = [];
  let requested = false;

  for (const entry of entries) {
    const summary: BoardSummary = {
      company: entry.name,
      status: "ok",
      fetched: 0,
      inserted: 0,
      updated: 0,
      closed: 0,
      reopened: 0,
      skippedJobs: 0,
    };
    summaries.push(summary);
    if (!entry.active) {
      summary.status = "inactive";
      continue;
    }
    if (requested) await sleep(pauseMs);
    requested = true;

    const connector = connectors[entry.ats];
    let result;
    try {
      result = await connector.fetchJobs(entry.boardToken);
    } catch (error) {
      // A board failure must never close anything: we simply do not touch this company.
      summary.status = "error";
      summary.note = error instanceof Error ? error.message : String(error);
      continue;
    }

    if (result.status === "not_found") {
      summary.status = "not_found";
      summary.note = "Board not found (404); nothing was closed.";
      continue;
    }

    const companyId = await upsertCompany(db, entry);
    const storedRows = await db
      .select({ externalId: jobs.externalId, closedAt: jobs.closedAt })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId), eq(jobs.source, entry.ats)));

    const normalized: NormalizedJob[] = [];
    for (const raw of result.jobs) {
      try {
        normalized.push(
          connector.toNormalizedJob(raw, { name: entry.name, boardToken: entry.boardToken }),
        );
      } catch {
        summary.skippedJobs += 1;
      }
    }
    summary.fetched = normalized.length;

    const plan = reconcileBoard(storedRows, { status: "ok", jobs: normalized });
    // If some postings could not be read we cannot know which ids are listed: close nothing.
    const toClose = summary.skippedJobs > 0 ? [] : plan.toClose;
    if (plan.skippedClosure === "empty_board") {
      summary.note = "Board returned no postings; nothing was closed.";
    }
    if (summary.skippedJobs > 0) {
      summary.note = `${summary.skippedJobs} posting(s) unreadable; nothing was closed.`;
    }

    const storedIds = new Set(storedRows.map((row) => row.externalId));
    const groups = assignSiblingGroups(normalized);
    const timestamp = now();

    await db.transaction(async (tx) => {
      for (let start = 0; start < normalized.length; start += CHUNK) {
        const slice = normalized.slice(start, start + CHUNK);
        await tx
          .insert(jobs)
          .values(
            slice.map((job, i) => ({
              companyId,
              source: job.source,
              externalId: job.externalId,
              requisitionId: job.requisitionId,
              siblingGroup: groups[start + i] ?? null,
              title: job.title,
              locationRaw: job.locationRaw,
              workplaceType: job.workplaceType,
              url: job.url,
              descriptionText: job.descriptionText,
              raw: job.raw,
              contentHash: job.contentHash,
              postedAt: job.postedAt,
              firstSeenAt: timestamp,
              lastSeenAt: timestamp,
              closedAt: null,
              isActive: true,
            })),
          )
          .onConflictDoUpdate({
            target: [jobs.source, jobs.externalId],
            set: {
              requisitionId: excluded("requisition_id"),
              siblingGroup: excluded("sibling_group"),
              title: excluded("title"),
              locationRaw: excluded("location_raw"),
              workplaceType: excluded("workplace_type"),
              url: excluded("url"),
              descriptionText: excluded("description_text"),
              raw: excluded("raw"),
              contentHash: excluded("content_hash"),
              postedAt: excluded("posted_at"),
              lastSeenAt: timestamp,
              closedAt: null,
              isActive: true,
            },
          });
      }
      if (toClose.length > 0) {
        await tx
          .update(jobs)
          .set({ closedAt: timestamp, isActive: false })
          .where(
            and(
              eq(jobs.companyId, companyId),
              eq(jobs.source, entry.ats),
              inArray(jobs.externalId, toClose),
            ),
          );
      }
    });

    summary.inserted = normalized.filter((job) => !storedIds.has(job.externalId)).length;
    summary.updated = normalized.length - summary.inserted;
    summary.closed = toClose.length;
    summary.reopened = plan.toReopen.length;
  }
  return summaries;
}

async function upsertCompany(db: Db, entry: CompanyEntry): Promise<number> {
  const existing = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.ats, entry.ats), eq(companies.boardToken, entry.boardToken)))
    .limit(1);
  const found = existing[0];
  if (found) {
    await db
      .update(companies)
      .set({ name: entry.name, active: entry.active })
      .where(eq(companies.id, found.id));
    return found.id;
  }
  const inserted = await db
    .insert(companies)
    .values({
      name: entry.name,
      ats: entry.ats,
      boardToken: entry.boardToken,
      active: entry.active,
    })
    .returning({ id: companies.id });
  const row = inserted[0];
  if (!row) throw new Error(`Could not insert company ${entry.name}`);
  return row.id;
}

export function formatSummary(summaries: readonly BoardSummary[]): string {
  const lines = summaries.map((s) => {
    const head = `${s.company.padEnd(14)} ${s.status.padEnd(9)}`;
    if (s.status === "inactive") return `${head} (skipped)`;
    const counts =
      s.status === "ok"
        ? `fetched ${s.fetched} · new ${s.inserted} · updated ${s.updated} · closed ${s.closed} · reopened ${s.reopened}`
        : "";
    return `${head} ${counts}${s.note ? ` ${s.note}` : ""}`.trimEnd();
  });
  const total = (key: "inserted" | "closed" | "reopened") =>
    summaries.reduce((sum, s) => sum + s[key], 0);
  const problems = summaries.filter((s) => s.status === "error" || s.status === "not_found").length;
  lines.push(
    `Total: new ${total("inserted")} · closed ${total("closed")} · reopened ${total("reopened")} · boards with problems ${problems}`,
  );
  return lines.join("\n");
}
