// Database edge of S9: loads active postings with the classification of the classifier in use. The decision of what a
// user sees is made in code by the pure listing functions of @remotefit/core (same isApplicable as the eval).
import { and, eq, ne, notInArray } from "drizzle-orm";
import type { ClassifierKey, ListingResult, ListingRow } from "@remotefit/core";
import type { Db } from "../db/client.js";
import { companies, eligibilityResults, jobs } from "../db/schema.js";
import { countPendingJobs } from "../classify/store.js";

/** Labels that can never be shown (clearly not applicable from any LATAM country); SQL drops them early. */
const NEVER_SHOWN = ["us_only", "onsite_or_hybrid"];

const columns = {
  id: jobs.id,
  title: jobs.title,
  company: companies.name,
  locationRaw: jobs.locationRaw,
  url: jobs.url,
  siblingGroup: jobs.siblingGroup,
  postedAt: jobs.postedAt,
  firstSeenAt: jobs.firstSeenAt,
  lastSeenAt: jobs.lastSeenAt,
  label: eligibilityResults.label,
  countries: eligibilityResults.countries,
  excludedCountries: eligibilityResults.excludedCountries,
  workModel: eligibilityResults.workModel,
  seniority: eligibilityResults.seniority,
  evidence: eligibilityResults.evidence,
  status: eligibilityResults.status,
};

interface Selected {
  id: number;
  title: string;
  company: string;
  locationRaw: string | null;
  url: string;
  siblingGroup: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  label: string;
  countries: string[];
  excludedCountries: string[];
  workModel: string;
  seniority: string | null;
  evidence: string[];
  status: string | null;
}

function toRow(r: Selected): ListingRow {
  const result: ListingResult = {
    label: r.label as ListingResult["label"],
    countries: r.countries,
    excludedCountries: r.excludedCountries,
    workModel: r.workModel as ListingResult["workModel"],
    seniority: r.seniority,
    evidence: r.evidence,
    status: r.status,
  };
  return {
    id: r.id,
    title: r.title,
    company: r.company,
    locationRaw: r.locationRaw,
    url: r.url,
    siblingGroup: r.siblingGroup,
    postedAt: r.postedAt,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    result,
  };
}

const resultJoin = (key: ClassifierKey) =>
  and(
    eq(eligibilityResults.contentHash, jobs.contentHash),
    eq(eligibilityResults.promptVersion, key.promptVersion),
    eq(eligibilityResults.model, key.model),
    eq(eligibilityResults.postprocessVersion, key.postprocessVersion),
  );

const listable = and(eq(jobs.isActive, true), eq(jobs.prefilterOutcome, "pass"));

/** Every active posting with a result of the classifier in use, minus the labels that are never shown. */
export async function loadListingRows(db: Db, key: ClassifierKey): Promise<ListingRow[]> {
  const rows = await db
    .select(columns)
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .innerJoin(eligibilityResults, resultJoin(key))
    .where(and(listable, notInArray(eligibilityResults.label, NEVER_SHOWN)));
  return rows.map(toRow);
}

export interface LoadedJob {
  row: ListingRow;
  descriptionText: string | null;
  provenance: {
    promptVersion: string;
    model: string;
    postprocessVersion: string | null;
    status: string | null;
    classifiedAt: string;
  };
  siblings: ListingRow[];
}

/** One active posting with its result and its active siblings (with results); null when absent or closed. */
export async function loadJob(db: Db, id: number, key: ClassifierKey): Promise<LoadedJob | null> {
  const [found] = await db
    .select({
      ...columns,
      descriptionText: jobs.descriptionText,
      promptVersion: eligibilityResults.promptVersion,
      model: eligibilityResults.model,
      postprocessVersion: eligibilityResults.postprocessVersion,
      createdAt: eligibilityResults.createdAt,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .innerJoin(eligibilityResults, resultJoin(key))
    .where(and(listable, eq(jobs.id, id)));
  if (!found) return null;

  const siblings = found.siblingGroup
    ? (
        await db
          .select(columns)
          .from(jobs)
          .innerJoin(companies, eq(companies.id, jobs.companyId))
          .innerJoin(eligibilityResults, resultJoin(key))
          .where(and(listable, eq(jobs.siblingGroup, found.siblingGroup), ne(jobs.id, id)))
      ).map(toRow)
    : [];

  return {
    row: toRow(found),
    descriptionText: found.descriptionText,
    provenance: {
      promptVersion: found.promptVersion,
      model: found.model,
      postprocessVersion: found.postprocessVersion,
      status: found.status,
      classifiedAt: found.createdAt.toISOString(),
    },
    siblings,
  };
}

/** Postings still waiting for the classifier in use (pre-filter passed, no result for this prompt and model). */
export async function countPendingClassification(db: Db, key: ClassifierKey): Promise<number> {
  return countPendingJobs(db, { promptVersion: key.promptVersion, model: key.model });
}

