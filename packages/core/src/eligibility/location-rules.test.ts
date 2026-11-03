import { describe, expect, it } from "vitest";
import { atsCountryList, parseLocationSegments, remoteSegmentCountries } from "./location-rules.js";
import { postprocess } from "./postprocess.js";
import { buildUserMessage, type PromptJob } from "./prompt.js";
import type { RawEligibility } from "./schema.js";

const raw = (overrides: Partial<RawEligibility> = {}): RawEligibility => ({
  label: "worldwide",
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
  evidence: ["This role is remote and can be executed globally."],
  ...overrides,
});
const job = (overrides: Partial<PromptJob> = {}): PromptJob => ({
  title: "Safety Engineer",
  locationRaw: "United Kingdom | Dublin | Tokyo | United States | New York | Washington, D.C.",
  workplaceType: "remote",
  descriptionText: "This role is remote and can be executed globally.",
  ...overrides,
});
const run = (r: RawEligibility, j: PromptJob) => postprocess(r, j, buildUserMessage(j));

describe("parseLocationSegments", () => {
  it("splits sibling vacancies and reads countries, remote words and regions", () => {
    const segments = parseLocationSegments(
      "Mexico, Remote | Bogota, Colombia | Latin America [Remote]",
    );
    expect(segments.map((s) => s.hasRemoteWord)).toEqual([true, false, true]);
    expect(segments[0]?.countries).toEqual(["MX"]);
    expect(segments[1]?.countries).toEqual(["CO"]);
    expect(segments[2]?.hasRegionOrGlobal).toBe(true);
  });
});

describe("atsCountryList", () => {
  it("returns the countries of a plain list of places", () => {
    expect(atsCountryList("London | New York | Poland")).toEqual({ countries: ["PL"] });
    expect(atsCountryList("United States | Dublin | Europe | Japan")?.countries).toEqual([
      "US",
      "JP",
    ]);
  });

  it("does not apply when a segment is a region, global wording, an unknown place, or only 'Remote'", () => {
    expect(atsCountryList("Home Based - Worldwide | Home Based - Americas")).toBeNull();
    expect(atsCountryList("Remote, EMEA/LATAM | Remote, LATAM")).toBeNull();
    expect(atsCountryList("United States | Global - Remote")).toBeNull();
    expect(atsCountryList("Bogota | London")).toBeNull();
    expect(atsCountryList("Remote")).toBeNull();
  });
});

describe("postprocess-v3 rule: a plain ATS list beats a generic worldwide claim", () => {
  it("turns worldwide into country_specific with the listed countries and cites the location", () => {
    const out = run(raw(), job());
    expect(out.result).toMatchObject({ label: "country_specific", countries: ["GB", "US"] });
    expect(out.result.evidence[0]).toContain("United Kingdom");
    expect(out.notes[0]).toMatch(/^ats_country_list:/);
    expect(out.status).toBe("ok");
  });

  it("leaves a worldwide answer alone when the location itself says worldwide", () => {
    const out = run(raw(), job({ locationRaw: "Home based - Worldwide" }));
    expect(out.result.label).toBe("worldwide");
  });
});

describe("remoteSegmentCountries", () => {
  it("drops a country whose own segment is not remote when a sibling segment is", () => {
    expect(remoteSegmentCountries("Brazil, Remote | Bogota, Colombia", null, ["BR", "CO"])).toEqual(
      ["BR"],
    );
  });

  it("keeps it when the ATS metadata, a #LI-remote tag or a body 'Location: Remote' line backs it", () => {
    const location = "Brazil, Remote | Bogota, Colombia";
    expect(remoteSegmentCountries(location, "remote", ["BR", "CO"])).toBeNull();
    expect(
      remoteSegmentCountries(location, null, ["BR", "CO"], "...\n#Li-remote #Full-time"),
    ).toBeNull();
    expect(
      remoteSegmentCountries(location, null, ["BR", "CO"], "Location: Remote, Brazil, Colombia"),
    ).toBeNull();
  });

  it("does not apply to a single segment or when no segment says remote", () => {
    expect(remoteSegmentCountries("Bogota, Colombia", null, ["CO"])).toBeNull();
    expect(remoteSegmentCountries("Peru | Bogota, Colombia", null, ["PE", "CO"])).toBeNull();
  });
});

describe("postprocess-v3 rule: compound location, remote per segment", () => {
  const sezzle = job({
    title: "Fraud Intern",
    locationRaw: "Brazil, Remote | Bogota, Colombia",
    workplaceType: null,
    descriptionText: "Intern role.",
  });

  it("removes Colombia when only the Brazil segment says Remote", () => {
    const out = run(
      raw({ label: "country_specific", countries: ["BR", "CO"], evidence: ["Brazil, Remote"] }),
      sezzle,
    );
    expect(out.result).toMatchObject({ label: "country_specific", countries: ["BR"] });
    expect(out.notes).toContain("segment_remote:CO");
  });

  it("becomes unclear when no remote country is left", () => {
    const out = run(
      raw({ label: "country_specific", countries: ["CO"], evidence: ["Bogota, Colombia"] }),
      sezzle,
    );
    expect(out.result.label).toBe("unclear");
  });
});
