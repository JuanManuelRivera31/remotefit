import type { WorkplaceType } from "../normalize/job.js";

/** Bump whenever the text below (or the way the posting is rendered) changes: it is part of the cache key. */
export const ELIGIBILITY_PROMPT_VERSION = "eligibility-v1";

/** Postings can be very long; the eligibility signals are almost always near the top or in a short "location" paragraph. */
export const MAX_DESCRIPTION_CHARS = 20_000;

export const ELIGIBILITY_SYSTEM_PROMPT = `You classify job postings by WHERE the candidate may live and work from. You will be given the title, the location field, the ATS workplace metadata and the description of ONE public job posting. Answer with a single JSON object that follows the provided schema, and nothing else.

LABEL (exactly one):
- latam_eligible: open to the WHOLE Latin America region ("LATAM", "Latin America", "Americas", "AMER", or an Americas-wide time zone). If a few countries are excluded, list them in excludedCountries.
- worldwide: remote with NO country restriction ("worldwide", "work from anywhere").
- us_only: requires living in the United States or US work authorization, or the only location is a US place.
- country_specific: limited to specific countries, inside or outside LATAM (list their ISO codes in countries). If the restriction is a region outside LATAM (e.g. "Europe", "EMEA only") with no named countries, use this label with countries = [].
- onsite_or_hybrid: requires physical presence at an office (including hybrid schedules).
- unclear: the posting does not give enough information.

RULES:
1. Never infer a country or a work-authorization requirement without text that supports it. A bare "Remote", or "San Francisco or Remote", is unclear even if it probably means the US.
2. The posting body wins over the ATS metadata when they disagree: set workModelConflict = true and follow the body.
3. If the title names a country (e.g. "Engineer (Colombia)"), that country wins over a long location list: such lists usually bundle sibling postings for other countries.
4. If you hesitate between a specific label and unclear, answer unclear.
5. latam_eligible and worldwide require workModel = "remote".
6. workModel comes from the body; if the body is silent, use the ATS workplace metadata; otherwise "unknown".
7. countries and excludedCountries contain ISO 3166-1 alpha-2 codes (e.g. CO, MX, BR) and only countries named in the posting.
8. hiringModel: employee, contractor, eor (employer of record) or unknown. requiresUsWorkAuthorization: true / false only if the posting says so, otherwise null. timezoneRequirement: a short phrase such as "Chile hours" or null.
9. seniority and minYearsExperience describe the role; they do not affect eligibility. minYearsExperience is null unless the posting states a number.
10. evidence: 1 or 2 VERBATIM quotes copied exactly from the posting (title, location field or description), each at most 160 characters, that justify the label. Never paraphrase and never invent text. For unclear, quote the location or the ambiguous sentence.
11. Keep every string short. Output the JSON object only: no explanations, no markdown.`;

export interface PromptJob {
  title: string;
  locationRaw: string;
  workplaceType: WorkplaceType | null;
  descriptionText: string;
}

/** The user message: only public text of the posting. Never add profile, CV or personal data here. */
export function buildUserMessage(job: PromptJob): string {
  const description =
    job.descriptionText.length > MAX_DESCRIPTION_CHARS
      ? `${job.descriptionText.slice(0, MAX_DESCRIPTION_CHARS)}\n[description truncated]`
      : job.descriptionText;
  return [
    `TITLE: ${job.title}`,
    `LOCATION: ${job.locationRaw || "(none)"}`,
    `ATS_WORKPLACE_TYPE: ${job.workplaceType ?? "(none)"}`,
    "DESCRIPTION:",
    description,
  ].join("\n");
}

/** Appended on the single retry after an invalid answer. */
export function buildRetryMessage(userMessage: string, problem: string): string {
  return `${userMessage}\n\nYour previous answer was rejected: ${problem}\nAnswer again with ONE valid JSON object that fixes this.`;
}
