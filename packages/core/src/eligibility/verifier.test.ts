import { describe, expect, it } from "vitest";
import { FakeLLMProvider } from "../llm/fake.js";
import { ProviderError } from "../llm/types.js";
import type { PromptJob } from "./prompt.js";
import type { Eligibility } from "./schema.js";
import { VERIFIER_SYSTEM_PROMPT, buildVerifierMessage, verifyPositive } from "./verifier.js";

const job: PromptJob = {
  title: "Backend Engineer",
  locationRaw: "Latin America [Remote]",
  workplaceType: null,
  descriptionText: "This role is fully remote and open to candidates anywhere in Latin America.",
};
const first: Eligibility = {
  label: "latam_eligible",
  countries: [],
  excludedCountries: [],
  workModel: "remote",
  workModelConflict: false,
  seniority: "mid",
  minYearsExperience: null,
  hiringModel: "unknown",
  timezoneRequirement: null,
  requiresUsWorkAuthorization: null,
  postingLanguage: "en",
  evidence: ["Latin America [Remote]"],
};
const options = { model: "gemini-3.8-flash", thinkingLevel: "MINIMAL" as const };

describe("verifyPositive", () => {
  it("confirms only when the model says yes and its quote is really in the posting", async () => {
    const provider = new FakeLLMProvider([
      { data: { confirmed: true, quote: "open to candidates anywhere in Latin America" } },
    ]);
    const out = await verifyPositive(provider, job, first, options);
    expect(out).toMatchObject({ confirmed: true, quoteUnverified: false });
    expect(provider.calls[0]?.system).toBe(VERIFIER_SYSTEM_PROMPT);
    expect(provider.calls[0]?.user).toContain("FIRST CLASSIFIER ANSWER: label=latam_eligible");
  });

  it("does not confirm a quote that is invented or taken from the first answer", async () => {
    const invented = new FakeLLMProvider([
      { data: { confirmed: true, quote: "open to Colombia" } },
    ]);
    expect(await verifyPositive(invented, job, first, options)).toMatchObject({
      confirmed: false,
      quoteUnverified: true,
    });
    const fromFirst = new FakeLLMProvider([
      { data: { confirmed: true, quote: 'evidence=["Latin America [Remote]"]' } },
    ]);
    expect((await verifyPositive(fromFirst, job, first, options)).confirmed).toBe(false);
  });

  it("keeps the posting unconfirmed when the model says no or answers invalid JSON twice", async () => {
    const no = new FakeLLMProvider([{ data: { confirmed: false, quote: "" } }]);
    expect((await verifyPositive(no, job, first, options)).confirmed).toBe(false);
    const garbage = new FakeLLMProvider([{ data: { nonsense: 1 } }]);
    expect(await verifyPositive(garbage, job, first, options)).toMatchObject({ confirmed: false });
  });

  it("lets quota and network errors propagate so the posting stays pending", async () => {
    const down = new FakeLLMProvider([new ProviderError("503", 503, true)]);
    await expect(verifyPositive(down, job, first, options)).rejects.toBeInstanceOf(ProviderError);
  });

  it("builds a message with the public posting text and the first answer, nothing personal", () => {
    const message = buildVerifierMessage(job, first);
    expect(message).toContain("TITLE: Backend Engineer");
    expect(message).toContain("FIRST CLASSIFIER ANSWER");
  });
});
