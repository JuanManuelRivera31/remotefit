import { COUNTRY_ISO_BY_NAME, normalizeText } from "../rules/places.js";
import { atsCountryList, remoteSegmentCountries } from "./location-rules.js";
import type { PromptJob } from "./prompt.js";
import {
  EVIDENCE_MAX_CHARS,
  EligibilitySchema,
  type Eligibility,
  type RawEligibility,
} from "./schema.js";

/**
 * Bump when any deterministic rule below changes. It is part of the key of a stored result
 * (content_hash + prompt_version + model + postprocess_version, see `resultCacheKey`), but NOT of the key of the raw
 * model answer: changing a rule here recomputes results for free, without new LLM calls.
 */
export const POSTPROCESS_VERSION = "postprocess-v3";

/**
 * ok: valid answer with verified evidence (possibly adjusted by the title rule or by trimming a long quote).
 * evidence_unverified: an applicable-capable label whose quotes are not found in the posting -> unclear.
 * fallback_unclear: the model's answer never validated (after one retry) or was blocked -> unclear.
 */
export type ClassifyStatus = "ok" | "evidence_unverified" | "fallback_unclear";

export interface PostprocessOutcome {
  result: Eligibility;
  status: ClassifyStatus;
  /** What the rules did, for reports: "title_country:CO", "evidence_trimmed", "evidence_dropped". */
  notes: string[];
}

/** The stored-result key: a different prompt, model or post-processing version is a different result. */
export function resultCacheKey(parts: {
  contentHash: string;
  promptVersion: string;
  model: string;
  postprocessVersion?: string;
}): string {
  return [
    parts.contentHash,
    parts.promptVersion,
    parts.model,
    parts.postprocessVersion ?? POSTPROCESS_VERSION,
  ].join("|");
}

// --- Rule 1: a country named in the title wins -------------------------------------------------------------------

/** Names that are also ordinary words or US states: never read from a title. */
const AMBIGUOUS_TITLE_NAMES = new Set(["georgia", "jordan"]);
/** Abbreviations only count in capitals ("US", "UK"), never as the lowercase word "us". */
const UPPERCASE_ONLY_NAMES = new Set(["us", "uk", "uae", "usa"]);

const REGION_OR_GLOBAL_IN_TITLE =
  /\b(latam|latin america|latinoamerica|americas|amer|south america|north america|worldwide|global|anywhere)\b/;

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAME_REGEX = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[...COUNTRY_ISO_BY_NAME.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|")})(?![\\p{L}\\p{N}])`,
  "gu",
);

/** Scripts that identify one country by themselves (ADR 0004 labelling guide, pattern 4). Kanji alone is NOT listed: it is also Chinese. */
const TITLE_SCRIPT_COUNTRY: readonly { regex: RegExp; iso: string }[] = [
  { regex: /[぀-ヿ]/u, iso: "JP" },
  { regex: /[가-힯]/u, iso: "KR" },
];

/**
 * ISO codes of the countries a job title names, in order; empty when it also names a region or says "global".
 * A title written in kana or hangul and naming no country points to Japan or South Korea (guide pattern 4).
 */
export function countriesNamedInTitle(title: string): string[] {
  if (REGION_OR_GLOBAL_IN_TITLE.test(normalizeText(title))) return [];
  const named = countriesMentioned(title);
  if (named.length > 0) return named;
  const byScript = TITLE_SCRIPT_COUNTRY.find(({ regex }) => regex.test(title));
  return byScript ? [byScript.iso] : [];
}

/** ISO codes of every country named in a text (title, location...), in order, without any region/global check. */
export function countriesMentioned(title: string): string[] {
  // Match on a lowercase copy but keep the original to check capitalization of abbreviations.
  const normalized = normalizeText(title);
  const found: string[] = [];
  for (const match of normalized.matchAll(NAME_REGEX)) {
    const name = match[1];
    if (!name || AMBIGUOUS_TITLE_NAMES.has(name)) continue;
    // "New Mexico" is a US state, not Mexico.
    if (name === "mexico" && normalized.slice(0, match.index).endsWith("new ")) continue;
    if (
      UPPERCASE_ONLY_NAMES.has(name) &&
      !new RegExp(`\\b${name.toUpperCase().split("").join("\\.?")}\\b`).test(title)
    ) {
      continue;
    }
    const iso = COUNTRY_ISO_BY_NAME.get(name);
    if (iso && !found.includes(iso)) found.push(iso);
  }
  return found;
}

// --- Rule 2: evidence longer than 160 characters -> a literal fragment ---------------------------------------------

const MIN_FRAGMENT_CHARS = 6;

const normalizeForQuote = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’“”"']/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** A quote is verified when every fragment (split at "..." or "…") appears verbatim in the posting text. */
export function isQuoteInSource(quote: string, source: string): boolean {
  const haystack = normalizeForQuote(source);
  const fragments = quote
    .split(/\.{3}|…/)
    .map(normalizeForQuote)
    .filter((fragment) => fragment.length >= MIN_FRAGMENT_CHARS);
  return fragments.length > 0 && fragments.every((fragment) => haystack.includes(fragment));
}

/** Cuts text to at most `max` characters at a word boundary. The result is a literal prefix of the input. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * A quote of at most 160 characters made of text that really is in the posting, or null. A long quote keeps its first
 * literal fragment (cut at a word boundary); a quote that is not in the posting at all is dropped.
 */
function toLiteralFragment(quote: string, sentText: string): string | null {
  const trimmed = quote.trim();
  if (trimmed.length <= EVIDENCE_MAX_CHARS) return trimmed;
  for (const fragment of trimmed.split(/\.{3}|…/)) {
    const candidate = cutAtWord(fragment.trim(), EVIDENCE_MAX_CHARS);
    if (candidate.length >= MIN_FRAGMENT_CHARS && isQuoteInSource(candidate, sentText))
      return candidate;
  }
  return null;
}

// --- Entry points ------------------------------------------------------------------------------------------------

const APPLICABLE_CAPABLE = new Set(["latam_eligible", "worldwide", "country_specific"]);

/** A verifiable quote for results that did not come from a valid model answer: the location, else the title. */
export function fallbackEvidence(job: PromptJob): string {
  return (job.locationRaw.trim() || job.title.trim() || "(no text)").slice(0, EVIDENCE_MAX_CHARS);
}

export function unclearResult(job: PromptJob, base?: RawEligibility | Eligibility): Eligibility {
  return {
    label: "unclear",
    countries: [],
    excludedCountries: [],
    workModel: base?.workModel ?? "unknown",
    workModelConflict: base?.workModelConflict ?? false,
    seniority: base?.seniority ?? "unknown",
    minYearsExperience: base?.minYearsExperience ?? null,
    hiringModel: base?.hiringModel ?? "unknown",
    timezoneRequirement: base?.timezoneRequirement ?? null,
    requiresUsWorkAuthorization: base?.requiresUsWorkAuthorization ?? null,
    postingLanguage: base?.postingLanguage ?? "other",
    evidence: [fallbackEvidence(job)],
  };
}

/**
 * Deterministic rules applied after the model (more reliable than asking the prompt):
 * 1. a country named in the title wins (country_specific with that country), unless the title also names a region or
 *    says global (a title in kana or hangul counts as naming Japan or South Korea); it only reshapes answers that claimed remote eligibility, never us_only/onsite/unclear;
 * 2. quotes longer than 160 characters are cut to a literal fragment; no literal fragment -> the quote is dropped;
 * 3. an applicable-capable label with no quote found in the posting becomes unclear (never applicable without evidence);
 * 4. (v3) a plain list of places in the ATS location beats worldwide / latam_eligible: country_specific with its countries;
 * 5. (v3) in a compound location a country is remote only if its own segment says Remote or the ATS metadata does.
 * `sentText` is exactly the text that was sent to the model, so quotes can be verified against it.
 */
export function postprocess(
  raw: RawEligibility | null,
  job: PromptJob,
  sentText: string,
): PostprocessOutcome {
  if (raw === null) {
    return { result: unclearResult(job), status: "fallback_unclear", notes: [] };
  }
  const notes: string[] = [];

  if (APPLICABLE_CAPABLE.has(raw.label)) {
    const named = countriesNamedInTitle(job.title);
    if (named.length > 0) {
      notes.push(`title_country:${named.join(",")}`);
      const result = EligibilitySchema.parse({
        ...raw,
        label: "country_specific",
        countries: named,
        excludedCountries: [],
        evidence: [job.title.trim().slice(0, EVIDENCE_MAX_CHARS)],
      });
      return { result, status: "ok", notes };
    }
  }

  // Rule 4 (structural): a plain list of places in the ATS location beats a generic "worldwide" / region claim.
  if (raw.label === "worldwide" || raw.label === "latam_eligible") {
    const list = atsCountryList(job.locationRaw);
    if (list) {
      notes.push(`ats_country_list:${list.countries.join(",")}`);
      const result = EligibilitySchema.parse({
        ...raw,
        label: "country_specific",
        countries: list.countries,
        excludedCountries: [],
        evidence: [fallbackEvidence(job)],
      });
      return { result, status: "ok", notes };
    }
  }

  // Rule 5 (structural): in a compound location a country is remote only if its own segment says Remote (or the ATS does).
  if (raw.label === "country_specific" && raw.countries.length > 0) {
    const kept = remoteSegmentCountries(
      job.locationRaw,
      job.workplaceType,
      raw.countries,
      job.descriptionText,
    );
    if (kept !== null) {
      notes.push(`segment_remote:${raw.countries.filter((c) => !kept.includes(c)).join(",")}`);
      if (kept.length === 0) return { result: unclearResult(job, raw), status: "ok", notes };
      raw = { ...raw, countries: kept };
    }
  }

  const quotes: string[] = [];
  for (const quote of raw.evidence) {
    const fragment = toLiteralFragment(quote, sentText);
    if (fragment === null) {
      notes.push("evidence_dropped");
    } else {
      if (fragment !== quote.trim()) notes.push("evidence_trimmed");
      quotes.push(fragment);
    }
  }
  const verified = quotes.filter((quote) => isQuoteInSource(quote, sentText));
  if (APPLICABLE_CAPABLE.has(raw.label) && verified.length === 0) {
    return { result: unclearResult(job, raw), status: "evidence_unverified", notes };
  }
  const evidence = quotes.length > 0 ? quotes.slice(0, 2) : [fallbackEvidence(job)];
  return {
    result: EligibilitySchema.parse({ ...raw, evidence }),
    status: "ok",
    notes,
  };
}
