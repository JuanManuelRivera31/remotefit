import type { Eligibility } from "./schema.js";

/** ADR 0004 section 4. */
export const LATAM_COUNTRIES: ReadonlySet<string> = new Set(
  "AR BO BR BZ CL CO CR CU DO EC GT GY HN HT MX NI PA PE PY SR SV UY VE".split(" "),
);

/**
 * Whether a classified posting can be applied to from `userCountry` (ISO alpha-2). Pure code, no LLM,
 * computed on read from the stored classification (ADR 0004 section 4).
 */
export function isApplicable(
  result: Pick<Eligibility, "label" | "workModel" | "countries" | "excludedCountries">,
  userCountry: string,
): boolean {
  // `unknown` work model never counts: precision comes first.
  if (result.workModel !== "remote") return false;
  if (result.excludedCountries.includes(userCountry)) return false;
  switch (result.label) {
    case "latam_eligible":
      return LATAM_COUNTRIES.has(userCountry);
    case "worldwide":
      return true;
    case "country_specific":
      return result.countries.includes(userCountry);
    default:
      return false;
  }
}
