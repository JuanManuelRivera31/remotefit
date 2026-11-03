import type { WorkplaceType } from "../normalize/job.js";

/** Bump whenever the text below (or the way the posting is rendered) changes: it is part of the cache key. */
export const ELIGIBILITY_PROMPT_VERSION = "eligibility-v4";

/** Postings can be very long; the eligibility signals are almost always near the top or in a short "location" paragraph. */
export const MAX_DESCRIPTION_CHARS = 20_000;

export const ELIGIBILITY_SYSTEM_PROMPT = `You classify job postings by WHERE the candidate may live and work from. You will be given the title, the location field, the ATS workplace metadata and the description of ONE public job posting. Answer with a single JSON object that follows the provided schema, and nothing else.

LABEL (exactly one):
- latam_eligible: open to the WHOLE Latin America region. The posting must use a REGION word to say who can apply: "LATAM", "Latin America", "Americas", "AMER", "North and South America", or an Americas-wide time zone. A list of countries is NOT a region (rule 4). If the posting names several regions and Latin America is one of them (e.g. "EMEA, LATAM or North America"), it is still latam_eligible. If a few countries are excluded, list them in excludedCountries.
- worldwide: remote with NO country restriction, stated explicitly ("work from anywhere", "anywhere in the world", "worldwide"). Vague words such as "global team", "can be executed globally", "distributed" or "remote-first" describe the team or the work, not who may apply, and are NOT enough (rule 5).
- us_only: requires living in the United States or US work authorization, or the only location is a US place.
- country_specific: limited to specific countries, inside or outside LATAM; list their ISO codes in countries. A list of countries ("Mexico, Brazil, Argentina") is country_specific with ALL of them, even if every one is in Latin America. If the restriction is a region outside LATAM (e.g. "Europe", "EMEA only") with no named countries, use this label with countries = [].
- onsite_or_hybrid: requires physical presence at an office, including hybrid schedules (office days per week or month).
- unclear: the posting does not give enough information.

RULES:
1. Never infer a country or a work-authorization requirement without text that supports it. A bare "Remote", or "San Francisco or Remote", is unclear even if it probably means the US.
2. The posting body wins over the ATS metadata when they disagree: set workModelConflict = true and follow the body.
3. If the title names a country (e.g. "Engineer (Colombia)"), that country wins over a long location list: such lists usually bundle sibling postings for other countries. Answer country_specific with that country, unless the title also says LATAM, Americas or global.
4. A list of countries is not a region. Use latam_eligible only when the posting itself uses a region word for who may apply, not when you merely notice that several listed countries are in Latin America.
5. "Globally", "distributed", "global team" or "remote-first" without naming countries or a region is not enough to choose worldwide or latam_eligible. Use the location field and the rest of the posting; if the location field lists specific countries, answer country_specific with them; if nothing settles it, answer unclear.
6. If you hesitate between a specific label and unclear, answer unclear.
7. latam_eligible and worldwide require workModel = "remote".
8. workModel comes from the body; if the body is silent, use the ATS workplace metadata; otherwise "unknown". If workModel is hybrid or onsite, the label is onsite_or_hybrid.
8b. Hybrid beats remote-sounding phrases. If the ATS metadata says hybrid, or the body says the company is "committed to hybrid work" or describes a hybrid policy, and the role has an assigned city or office, the label is onsite_or_hybrid even when the same posting also says "remote-first" or lists "remote work from anywhere" among the benefits (a benefit is not the work model of this role). Set workModelConflict = true when the metadata and the body disagree.
8c. Where the company's TEAM lives is not who may apply. "We are distributed across North and South America", "our team is global" or "remote-first" describe the company. If the location field lists only places in one country (for example US cities), the label is country_specific with that country, not latam_eligible.
9. countries and excludedCountries contain ISO 3166-1 alpha-2 codes (e.g. CO, MX, BR) and only countries named in the posting.
10. hiringModel: employee, contractor, eor (employer of record) or unknown. requiresUsWorkAuthorization: true / false only if the posting says so, otherwise null. timezoneRequirement: a short phrase such as "Chile hours" or null.
11. seniority and minYearsExperience describe the role; they do not affect eligibility. minYearsExperience is null unless the posting states a number.
12. evidence: 1 or 2 VERBATIM quotes copied exactly from the posting (title, location field or description). Each quote is the SHORTEST phrase that justifies the label: a few words up to one sentence, never more than 160 characters. Never quote a whole list of locations: quote only the part that matters. Never paraphrase and never invent text. For unclear, quote the location or the ambiguous sentence.
13. Keep every string short. Output the JSON object only: no explanations, no markdown.`;

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
