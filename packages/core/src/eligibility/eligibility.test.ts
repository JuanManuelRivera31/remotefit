import { describe, expect, it } from "vitest";
import { FakeLLMProvider } from "../llm/fake.js";
import { ProviderError, QuotaExhaustedError, RateLimitError } from "../llm/types.js";
import { isApplicable, LATAM_COUNTRIES } from "./applicable.js";
import { classifyJob } from "./classify.js";
import { isQuoteInSource } from "./postprocess.js";
import {
  ELIGIBILITY_PROMPT_VERSION,
  ELIGIBILITY_SYSTEM_PROMPT,
  MAX_DESCRIPTION_CHARS,
  buildUserMessage,
} from "./prompt.js";
import { ELIGIBILITY_LABELS, EligibilitySchema, type Eligibility } from "./schema.js";

const valid = (overrides: Partial<Eligibility> = {}): Eligibility => ({
  label: "country_specific",
  countries: ["CO"],
  excludedCountries: [],
  workModel: "remote",
  workModelConflict: false,
  seniority: "mid",
  minYearsExperience: null,
  hiringModel: "unknown",
  timezoneRequirement: null,
  requiresUsWorkAuthorization: null,
  postingLanguage: "en",
  evidence: ["Colombia, Remote"],
  ...overrides,
});

const job = {
  title: "Software Engineer II (Colombia)",
  locationRaw: "Colombia, Remote | Bogota, Colombia",
  workplaceType: null,
  descriptionText: "We are hiring in Colombia. This role is fully remote.",
};
const noCountryTitle = { ...job, title: "Software Engineer II" };
const options = { model: "gemini-3.5-flash-lite", thinkingLevel: "MINIMAL" as const };

describe("EligibilitySchema", () => {
  it("accepts a well-formed result", () => {
    expect(EligibilitySchema.safeParse(valid()).success).toBe(true);
  });

  it("rejects bad country codes, empty or long evidence and too many quotes", () => {
    expect(EligibilitySchema.safeParse(valid({ countries: ["colombia"] })).success).toBe(false);
    expect(EligibilitySchema.safeParse(valid({ evidence: [] })).success).toBe(false);
    expect(EligibilitySchema.safeParse(valid({ evidence: ["x".repeat(161)] })).success).toBe(false);
    expect(EligibilitySchema.safeParse(valid({ evidence: ["a", "b", "c"] })).success).toBe(false);
  });

  it("requires remote work for latam_eligible and worldwide (ADR 0004)", () => {
    for (const label of ["latam_eligible", "worldwide"] as const) {
      expect(EligibilitySchema.safeParse(valid({ label, workModel: "hybrid" })).success).toBe(
        false,
      );
      expect(EligibilitySchema.safeParse(valid({ label, workModel: "remote" })).success).toBe(true);
    }
  });
});

describe("isApplicable — reference cases of ADR 0004 (user in Colombia)", () => {
  const check = (
    label: Eligibility["label"],
    extra: Partial<Eligibility>,
    country = "CO",
  ): boolean =>
    isApplicable(
      { label, workModel: "remote", countries: [], excludedCountries: [], ...extra },
      country,
    );

  it.each<[string, Eligibility["label"], Partial<Eligibility>, string, boolean]>([
    ["Sezzle SWE II (LATAM)", "latam_eligible", {}, "CO", true],
    ["Sezzle SWE II (Colombia)", "country_specific", { countries: ["CO"] }, "CO", true],
    ["ElevenLabs Full-Stack (US only)", "country_specific", { countries: ["US"] }, "CO", false],
    [
      "Valsnapp Fractional",
      "latam_eligible",
      { excludedCountries: ["MX", "CU", "DO", "HT"] },
      "CO",
      true,
    ],
    [
      "Valsnapp Fractional seen from Mexico",
      "latam_eligible",
      { excludedCountries: ["MX"] },
      "MX",
      false,
    ],
    [
      "Remote only for Venezuela, seen from CO",
      "country_specific",
      { countries: ["VE"] },
      "CO",
      false,
    ],
    [
      "Remote only for Venezuela, seen from VE",
      "country_specific",
      { countries: ["VE"] },
      "VE",
      true,
    ],
    ["worldwide", "worldwide", {}, "CO", true],
    ["us_only", "us_only", {}, "CO", false],
    ["unclear", "unclear", {}, "CO", false],
    ["onsite_or_hybrid", "onsite_or_hybrid", { countries: ["CO"] }, "CO", false],
    ["latam_eligible for a non-LATAM user", "latam_eligible", {}, "ES", false],
  ])("%s", (_name, label, extra, country, expected) => {
    expect(check(label, extra, country)).toBe(expected);
  });

  it("never counts an unknown or hybrid work model", () => {
    expect(check("latam_eligible", { workModel: "unknown" })).toBe(false);
    expect(check("country_specific", { countries: ["CO"], workModel: "hybrid" })).toBe(false);
  });

  it("knows the 23 LATAM countries", () => {
    expect(LATAM_COUNTRIES.size).toBe(23);
    expect(LATAM_COUNTRIES.has("CO")).toBe(true);
    expect(LATAM_COUNTRIES.has("US")).toBe(false);
  });
});

describe("prompt", () => {
  it("is versioned and names every label and the evidence rule", () => {
    expect(ELIGIBILITY_PROMPT_VERSION).toBe("eligibility-v4");
    for (const label of ELIGIBILITY_LABELS) expect(ELIGIBILITY_SYSTEM_PROMPT).toContain(label);
    expect(ELIGIBILITY_SYSTEM_PROMPT).toContain("VERBATIM");
  });

  it("renders only the public posting and truncates very long descriptions", () => {
    const message = buildUserMessage({
      ...job,
      descriptionText: "x".repeat(MAX_DESCRIPTION_CHARS + 50),
    });
    expect(message).toContain("TITLE: Software Engineer II (Colombia)");
    expect(message).toContain("ATS_WORKPLACE_TYPE: (none)");
    expect(message).toContain("[description truncated]");
  });
});

describe("isQuoteInSource", () => {
  const source =
    "LOCATION: Colombia, Remote\nWe’re   hiring “senior” engineers across LATAM — fully remote.";
  it("matches ignoring case, whitespace, curly quotes and dashes", () => {
    expect(isQuoteInSource("colombia,  remote", source)).toBe(true);
    expect(isQuoteInSource('We\'re hiring "senior" engineers', source)).toBe(true);
    expect(isQuoteInSource("across LATAM - fully remote", source)).toBe(true);
  });
  it("accepts ellipses between verbatim fragments, but not invented text", () => {
    expect(isQuoteInSource("hiring ... across LATAM", source)).toBe(true);
    expect(isQuoteInSource("open to candidates in Brazil", source)).toBe(false);
    expect(isQuoteInSource("...", source)).toBe(false);
  });
});

describe("classifyJob", () => {
  it("returns a valid, evidenced answer as ok with the usage", async () => {
    const fake = new FakeLLMProvider([{ data: valid() }]);
    const outcome = await classifyJob(fake, job, options);
    expect(outcome).toMatchObject({
      status: "ok",
      attempts: 1,
      promptVersion: "eligibility-v4",
      postprocessVersion: "postprocess-v2",
    });
    expect(outcome.result.label).toBe("country_specific");
    // The title names Colombia, so the deterministic rule fixes the country and cites the title.
    expect(outcome.notes).toEqual(["title_country:CO"]);
    expect(outcome.result.evidence).toEqual(["Software Engineer II (Colombia)"]);
    expect(outcome.usage.inputTokens).toBe(1000);
    expect(fake.calls[0]).toMatchObject({
      model: "gemini-3.5-flash-lite",
      thinkingLevel: "MINIMAL",
    });
  });

  it("retries once, including the validation error, and sums the usage of both attempts", async () => {
    const fake = new FakeLLMProvider([{ data: { label: "nonsense" } }, { data: valid() }]);
    const outcome = await classifyJob(fake, job, options);
    expect(outcome).toMatchObject({ status: "ok", attempts: 2 });
    expect(outcome.usage.inputTokens).toBe(2000);
    expect(outcome.problems).toHaveLength(1);
    expect(fake.calls[1]?.user).toContain("Your previous answer was rejected");
  });

  it("falls back to unclear (with verifiable evidence) after two invalid answers", async () => {
    const fake = new FakeLLMProvider([{ data: { bad: 1 } }, { data: { bad: 2 } }]);
    const outcome = await classifyJob(fake, job, options);
    expect(outcome.status).toBe("fallback_unclear");
    expect(outcome.attempts).toBe(2);
    expect(outcome.result).toMatchObject({ label: "unclear", workModel: "unknown", countries: [] });
    expect(outcome.result.evidence).toEqual(["Colombia, Remote | Bogota, Colombia"]);
    expect(isApplicable(outcome.result, "CO")).toBe(false);
  });

  it("downgrades an applicable label whose quotes are not in the posting", async () => {
    const invented = valid({
      label: "latam_eligible",
      countries: [],
      evidence: ["Open to all of Latin America"],
    });
    const outcome = await classifyJob(new FakeLLMProvider([{ data: invented }]), noCountryTitle, options);
    expect(outcome.status).toBe("evidence_unverified");
    expect(outcome.result).toMatchObject({ label: "unclear", countries: [], workModel: "remote" });
    expect(isApplicable(outcome.result, "CO")).toBe(false);
  });

  it("keeps non-applicable labels even when their quote is not verifiable", async () => {
    const usOnly = valid({
      label: "us_only",
      countries: [],
      evidence: ["must reside in the United States"],
    });
    const outcome = await classifyJob(new FakeLLMProvider([{ data: usOnly }]), job, options);
    expect(outcome.status).toBe("ok");
    expect(outcome.result.label).toBe("us_only");
  });

  it.each([
    ["rate limit", new RateLimitError(1000)],
    ["daily quota", new QuotaExhaustedError()],
    ["provider/network", new ProviderError("down", 503, true)],
  ])("propagates %s errors instead of producing unclear", async (_name, error) => {
    await expect(classifyJob(new FakeLLMProvider([error]), job, options)).rejects.toBe(error);
  });
});
