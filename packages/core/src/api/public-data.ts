// S11: the static JSON the published site downloads once and filters in the browser with listJobs(). Browser-safe.
// What it may contain is fixed here (ADR 0002 / docs/plan-s11.md): title, company, location, link, dates and the
// classification with its short quotes. Never the posting description or an excerpt: the schemas are strict, so an
// extra field fails validation instead of being published.
import { z } from "zod";
import { ELIGIBILITY_LABELS } from "../eligibility/schema.js";
import { COUNTRY_OPTIONS } from "./contract.js";
import { trimEvidence, verdictFor, type ListingRow } from "./listing.js";

/** Longest quote the public file may carry (same cap as the list view). */
export const PUBLIC_QUOTE_MAX = 160;

const isoDate = z.string().datetime({ offset: true });

export const PublicJobSchema = z
  .object({
    id: z.number().int(),
    title: z.string().max(300),
    company: z.string(),
    locationRaw: z.string().nullable(),
    url: z.string().url(),
    siblingGroup: z.string().nullable(),
    postedAt: isoDate.nullable(),
    firstSeenAt: isoDate,
    lastSeenAt: isoDate,
    result: z
      .object({
        label: z.enum(ELIGIBILITY_LABELS),
        countries: z.array(z.string()),
        excludedCountries: z.array(z.string()),
        workModel: z.string(),
        seniority: z.string().nullable(),
        evidence: z.array(z.string().max(PUBLIC_QUOTE_MAX)).max(2),
        status: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
export type PublicJob = z.infer<typeof PublicJobSchema>;

export const PublicDataSchema = z
  .object({
    /** When the daily pipeline wrote the file (ISO). The site warns when it is more than 3 days old. */
    generatedAt: isoDate,
    classifier: z
      .object({ promptVersion: z.string(), postprocessVersion: z.string(), model: z.string() })
      .strict(),
    acceptance: z
      .object({
        state: z.enum(["accepted", "accepted_with_gap", "not_accepted"]),
        decidedAt: z.string().nullable(),
        testSet: z.string().nullable(),
        precision: z.number().nullable(),
        recall: z.number().nullable(),
        precisionCi: z.tuple([z.number(), z.number()]).nullable(),
        recallCi: z.tuple([z.number(), z.number()]).nullable(),
      })
      .strict(),
    measuredCountries: z.array(z.string()),
    pendingClassification: z.number().int().nonnegative(),
    jobs: z.array(PublicJobSchema),
  })
  .strict();
export type PublicData = z.infer<typeof PublicDataSchema>;

/** Days after which the site shows the "datos desactualizados" warning. */
export const STALE_DATA_AFTER_DAYS = 3;

export function dataAgeDays(generatedAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(generatedAt).getTime()) / 86_400_000);
}

const groupKey = (row: ListingRow): string =>
  row.siblingGroup ? `g:${row.siblingGroup}` : `j:${row.id}`;

/**
 * Only vacancies that some selectable country can see are published (every posting of such a vacancy is kept, so the
 * card can list all its countries). A US-only or office-only vacancy is never in the public file.
 */
export function publishableRows(rows: readonly ListingRow[]): ListingRow[] {
  const countries = COUNTRY_OPTIONS.map((c) => c.code);
  const visibleGroups = new Set(
    rows
      .filter((row) => countries.some((country) => verdictFor(row.result, country) !== null))
      .map(groupKey),
  );
  return rows.filter((row) => visibleGroups.has(groupKey(row)));
}

export function toPublicJob(row: ListingRow): PublicJob {
  return PublicJobSchema.parse({
    id: row.id,
    title: row.title,
    company: row.company,
    locationRaw: row.locationRaw,
    url: row.url,
    siblingGroup: row.siblingGroup,
    postedAt: row.postedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    result: {
      label: row.result.label,
      countries: row.result.countries,
      excludedCountries: row.result.excludedCountries,
      workModel: row.result.workModel,
      seniority: row.result.seniority,
      evidence: trimEvidence(row.result.evidence),
      status: row.result.status,
    },
  });
}

/** Back to the rows listJobs() works on, in the browser. */
export function fromPublicJob(job: PublicJob): ListingRow {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    locationRaw: job.locationRaw,
    url: job.url,
    siblingGroup: job.siblingGroup,
    postedAt: job.postedAt ? new Date(job.postedAt) : null,
    firstSeenAt: new Date(job.firstSeenAt),
    lastSeenAt: new Date(job.lastSeenAt),
    result: {
      label: job.result.label,
      countries: job.result.countries,
      excludedCountries: job.result.excludedCountries,
      workModel: job.result.workModel as ListingRow["result"]["workModel"],
      seniority: job.result.seniority,
      evidence: job.result.evidence,
      status: job.result.status,
    },
  };
}
