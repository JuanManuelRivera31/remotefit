import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Mirrors docs/03-modelo-de-datos.md. Columns are snake_case in the database, camelCase here.
const timestampTz = (name: string) => timestamp(name, { withTimezone: true });

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ats: text("ats").notNull(), // greenhouse | lever | ashby
  boardToken: text("board_token").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestampTz("created_at").notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    source: text("source").notNull(), // greenhouse | lever | ashby
    externalId: text("external_id").notNull(),
    requisitionId: text("requisition_id"),
    siblingGroup: text("sibling_group"),
    title: text("title").notNull(),
    locationRaw: text("location_raw"),
    workplaceType: text("workplace_type"), // remote | hybrid | onsite | null
    url: text("url").notNull(),
    descriptionText: text("description_text"),
    raw: jsonb("raw").$type<unknown>(),
    contentHash: text("content_hash").notNull(),
    postedAt: timestampTz("posted_at"),
    firstSeenAt: timestampTz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestampTz("last_seen_at").notNull().defaultNow(),
    closedAt: timestampTz("closed_at"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("jobs_source_external_id_uq").on(table.source, table.externalId),
    index("jobs_is_active_idx").on(table.isActive),
    index("jobs_last_seen_at_idx").on(table.lastSeenAt),
    index("jobs_content_hash_idx").on(table.contentHash),
    index("jobs_sibling_group_idx").on(table.siblingGroup),
  ],
);

// The classification cache. No job_id: jobs with identical content share one result.
export const eligibilityResults = pgTable(
  "eligibility_results",
  {
    id: serial("id").primaryKey(),
    contentHash: text("content_hash").notNull(),
    promptVersion: text("prompt_version").notNull(), // RULES_VERSION when the pre-filter decided
    model: text("model").notNull(), // 'rules' when the pre-filter decided; never null (unique index)
    decidedBy: text("decided_by").notNull(), // rules | llm
    label: text("label").notNull(),
    countries: jsonb("countries").$type<string[]>().notNull().default([]),
    excludedCountries: jsonb("excluded_countries").$type<string[]>().notNull().default([]),
    workModel: text("work_model").notNull(),
    workModelConflict: boolean("work_model_conflict").notNull().default(false),
    seniority: text("seniority"),
    minYearsExperience: integer("min_years_experience"),
    hiringModel: text("hiring_model"),
    timezoneRequirement: text("timezone_requirement"),
    requiresUsWorkAuthorization: boolean("requires_us_work_authorization"),
    postingLanguage: text("posting_language"),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    equivalentCostUsd: numeric("equivalent_cost_usd"),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("eligibility_results_cache_uq").on(
      table.contentHash,
      table.promptVersion,
      table.model,
    ),
  ],
);

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull(),
  country: text("country").notNull(), // ISO 3166-1 alpha-2
  cvText: text("cv_text"), // never sent to an LLM
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  seniority: text("seniority"),
  yearsExperience: integer("years_experience"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestampTz("created_at").notNull().defaultNow(),
});

export const fitResults = pgTable(
  "fit_results",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id),
    scoringVersion: text("scoring_version").notNull(),
    score: integer("score").notNull(), // 0-100
    matchedSkills: jsonb("matched_skills").$type<string[]>().notNull().default([]),
    missingSkills: jsonb("missing_skills").$type<string[]>().notNull().default([]),
    breakdown: jsonb("breakdown").$type<unknown>(),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fit_results_job_profile_version_uq").on(
      table.jobId,
      table.profileId,
      table.scoringVersion,
    ),
  ],
);

// Incremented on every call, retries included. Per model because the daily limit (RPD) is per model.
export const llmUsageDaily = pgTable(
  "llm_usage_daily",
  {
    usageDate: date("usage_date").notNull(), // provider quota day, not the local day
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    requests: integer("requests").notNull().default(0),
    rateLimited: integer("rate_limited").notNull().default(0), // 429 responses
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    equivalentCostUsd: numeric("equivalent_cost_usd").notNull().default("0"),
  },
  (table) => [primaryKey({ columns: [table.usageDate, table.provider, table.model] })],
);
