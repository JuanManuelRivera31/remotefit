// Pure listing logic for S9: which postings a user from a country sees, grouped and filtered. No I/O.
// The API loads rows from the database and calls these functions; the same `isApplicable` as the eval decides.
import { isApplicable } from "../eligibility/applicable.js";
import { parseLocationSegments } from "../eligibility/location-rules.js";
import type { Eligibility, EligibilityLabel } from "../eligibility/schema.js";
import {
  STALE_AFTER_DAYS,
  type Excerpt,
  type JobSummary,
  type JobsPage,
  type JobsQuery,
  type SeniorityFilter,
  type Verdict,
} from "./contract.js";

const DAY_MS = 86_400_000;
const EVIDENCE_LIMIT = 2;
const EVIDENCE_CHARS = 160;

/** What a stored classification contributes to the listing. */
export type ListingResult = Pick<
  Eligibility,
  "label" | "countries" | "excludedCountries" | "workModel"
> & {
  seniority: string | null;
  evidence: string[];
  status: string | null;
};

/** One active posting with its classification, as the API loads it. */
export interface ListingRow {
  id: number;
  title: string;
  company: string;
  locationRaw: string | null;
  url: string;
  siblingGroup: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  result: ListingResult;
}

/**
 * - `applicable`: `isApplicable` says yes (the measured decision).
 * - `unconfirmed`: the classifier could not decide (label `unclear`, or a label that would apply but the work model is
 *   unknown). Shown only on request, marked "sin confirmar".
 * - `null`: not for this country (or explicitly excluded); never shown.
 */
export function verdictFor(result: ListingResult, country: string): Verdict | null {
  if (isApplicable(result, country)) return "applicable";
  if (result.excludedCountries.includes(country)) return null;
  if (result.label === "unclear") return "unconfirmed";
  if (result.workModel === "unknown" && isApplicable({ ...result, workModel: "remote" }, country)) {
    return "unconfirmed";
  }
  return null;
}

/** Age in whole days from the publication date (or, when the ATS gives none, the first time we saw it). */
export function ageInDays(postedAt: Date | null, firstSeenAt: Date, now: Date): number {
  const from = (postedAt ?? firstSeenAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - from) / DAY_MS));
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function trimEvidence(evidence: readonly string[]): string[] {
  return evidence
    .filter((e) => e.trim())
    .slice(0, EVIDENCE_LIMIT)
    .map((e) => clip(e, EVIDENCE_CHARS));
}

const SENIORITY_VALUES: ReadonlySet<string> = new Set([
  "intern",
  "junior",
  "mid",
  "senior",
  "lead_or_above",
]);

/** The classifier's estimated level; anything else (null, "unknown") is the "sin dato" bucket. */
export function seniorityOf(result: ListingResult): SeniorityFilter | null {
  return result.seniority && SENIORITY_VALUES.has(result.seniority)
    ? (result.seniority as SeniorityFilter)
    : null;
}

/** Lowercase without accents, so "méxico" finds "Mexico". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * About `radius` characters on each side of the first occurrence of `quote` in `text` (case and spacing insensitive).
 * Null when the quote is not in the text (e.g. it comes from the title or location).
 */
export function excerptAround(text: string, quote: string, radius = 200): Excerpt | null {
  const needle = quote.replace(/\s+/g, " ").trim();
  if (!needle) return null;
  // Build a flexible pattern: any run of whitespace in the quote matches any run of whitespace in the text.
  const pattern = needle
    .split(" ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const found = new RegExp(pattern, "i").exec(text);
  if (!found) return null;
  const start = found.index;
  const end = start + found[0].length;
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const squash = (s: string) => s.replace(/\s+/g, " ");
  return {
    before: (from > 0 ? "…" : "") + squash(text.slice(from, start)).trimStart(),
    match: squash(found[0]),
    after: squash(text.slice(end, to)).trimEnd() + (to < text.length ? "…" : ""),
  };
}

/**
 * Countries a posting is for, read from its ATS location ("Lima, Peru" -> PE); when the location names none, the
 * countries of a country_specific result. Used to list the countries of a vacancy, not to decide eligibility.
 */
export function postingCountries(row: Pick<ListingRow, "locationRaw" | "result">): string[] {
  const fromLocation = parseLocationSegments(row.locationRaw ?? "").flatMap((s) => s.countries);
  if (fromLocation.length > 0) return [...new Set(fromLocation)];
  return row.result.label === "country_specific" ? [...row.result.countries] : [];
}

interface Visible {
  row: ListingRow;
  verdict: Verdict;
  ageDays: number;
}

const groupKey = (row: ListingRow): string =>
  row.siblingGroup ? `g:${row.siblingGroup}` : `j:${row.id}`;

/** `members` is the whole vacancy (this posting included), visible for the user's country or not. */
function toSummary(item: Visible, members: readonly ListingRow[]): JobSummary {
  const { row, verdict, ageDays } = item;
  const others = members.filter((s) => s.id !== row.id);
  const groupCountries = [...new Set([row, ...others].flatMap(postingCountries))].sort();
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.locationRaw,
    url: row.url,
    verdict,
    label: row.result.label as EligibilityLabel,
    workModel: row.result.workModel,
    countries: row.result.countries,
    seniority: seniorityOf(row.result),
    ageDays,
    stale: ageDays > STALE_AFTER_DAYS,
    lastVerifiedAt: row.lastSeenAt.toISOString(),
    evidence: trimEvidence(row.result.evidence),
    siblingCount: others.length,
    siblingLocations: [
      ...new Set(others.map((s) => s.locationRaw).filter((l): l is string => !!l)),
    ],
    groupCountries,
  };
}

function matches(item: Visible, query: JobsQuery): boolean {
  const { row } = item;
  if (query.maxAgeDays !== undefined && item.ageDays > query.maxAgeDays) return false;
  if (query.company && fold(row.company) !== fold(query.company)) return false;
  if (query.seniority.length > 0) {
    const level = seniorityOf(row.result) ?? "unknown";
    if (!query.seniority.includes(level)) return false;
  }
  if (query.q) {
    const haystack = fold(`${row.title} ${row.company} ${row.locationRaw ?? ""}`);
    if (
      !fold(query.q)
        .split(/\s+/)
        .every((word) => haystack.includes(word))
    )
      return false;
  }
  return true;
}

/**
 * The listing for one country: applicable postings (and unconfirmed ones on request), one card per sibling group
 * (the newest visible posting represents the group), filtered, applicable first and then newest first, paginated.
 */
export function listJobs(rows: readonly ListingRow[], query: JobsQuery, now: Date): JobsPage {
  // A vacancy (sibling group) is one card. It is shown when at least one of its postings is visible for the country;
  // its country list covers every posting of the group, so the user sees where else the same role is open.
  const groups = new Map<string, ListingRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const inUserCountry = (row: ListingRow) => postingCountries(row).includes(query.country);
  // Cards: applicable first, then newest first.
  const order = (a: Visible, b: Visible): number =>
    (a.verdict === b.verdict ? 0 : a.verdict === "applicable" ? -1 : 1) ||
    a.ageDays - b.ageDays ||
    b.row.id - a.row.id;
  // Inside a vacancy: the posting located in the user's country leads (its link is the one to apply to).
  const headOrder = (a: Visible, b: Visible): number =>
    (a.verdict === b.verdict ? 0 : a.verdict === "applicable" ? -1 : 1) ||
    Number(inUserCountry(b.row)) - Number(inUserCountry(a.row)) ||
    order(a, b);

  const representatives: { head: Visible; members: ListingRow[] }[] = [];
  for (const members of groups.values()) {
    const visible: Visible[] = [];
    for (const row of members) {
      const verdict = verdictFor(row.result, query.country);
      if (verdict !== null) {
        visible.push({ row, verdict, ageDays: ageInDays(row.postedAt, row.firstSeenAt, now) });
      }
    }
    // The head is the best visible posting: applicable, located in the user's country, then the newest.
    const head = visible.sort(headOrder)[0];
    if (head) representatives.push({ head, members });
  }

  const counts = { applicable: 0, unconfirmed: 0 };
  for (const { head } of representatives) counts[head.verdict] += 1;
  const companies = [...new Set(representatives.map((r) => r.head.row.company))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );

  const filtered = representatives
    .filter(({ head }) => query.showUnconfirmed || head.verdict === "applicable")
    .filter(({ head }) => matches(head, query))
    .sort((a, b) => order(a.head, b.head));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered
      .slice(start, start + query.pageSize)
      .map(({ head, members }) => toSummary(head, members)),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    counts,
    companies,
  };
}

/** Summary of one posting for the detail view (its whole vacancy as siblings); null when not visible for the country. */
export function summarizeOne(
  row: ListingRow,
  siblings: readonly ListingRow[],
  country: string,
  now: Date,
): JobSummary | null {
  const verdict = verdictFor(row.result, country);
  if (verdict === null) return null;
  return toSummary({ row, verdict, ageDays: ageInDays(row.postedAt, row.firstSeenAt, now) }, [
    row,
    ...siblings.filter((s) => s.id !== row.id),
  ]);
}
