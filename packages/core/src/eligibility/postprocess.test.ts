import { describe, expect, it } from "vitest";
import { FakeLLMProvider } from "../llm/fake.js";
import { COUNTRY_ISO_BY_NAME, NON_LATAM_COUNTRIES } from "../rules/places.js";
import { classifyJob, classifyRaw, finalizeOutcome } from "./classify.js";
import {
  POSTPROCESS_VERSION,
  countriesNamedInTitle,
  postprocess,
  resultCacheKey,
} from "./postprocess.js";
import { buildUserMessage, type PromptJob } from "./prompt.js";
import type { RawEligibility } from "./schema.js";

const LATAM_ISO = "AR BO BR BZ CL CO CR CU DO EC GT GY HN HT MX NI PA PE PY SR SV UY VE".split(" ");

const raw = (overrides: Partial<RawEligibility> = {}): RawEligibility => ({
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
  ...overrides,
});

const job = (overrides: Partial<PromptJob> = {}): PromptJob => ({
  title: "Software Engineer",
  locationRaw: "Latin America | Bogota, Colombia | Latin America [Remote]",
  workplaceType: null,
  descriptionText: "Join our team. We hire across Latin America and the role is fully remote.",
  ...overrides,
});

const run = (r: RawEligibility | null, j: PromptJob) => postprocess(r, j, buildUserMessage(j));

describe("country vocabulary", () => {
  it("has an ISO code for every country of the S5 gazetteer", () => {
    for (const name of NON_LATAM_COUNTRIES) expect(COUNTRY_ISO_BY_NAME.has(name), name).toBe(true);
  });

  it("covers the 23 LATAM countries of ADR 0004", () => {
    const isoCodes = new Set(COUNTRY_ISO_BY_NAME.values());
    for (const iso of LATAM_ISO) expect(isoCodes.has(iso), iso).toBe(true);
  });
});

describe("countriesNamedInTitle", () => {
  it.each([
    ["Software Engineer II (Colombia)", ["CO"]],
    ["Mobile Engineer (Argentina, All Levels)", ["AR"]],
    ["Product Lead, BillPay Mexico (SPEI)", ["MX"]],
    ["Account Manager - UK/I", ["GB"]],
    ["Engineer, Brasil", ["BR"]],
    ["Sales Lead (Costa Rica and Panama)", ["CR", "PA"]],
    ["[Job-31838] Senior Data Analyst, Colombia", ["CO"]],
  ])("%s -> %j", (title, expected) => {
    expect(countriesNamedInTitle(title)).toEqual(expected);
  });

  it.each([
    "Software Engineer",
    "Engineer, LATAM",
    "Engineer (Colombia or anywhere)",
    "Global Support Engineer, Mexico",
    "Backend Engineer - Americas",
    "Engineer, New Mexico office",
    "Join us as an Engineer",
    "Engineer in Georgia",
    "Indiana Platform Engineer",
  ])("%s -> nothing", (title) => {
    expect(countriesNamedInTitle(title)).toEqual([]);
  });

  it("reads capitalized abbreviations only", () => {
    expect(countriesNamedInTitle("Engineer (US)")).toEqual(["US"]);
    expect(countriesNamedInTitle("Engineer (U.S.)")).toEqual(["US"]);
    expect(countriesNamedInTitle("Engineer, UK")).toEqual(["GB"]);
  });
});

describe("postprocess — title country rule", () => {
  it("makes the title country win over a regional answer and cites the title", () => {
    const j = job({ title: "Mobile Engineer (Argentina, All Levels)" });
    const out = run(raw(), j);
    expect(out.result).toMatchObject({
      label: "country_specific",
      countries: ["AR"],
      excludedCountries: [],
    });
    expect(out.result.evidence).toEqual(["Mobile Engineer (Argentina, All Levels)"]);
    expect(out.status).toBe("ok");
    expect(out.notes).toEqual(["title_country:AR"]);
  });

  it("replaces a long country list with the title country", () => {
    const j = job({ title: "Engineer, Colombia" });
    const out = run(raw({ label: "country_specific", countries: ["BR", "AR", "CO", "MX"] }), j);
    expect(out.result.countries).toEqual(["CO"]);
  });

  it("can turn a regional answer into a non-LATAM country", () => {
    const out = run(raw(), job({ title: "Engineer (US)" }));
    expect(out.result).toMatchObject({ label: "country_specific", countries: ["US"] });
  });

  it("does not apply when the title also names a region or says global", () => {
    for (const title of ["Engineer, Colombia or LATAM", "Global Engineer (Mexico)"]) {
      const out = run(raw(), job({ title }));
      expect(out.notes.some((note) => note.startsWith("title_country"))).toBe(false);
      expect(out.result.label).toBe("latam_eligible");
    }
  });

  it("never reshapes onsite_or_hybrid, us_only or unclear answers", () => {
    const j = job({ title: "Product Lead, BillPay Mexico" });
    for (const label of ["onsite_or_hybrid", "us_only", "unclear"] as const) {
      const workModel = label === "onsite_or_hybrid" ? "hybrid" : "unknown";
      expect(run(raw({ label, workModel }), j).result.label).toBe(label);
    }
  });
});

describe("postprocess — evidence", () => {
  const filler = (text: string): string => text.padEnd(400, " and more words here");

  it("cuts a quote longer than 160 characters to a literal fragment instead of degrading to unclear", () => {
    const places = filler("São Paulo | Brasília | Buenos Aires | Bogota | Mexico City");
    const j = job({
      locationRaw: "Brazil | Argentina",
      descriptionText: `Our locations: ${places}`,
    });
    const out = run(
      raw({ label: "country_specific", countries: ["BR", "AR"], evidence: [places] }),
      j,
    );
    expect(out.status).toBe("ok");
    expect(out.notes).toContain("evidence_trimmed");
    const kept = out.result.evidence[0] ?? "";
    expect(kept.length).toBeLessThanOrEqual(160);
    expect(buildUserMessage(j)).toContain(kept);
  });

  it("drops a long quote that is not in the posting; if none is left a regional label becomes unclear", () => {
    const j = job();
    const invented = "This invented sentence is not part of the posting at all. ".repeat(6);
    const out = run(raw({ evidence: [invented] }), j);
    expect(out.notes).toContain("evidence_dropped");
    expect(out.status).toBe("evidence_unverified");
    expect(out.result.label).toBe("unclear");
    expect(out.result.evidence).toEqual([j.locationRaw]);
  });

  it("keeps a non-applicable label whose quote was dropped, with a verifiable fallback quote", () => {
    const j = job();
    const out = run(
      raw({ label: "us_only", workModel: "unknown", evidence: ["invented ".repeat(30)] }),
      j,
    );
    expect(out.status).toBe("ok");
    expect(out.result.label).toBe("us_only");
    expect(out.result.evidence).toEqual([j.locationRaw]);
  });

  it("turns a missing answer into a fallback unclear", () => {
    const out = run(null, job());
    expect(out.status).toBe("fallback_unclear");
    expect(out.result.label).toBe("unclear");
  });
});

describe("raw answers and finalization", () => {
  it("accepts a long quote from the model without a retry and trims it afterwards", async () => {
    const quote = `We hire in these cities: ${"Mexico City ".repeat(30)}`.trim();
    const j = job({
      title: "Engineer",
      descriptionText: `${quote} and the team is remote.`,
    });
    expect(quote.length).toBeGreaterThan(160);
    const answer = raw({ label: "country_specific", countries: ["MX"], evidence: [quote] });

    const rawOutcome = await classifyRaw(new FakeLLMProvider([{ data: answer }]), j, {
      model: "m",
    });
    expect(rawOutcome.attempts).toBe(1);
    const final = finalizeOutcome(rawOutcome, j);
    expect(final.status).toBe("ok");
    expect(final.result.evidence[0]?.length).toBeLessThanOrEqual(160);

    // classifyJob = classifyRaw + finalizeOutcome
    const again = await classifyJob(new FakeLLMProvider([{ data: answer }]), j, { model: "m" });
    expect(again.result).toEqual(final.result);
  });

  it("puts the post-processing version in the stored-result key", () => {
    const parts = { contentHash: "abc", promptVersion: "eligibility-v3", model: "m" };
    expect(resultCacheKey(parts)).toBe(`abc|eligibility-v3|m|${POSTPROCESS_VERSION}`);
    expect(resultCacheKey({ ...parts, postprocessVersion: "postprocess-v2" })).not.toBe(
      resultCacheKey(parts),
    );
  });
});
