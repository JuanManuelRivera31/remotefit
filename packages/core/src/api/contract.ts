// S9 contract shared by apps/api and apps/web. Browser-safe: only zod, no Node modules.
import { z } from "zod";
import { ELIGIBILITY_LABELS } from "../eligibility/schema.js";

/** The only country whose precision is measured (the eval labels are for Colombia). Others show "sin medir". */
export const MEASURED_COUNTRIES: readonly string[] = ["CO"];
export const DEFAULT_COUNTRY = "CO";

/** Selectable countries (Latin America, ADR 0004), Colombia first. Names in Spanish for the UI. */
export const COUNTRY_OPTIONS: readonly { code: string; name: string }[] = [
  { code: "CO", name: "Colombia" },
  { code: "AR", name: "Argentina" },
  { code: "BO", name: "Bolivia" },
  { code: "BR", name: "Brasil" },
  { code: "CL", name: "Chile" },
  { code: "CR", name: "Costa Rica" },
  { code: "EC", name: "Ecuador" },
  { code: "SV", name: "El Salvador" },
  { code: "GT", name: "Guatemala" },
  { code: "HN", name: "Honduras" },
  { code: "MX", name: "México" },
  { code: "NI", name: "Nicaragua" },
  { code: "PA", name: "Panamá" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Perú" },
  { code: "DO", name: "República Dominicana" },
  { code: "UY", name: "Uruguay" },
  { code: "VE", name: "Venezuela" },
];

export const SENIORITY_FILTERS = [
  "intern",
  "junior",
  "mid",
  "senior",
  "lead_or_above",
  "unknown",
] as const;
export type SeniorityFilter = (typeof SENIORITY_FILTERS)[number];

/** Postings older than this get the "más de 180 días" badge. */
export const STALE_AFTER_DAYS = 180;
export const DEFAULT_PAGE_SIZE = 30;

const truthy = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === "1" || value === "true");

const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(",")).map((s) => s.trim()).filter(Boolean),
  );

export const JobsQuerySchema = z.object({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default(DEFAULT_COUNTRY),
  seniority: stringList.pipe(z.array(z.enum(SENIORITY_FILTERS))).default([]),
  maxAgeDays: z.coerce.number().int().positive().max(3650).optional(),
  company: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  /** Postings the classifier could not confirm (label `unclear` or unknown work model). Hidden by default. */
  showUnconfirmed: truthy.default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});
export type JobsQuery = z.infer<typeof JobsQuerySchema>;
export type JobsQueryInput = z.input<typeof JobsQuerySchema>;

export const VerdictSchema = z.enum(["applicable", "unconfirmed"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const JobSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  url: z.string(),
  verdict: VerdictSchema,
  label: z.enum(ELIGIBILITY_LABELS),
  workModel: z.string(),
  countries: z.array(z.string()),
  /** Estimated by the classifier; not evaluated. Null = no data. */
  seniority: z.enum(SENIORITY_FILTERS).nullable(),
  ageDays: z.number().int().nonnegative(),
  stale: z.boolean(),
  /** Last time the daily ingest saw the posting active on its ATS board (ISO). */
  lastVerifiedAt: z.string(),
  /** Quotes that justify the verdict (at most 2, at most 160 characters each). */
  evidence: z.array(z.string()),
  /** Other postings of the same vacancy (one card per sibling group). */
  siblingCount: z.number().int().nonnegative(),
  siblingLocations: z.array(z.string()),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobsPageSchema = z.object({
  items: z.array(JobSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  counts: z.object({ applicable: z.number().int(), unconfirmed: z.number().int() }),
  companies: z.array(z.string()),
});
export type JobsPage = z.infer<typeof JobsPageSchema>;

export const ExcerptSchema = z.object({ before: z.string(), match: z.string(), after: z.string() });
export type Excerpt = z.infer<typeof ExcerptSchema>;

export const JobDetailSchema = JobSummarySchema.extend({
  /** About 400 characters of the posting around the first quote, never the whole posting (ADR 0002). */
  excerpt: ExcerptSchema.nullable(),
  siblings: z.array(
    z.object({ id: z.number().int(), location: z.string().nullable(), url: z.string() }),
  ),
  provenance: z.object({
    promptVersion: z.string(),
    model: z.string(),
    postprocessVersion: z.string().nullable(),
    status: z.string().nullable(),
    classifiedAt: z.string(),
  }),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

export const ApiStatusSchema = z.object({
  classifier: z.object({
    promptVersion: z.string(),
    postprocessVersion: z.string(),
    model: z.string(),
  }),
  acceptance: z.object({
    state: z.enum(["accepted", "accepted_with_gap", "not_accepted"]),
    decidedAt: z.string().nullable(),
    testSet: z.string().nullable(),
    precision: z.number().nullable(),
    recall: z.number().nullable(),
  }),
  measuredCountries: z.array(z.string()),
  /** Active postings that passed the pre-filter and still have no result for the classifier in use. */
  pendingClassification: z.number().int().nonnegative(),
});
export type ApiStatus = z.infer<typeof ApiStatusSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
