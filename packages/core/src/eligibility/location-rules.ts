import {
  COUNTRY_ISO_BY_NAME,
  NON_LATAM_CITIES,
  NON_LATAM_REGIONS,
  NON_LATAM_SUBDIVISIONS,
  normalizeText,
} from "../rules/places.js";

// Structural rules over the ATS location field (postprocess-v3). The location field is how the ATS builds the posting
// (often "Country, Remote | Country | ..." where each "|" segment is a sibling vacancy), so these rules read it with
// code instead of asking the model to interpret it. Pure functions, no I/O.

const REMOTE_WORD = /\b(remote|remoto|remota|teletrabajo|home ?based|work from home)\b/;
/** Words that make a segment a region or a global statement (so the segment is NOT a plain list of places). */
const REGION_OR_GLOBAL =
  /\b(worldwide|global|globally|anywhere|latam|latin america|latinoamerica|americas|amer|north america|south america|central america|caribbean|international|emea\/latam)\b/;
const NOISE_WORDS =
  /\b(remote|remoto|remota|hybrid|onsite|on-site|office based|home based|based|office|hq)\b|\[|\]|\(|\)|-/g;

export interface LocationSegment {
  /** Normalized text of the segment ("mexico, remote"). */
  text: string;
  hasRemoteWord: boolean;
  hasRegionOrGlobal: boolean;
  /** ISO codes of the countries the segment names. */
  countries: string[];
  /** True when every part of the segment is a country, a known non-LATAM city/state/region, or only noise words. */
  allKnownPlaces: boolean;
  /** True when the segment has no place at all (just "Remote"). */
  empty: boolean;
}

/** Tokens left over when a known place is written with punctuation ("Washington, D.C." -> washington + dc). */
const PLACE_SUFFIXES: ReadonlySet<string> = new Set(["dc"]);

function isKnownPlace(part: string): boolean {
  return (
    PLACE_SUFFIXES.has(part) ||
    COUNTRY_ISO_BY_NAME.has(part) ||
    NON_LATAM_CITIES.has(part) ||
    NON_LATAM_SUBDIVISIONS.has(part) ||
    NON_LATAM_REGIONS.has(part)
  );
}

export function parseLocationSegments(locationRaw: string): LocationSegment[] {
  return locationRaw
    .split(/\||;/)
    .map((raw) => normalizeText(raw))
    .filter((text) => text !== "")
    .map((text) => {
      const parts = text
        .replace(NOISE_WORDS, ",")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
      const countries = parts.flatMap((part) => {
        const iso = COUNTRY_ISO_BY_NAME.get(part);
        return iso ? [iso] : [];
      });
      return {
        text,
        hasRemoteWord: REMOTE_WORD.test(text),
        hasRegionOrGlobal: REGION_OR_GLOBAL.test(text),
        countries,
        allKnownPlaces: parts.length > 0 && parts.every(isKnownPlace),
        empty: parts.length === 0,
      };
    });
}

/**
 * Rule "ats_country_list": when the ATS location field is a plain list of places (countries, cities, non-LATAM regions;
 * no worldwide/LATAM/Americas wording), a model answer of worldwide or latam_eligible is replaced by country_specific
 * with the countries the list names. A generic "can be executed globally" in the text does not beat a list the ATS built
 * for this posting (ADR 0004, guide rule 7; evidence: ElevenLabs lists vary per posting and the phrase is boilerplate).
 * Returns null when the rule does not apply.
 */
export function atsCountryList(locationRaw: string): { countries: string[] } | null {
  const segments = parseLocationSegments(locationRaw).filter((s) => !s.empty);
  if (segments.length === 0) return null;
  if (segments.some((s) => s.hasRegionOrGlobal || !s.allKnownPlaces)) return null;
  const countries = [...new Set(segments.flatMap((s) => s.countries))];
  return { countries };
}

/**
 * Rule "segment_remote": in a compound location ("Brazil, Remote | Bogota, Colombia") each "|" segment is a sibling
 * vacancy. A country only counts as remote when its own segment says Remote, or the ATS metadata says remote. Returns
 * the countries to keep, or null when the rule does not apply (single segment, nothing says Remote, metadata is remote,
 * or no country would be dropped).
 */
export function remoteSegmentCountries(
  locationRaw: string,
  workplaceType: string | null,
  modelCountries: readonly string[],
  descriptionText = "",
): string[] | null {
  if (workplaceType === "remote") return null;
  // A posting-level remote tag in the body (recruiters add "#LI-remote") backs every listed country.
  if (/#li-remote/i.test(descriptionText)) return null;
  // The body's own "Location: Remote, Brazil, Colombia" line backs the countries it names.
  const bodyRemote = new Set<string>();
  for (const line of descriptionText.split("\n")) {
    if (!/^\s*location\s*:/i.test(line) || !REMOTE_WORD.test(normalizeText(line))) continue;
    for (const part of normalizeText(line).replace(NOISE_WORDS, ",").split(/[,:]/)) {
      const iso = COUNTRY_ISO_BY_NAME.get(part.trim());
      if (iso) bodyRemote.add(iso);
    }
  }
  const segments = parseLocationSegments(locationRaw).filter((s) => !s.empty);
  if (segments.length < 2 || !segments.some((s) => s.hasRemoteWord)) return null;
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const iso of modelCountries) {
    const naming = segments.filter((s) => s.countries.includes(iso));
    if (naming.length === 0 || bodyRemote.has(iso) || naming.some((s) => s.hasRemoteWord))
      kept.push(iso);
    else dropped.push(iso);
  }
  return dropped.length > 0 ? kept : null;
}
