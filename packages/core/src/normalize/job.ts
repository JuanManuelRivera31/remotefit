import { createHash } from "node:crypto";

export const ATS_NAMES = ["greenhouse", "lever", "ashby"] as const;
export type AtsName = (typeof ATS_NAMES)[number];

export type WorkplaceType = "remote" | "hybrid" | "onsite";

/** Company entry as listed in data/companies.json. */
export interface CompanyRef {
  name: string;
  boardToken: string;
}

/** ATS-independent job posting. Mirrors the `jobs` table of docs/03 (minus ingestion bookkeeping). */
export interface NormalizedJob {
  source: AtsName;
  companyName: string;
  boardToken: string;
  externalId: string;
  /** Requisition id as exposed by the ATS; null when it does not publish one. */
  requisitionId: string | null;
  title: string;
  locationRaw: string;
  /** Workplace type from the ATS metadata; null when the ATS does not say. */
  workplaceType: WorkplaceType | null;
  url: string;
  descriptionText: string;
  postedAt: Date | null;
  /** Original ATS object, kept untouched. */
  raw: unknown;
  contentHash: string;
}

/** sha256 over title + location + description: a change in any of them means the posting must be re-classified. */
export function computeContentHash(parts: {
  title: string;
  locationRaw: string;
  descriptionText: string;
}): string {
  return createHash("sha256")
    .update([parts.title, parts.locationRaw, parts.descriptionText].join("\n"))
    .digest("hex");
}

export function parseWorkplaceType(value: string | null | undefined): WorkplaceType | null {
  switch (value?.trim().toLowerCase()) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "onsite":
    case "on-site":
    case "on_site":
      return "onsite";
    default:
      return null;
  }
}

export function parseDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
