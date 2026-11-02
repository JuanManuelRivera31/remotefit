import type { WorkplaceType } from "../normalize/job.js";
import {
  LATAM_ISO2,
  LATAM_TERMS,
  LOCATION_FILLER,
  NON_LATAM_CITIES,
  NON_LATAM_COUNTRIES,
  NON_LATAM_REGIONS,
  NON_LATAM_SUBDIVISIONS,
  normalizeText,
} from "./places.js";

/**
 * Bump when any rule, pattern or vocabulary changes: stored results carry this version so they can be recomputed.
 * The pre-filter only discards; it never labels a posting as applicable (that is the classifier's job).
 */
export const PREFILTER_VERSION = "prefilter-v1";

export const PREFILTER_RULES = [
  "non_latam_location",
  "onsite_or_hybrid_metadata",
  "non_tech_role",
] as const;
export type PrefilterRule = (typeof PREFILTER_RULES)[number];

export interface PrefilterInput {
  title: string;
  locationRaw: string;
  workplaceType: WorkplaceType | null;
  /** Optional. Only used by the body guard: strong remote/LATAM phrases make the posting pass. */
  descriptionText?: string | null;
}

export interface RuleHit {
  rule: PrefilterRule;
  /** The text that fired the rule (kept short; stored for audit). */
  matchedText: string;
}

export type PrefilterResult =
  { outcome: "pass" } | { outcome: "discarded"; rule: PrefilterRule; matchedText: string };

const MAX_MATCHED_TEXT = 200;
const clip = (text: string): string =>
  text.length > MAX_MATCHED_TEXT ? `${text.slice(0, MAX_MATCHED_TEXT - 1)}…` : text;

// ---------------------------------------------------------------------------------------------
// Signals that make a posting pass
// ---------------------------------------------------------------------------------------------

const REMOTE_SIGNAL =
  /\b(remote|remotely|remoto|remota|remotos|anywhere|worldwide|global|distributed|home ?based|home-based|wfh|work from home|virtual|telecommut\w*|teletrabaj\w*|telework\w*|trabajo en casa|desde casa|a distancia)\b|リモート/;

const REGION_SIGNAL =
  /\b(latam|latin america|latinoamerica|americas|amer|south america|north america|sudamerica|central america|centroamerica|caribbean)\b/;

// Body guard: strong, unambiguous phrases only (boilerplate like "remote work stipend" must not count).
const BODY_REMOTE_PHRASE =
  /\b((fully|100%|completely|entirely) remote|remote[- ](first|only)|work from anywhere|work anywhere|anywhere in the world|remote (position|role|opportunity|job)|this (role|position|job) is remote)\b/;
const BODY_REGION_PHRASE = /\b(latin america|latam|latinoamerica)\b/;

const LATAM_TERM_REGEX = new RegExp(
  `\\b(${[...LATAM_TERMS].map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
);

function bodyGuard(description: string | null | undefined, includeRegion: boolean): string | null {
  if (!description) return null;
  const body = normalizeText(description);
  const remote = BODY_REMOTE_PHRASE.exec(body);
  if (remote) return remote[0];
  if (includeRegion) return BODY_REGION_PHRASE.exec(body)?.[0] ?? null;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rule 1 — location only in places known to be outside LATAM, with no mention of remote
// ---------------------------------------------------------------------------------------------

/** Longest-match tokenization of one comma/slash-separated piece into known places ("london uk" -> london + uk). */
function isKnownPlace(token: string): "city" | "other" | null {
  if (NON_LATAM_CITIES.has(token)) return "city";
  if (
    NON_LATAM_COUNTRIES.has(token) ||
    NON_LATAM_REGIONS.has(token) ||
    NON_LATAM_SUBDIVISIONS.has(token) ||
    LOCATION_FILLER.has(token)
  ) {
    return "other";
  }
  return null;
}

/** True when every word of the token is covered by known places; returns whether the last piece was a city. */
function coverToken(token: string): { ok: boolean; lastWasCity: boolean } {
  const direct = isKnownPlace(token);
  if (direct) return { ok: true, lastWasCity: direct === "city" };
  const words = token.split(" ");
  if (words.length < 2) return { ok: false, lastWasCity: false };
  let index = 0;
  let lastWasCity = false;
  while (index < words.length) {
    let matched = false;
    for (let size = Math.min(3, words.length - index); size >= 1; size -= 1) {
      const kind = isKnownPlace(words.slice(index, index + size).join(" "));
      if (kind) {
        lastWasCity = kind === "city";
        index += size;
        matched = true;
        break;
      }
    }
    if (!matched) return { ok: false, lastWasCity: false };
  }
  return { ok: true, lastWasCity };
}

const SEGMENT_SPLIT = /\s*\|\s*|;/;
const TOKEN_SPLIT = /,|\/|\(|\)|\[|\]|\s-\s|\s-$|^-\s/;

function nonLatamLocation(input: PrefilterInput): RuleHit | null {
  const location = normalizeText(input.locationRaw);
  if (location === "") return null;
  // Any hint of remote work or of the region, anywhere (title, metadata, location), means "not unequivocal".
  if (input.workplaceType === "remote") return null;
  const title = normalizeText(input.title);
  for (const text of [location, title]) {
    if (REMOTE_SIGNAL.test(text) || REGION_SIGNAL.test(text) || LATAM_TERM_REGEX.test(text)) {
      return null;
    }
  }

  let recognized = 0;
  for (const segment of location.split(SEGMENT_SPLIT)) {
    let previousWasCity = false;
    for (const rawToken of segment.split(TOKEN_SPLIT)) {
      const token = rawToken.trim();
      if (token === "") continue;
      const covered = coverToken(token);
      if (covered.ok) {
        recognized += 1;
        previousWasCity = covered.lastWasCity;
        continue;
      }
      // "Toronto, ON" / "Austin, TX": a two-letter code right after a known non-LATAM city is a state or province,
      // unless it is also the ISO code of a LATAM country ("Denver, CO" stays ambiguous and passes).
      if (/^[a-z]{2}$/.test(token) && previousWasCity && !LATAM_ISO2.has(token)) {
        previousWasCity = false;
        continue;
      }
      return null; // unknown token: when in doubt, pass
    }
  }
  if (recognized === 0) return null;
  return { rule: "non_latam_location", matchedText: clip(input.locationRaw.trim()) };
}

// ---------------------------------------------------------------------------------------------
// Rule 2 — ATS metadata says onsite/hybrid and nothing in title or locations contradicts it
// ---------------------------------------------------------------------------------------------

function onsiteOrHybridMetadata(input: PrefilterInput): RuleHit | null {
  if (input.workplaceType !== "onsite" && input.workplaceType !== "hybrid") return null;
  for (const text of [normalizeText(input.title), normalizeText(input.locationRaw)]) {
    if (REMOTE_SIGNAL.test(text) || REGION_SIGNAL.test(text)) return null;
  }
  return {
    rule: "onsite_or_hybrid_metadata",
    matchedText: clip(`workplaceType=${input.workplaceType}`),
  };
}

// ---------------------------------------------------------------------------------------------
// Rule 3 — role clearly outside the MVP scope (the product is for developers)
// ---------------------------------------------------------------------------------------------

/** Explicit list of clearly non-technical roles. Anything not matching is unknown and passes. */
const NON_TECH_ROLE_PATTERNS: readonly RegExp[] = [
  // Sales and account management
  /\b(account executives?|ejecutiv[oa]s? de cuentas?|executiv[oa]s? de vendas|account managers?|key account|sales|sdr|bdr|business development representative|representante de desarrollo de ventas|representant du developpement des ventes|ventas)\b/,
  // Recruiting
  /\b(recruiters?|recruiting|talent acquisition|reclutador\w*)\b/,
  // Legal
  /\b(legal|counsel|lawyer|attorney|paralegal|abogad[oa])\b/,
  // Finance and accounting
  /\b(accountants?|accounting|accounts (payable|receivable)|payroll|nomina|treasury|bookkeep\w*|financial controller|controller|fp&a|financial planning|finance|direct tax|indirect tax|tax (senior|associate|manager|lead|accountant|specialist))\b/,
  // People / HR
  /\b(hr|hrbp|human resources|people partner|gestion humana|talento humano|total rewards|compensation & benefits|organisational development)\b/,
  // Marketing
  /\b(marketing (manager|lead|associate|intern|specialist)|marketer|content marketing|growth marketing|product marketing|partner marketing|field marketing|social media manager|marketing and communications|communications specialist)\b/,
  // Customer-facing support
  /\b(customer success|customer happiness|customer service|support agent|agente de servicio|agente de atencion)\b/,
  // Office
  /\b(office manager|executive assistant|administrative assistant|workplace operations)\b/,
];

/** Any of these in the title means "might be a developer role": never discard. */
const TECH_TITLE_WORDS =
  /\b(engineers?|engineering|engenheir\w*|ingenier\w*|developers?|desarrollador\w*|desenvolvedor\w*|software|data|ml|ai|qa|sdet|devops|sre|architects?|technical|technolog\w*|tech|it|security|platform|backend|back-end|frontend|front-end|full-?stack|mobile|systems?|infrastructure|cloud|analytics|automation|programm\w*|scientists?|analyst|analysts|dynamics|crm|api|salesforce|netsuite|linux|open source|code)\b/;

function nonTechRole(input: PrefilterInput): RuleHit | null {
  const title = normalizeText(input.title);
  if (TECH_TITLE_WORDS.test(title)) return null;
  for (const pattern of NON_TECH_ROLE_PATTERNS) {
    const found = pattern.exec(title);
    if (found) return { rule: "non_tech_role", matchedText: clip(found[0]) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

/**
 * Every rule that fires for this posting (after the body guard), in rule order. Used by the report to split the
 * savings per rule; `prefilterJob` keeps only the first.
 */
export function evaluatePrefilterRules(input: PrefilterInput): RuleHit[] {
  const hits: RuleHit[] = [];
  const locationHit = nonLatamLocation(input);
  if (locationHit && bodyGuard(input.descriptionText, true) === null) hits.push(locationHit);
  const metadataHit = onsiteOrHybridMetadata(input);
  if (metadataHit && bodyGuard(input.descriptionText, false) === null) hits.push(metadataHit);
  const roleHit = nonTechRole(input);
  if (roleHit) hits.push(roleHit);
  return hits;
}

/** Pure, per posting (never per sibling group): each offer is judged with its own title, location and metadata. */
export function prefilterJob(input: PrefilterInput): PrefilterResult {
  const first = evaluatePrefilterRules(input)[0];
  if (!first) return { outcome: "pass" };
  return { outcome: "discarded", rule: first.rule, matchedText: first.matchedText };
}
