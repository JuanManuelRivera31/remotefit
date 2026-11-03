import { z } from "zod";

export const ELIGIBILITY_LABELS = [
  "latam_eligible",
  "worldwide",
  "us_only",
  "country_specific",
  "onsite_or_hybrid",
  "unclear",
] as const;
export type EligibilityLabel = (typeof ELIGIBILITY_LABELS)[number];

const CountryCode = z.string().regex(/^[A-Z]{2}$/); // ISO 3166-1 alpha-2

/** Contract of the classifier output (docs/02 section 5, taxonomy in ADR 0004). */
export const EligibilitySchema = z
  .object({
    label: z.enum(ELIGIBILITY_LABELS),
    countries: z.array(CountryCode),
    excludedCountries: z.array(CountryCode),
    workModel: z.enum(["remote", "hybrid", "onsite", "unknown"]),
    workModelConflict: z.boolean(),
    seniority: z.enum(["intern", "junior", "mid", "senior", "lead_or_above", "unknown"]),
    minYearsExperience: z.number().int().min(0).nullable(),
    hiringModel: z.enum(["employee", "contractor", "eor", "unknown"]),
    timezoneRequirement: z.string().max(60).nullable(),
    requiresUsWorkAuthorization: z.boolean().nullable(),
    postingLanguage: z.enum(["en", "es", "pt", "other"]),
    evidence: z.array(z.string().min(1).max(160)).min(1).max(2), // verbatim quotes from the posting
  })
  .superRefine((value, ctx) => {
    // ADR 0004 section 3: latam_eligible and worldwide imply workModel = remote.
    if (
      (value.label === "latam_eligible" || value.label === "worldwide") &&
      value.workModel !== "remote"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["workModel"],
        message: `label "${value.label}" requires workModel "remote"; use "unclear" or "onsite_or_hybrid" otherwise`,
      });
    }
  });
export type Eligibility = z.infer<typeof EligibilitySchema>;
