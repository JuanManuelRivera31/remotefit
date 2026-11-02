import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectors } from "../ats/index.js";
import type { WorkplaceType } from "../normalize/job.js";
import {
  PREFILTER_VERSION,
  evaluatePrefilterRules,
  prefilterJob,
  type PrefilterInput,
} from "./prefilter.js";

interface LocationFixture {
  locationRaw: string;
  workplaceType: WorkplaceType | null;
}

const readJson = <T>(relative: string): T =>
  JSON.parse(readFileSync(new URL(`../../fixtures/${relative}`, import.meta.url), "utf8")) as T;

// Real strings from the 1282 ingested jobs (S4): 455 distinct (location, workplaceType) pairs, 1076 distinct titles.
const locations = readJson<LocationFixture[]>("locations/locations.json");
const titles = readJson<string[]>("titles/titles.json");

const NEUTRAL_TITLE = "Software Engineer";
const job = (overrides: Partial<PrefilterInput>): PrefilterInput => ({
  title: NEUTRAL_TITLE,
  locationRaw: "",
  workplaceType: null,
  ...overrides,
});
const withLocation = (fixture: LocationFixture) =>
  job({ locationRaw: fixture.locationRaw, workplaceType: fixture.workplaceType });

/**
 * Snapshots of what the rules discard, kept in git so every rule change shows up as a reviewable diff.
 * To regenerate after an intended change: UPDATE_PREFILTER_SNAPSHOTS=1 npm test -w packages/core, then review the diff.
 */
function expectSnapshot(relative: string, actual: string[]): void {
  const file = new URL(`../../fixtures/${relative}`, import.meta.url);
  if (process.env["UPDATE_PREFILTER_SNAPSHOTS"] === "1" || !existsSync(file)) {
    writeFileSync(file, `${JSON.stringify(actual, null, 1)}\n`);
  }
  expect(actual).toEqual(JSON.parse(readFileSync(file, "utf8")) as string[]);
}

describe("prefilterJob — never labels anything as applicable", () => {
  it("only returns pass or discarded", () => {
    for (const fixture of locations) {
      expect(["pass", "discarded"]).toContain(prefilterJob(withLocation(fixture)).outcome);
    }
  });
});

describe("non_latam_location", () => {
  it.each([
    ["New York", null],
    ["Toronto, ON", null],
    ["Austin, TX", null],
    ["Office Based - London, UK", null],
    ["United States | San Francisco Bay Area", null],
    ["Mumbai, Maharashtra, India | Mumbai, India", null],
    ["Washington, DC", null],
    ["Poland", null],
  ] as const)("discards %j", (locationRaw, workplaceType) => {
    const result = prefilterJob(job({ locationRaw, workplaceType }));
    expect(result).toMatchObject({ outcome: "discarded", rule: "non_latam_location" });
    if (result.outcome === "discarded") expect(result.matchedText).toBe(locationRaw);
  });

  it.each([
    "New York; Remote - LATAM", // mixed locations
    "San Francisco or Remote",
    "New York | Bogota, Colombia", // one LATAM place is enough to pass
    "Remote",
    "United States, Remote | Sezzle Inc., USA",
    "Home Based - Worldwide",
    "Denver, CO", // CO is also Colombia's code: ambiguous, so it passes
    "Atlantis", // unknown place
    "New York, Narnia", // one unknown token is enough to pass
    "",
  ])("passes %j", (locationRaw) => {
    expect(prefilterJob(job({ locationRaw })).outcome).toBe("pass");
  });

  it("passes when the ATS metadata says remote, even for a US city", () => {
    expect(prefilterJob(job({ locationRaw: "New York", workplaceType: "remote" })).outcome).toBe(
      "pass",
    );
  });

  it("passes when the title contradicts the location", () => {
    for (const title of [
      "Backend Engineer (Remote)",
      "Backend Engineer - Colombia",
      "Engineer, LATAM",
    ]) {
      expect(prefilterJob(job({ title, locationRaw: "New York" })).outcome).toBe("pass");
    }
  });
});

describe("onsite_or_hybrid_metadata", () => {
  it("discards explicit hybrid and onsite metadata", () => {
    for (const workplaceType of ["hybrid", "onsite"] as const) {
      const hits = evaluatePrefilterRules(job({ locationRaw: "Bogotá", workplaceType }));
      expect(hits.map((hit) => hit.rule)).toEqual(["onsite_or_hybrid_metadata"]);
    }
  });

  it("passes when the title or the locations contradict the metadata", () => {
    expect(
      prefilterJob(
        job({ title: "Remote Backend Engineer", locationRaw: "Bogotá", workplaceType: "hybrid" }),
      ).outcome,
    ).toBe("pass");
    expect(
      prefilterJob(job({ locationRaw: "Bogotá | Latin America [Remote]", workplaceType: "onsite" }))
        .outcome,
    ).toBe("pass");
  });

  it("passes without metadata", () => {
    expect(prefilterJob(job({ locationRaw: "Bogotá", workplaceType: null })).outcome).toBe("pass");
  });
});

describe("body guard", () => {
  const nyc = job({ locationRaw: "New York" });
  it("sends the posting to the classifier when the body says it is remote or open to LATAM", () => {
    for (const descriptionText of [
      "This is a fully remote position.",
      "We are remote-first.",
      "Open to candidates across Latin America.",
    ]) {
      expect(prefilterJob({ ...nyc, descriptionText }).outcome).toBe("pass");
    }
  });

  it("ignores boilerplate that is not a strong remote phrase", () => {
    expect(
      prefilterJob({ ...nyc, descriptionText: "We offer a remote work stipend." }).outcome,
    ).toBe("discarded");
  });

  it("does not let LATAM mentions in the body rescue a hybrid posting", () => {
    const hybrid = job({ locationRaw: "Bogotá", workplaceType: "hybrid" });
    expect(
      prefilterJob({ ...hybrid, descriptionText: "We serve customers across Latin America." })
        .outcome,
    ).toBe("discarded");
    expect(
      prefilterJob({ ...hybrid, descriptionText: "This is a fully remote role." }).outcome,
    ).toBe("pass");
  });
});

describe("non_tech_role", () => {
  it.each([
    "Account Executive",
    "Enterprise Account Executive - Chile",
    "Sales Development Representative",
    "Regional BDR Team Manager",
    "Executive Recruiter",
    "Talent Acquisition Specialist",
    "Legal Counsel - Regulatory Compliance, Product and Privacy",
    "Senior Accountant",
    "Payroll, Compensation & Benefits Intern",
    "Senior HR Generalist - EMEA",
    "Senior B2B Marketing Manager",
    "Customer Success Manager",
    "Agente de Servicio al Cliente | Programa de Inclusión",
    "Executive Assistant to the CEO",
  ])("discards %j", (title) => {
    const result = prefilterJob(job({ title, locationRaw: "Remote" }));
    expect(result).toMatchObject({ outcome: "discarded", rule: "non_tech_role" });
  });

  it.each([
    "Solutions Engineer",
    "Sales Engineer",
    "Technical Account Manager",
    "Support Engineer (AMER - Weekends)",
    "Senior Data Analyst",
    "Salesforce Developer",
    "Finance Systems Lead",
    "Head of Marketplace Supply", // unknown title passes
    "Product Manager", // not on the explicit list
    "Growth Manager (Activation & Consumer)",
    "Tech Lead",
    "Senior Business Analyst (Microsoft Dynamics 365 Customer Service)",
    "",
  ])("passes %j", (title) => {
    expect(prefilterJob(job({ title, locationRaw: "Remote" })).outcome).toBe("pass");
  });
});

describe("siblings are judged one by one", () => {
  it("does not inherit the decision of the group: same title, different country, different outcome", () => {
    const title = "Fraud Operations Intern";
    const colombia = prefilterJob(job({ title, locationRaw: "Colombia, Remote" }));
    const usa = prefilterJob(job({ title, locationRaw: "New York" }));
    expect(colombia.outcome).toBe("pass");
    expect(usa.outcome).toBe("discarded");
  });

  it("evaluates every real Sezzle sibling on its own location", () => {
    const fixture = readJson<{ jobs: unknown[] }>("greenhouse/sezzle-siblings.json");
    const company = { name: "Sezzle", boardToken: "sezzle" };
    const normalized = fixture.jobs.map((raw) =>
      connectors.greenhouse.toNormalizedJob(raw, company),
    );
    expect(normalized.length).toBeGreaterThan(1);
    for (const item of normalized) {
      // The input has no sibling information at all, so each posting is judged on its own location.
      // Every Sezzle sibling in this fixture lists Remote or a LATAM place, so none may be discarded by location.
      expect(
        evaluatePrefilterRules({
          title: item.title,
          locationRaw: item.locationRaw,
          workplaceType: item.workplaceType,
        }).map((hit) => hit.rule),
      ).not.toContain("non_latam_location");
    }
  });
});

describe("real locations (455 distinct pairs from the ingested jobs)", () => {
  it("has the fixture it claims", () => {
    expect(locations.length).toBe(455);
    expect(new Set(locations.map((item) => item.locationRaw)).size).toBe(436);
  });

  it("never discards by location when there is any remote or region signal", () => {
    const signal =
      /remote|anywhere|worldwide|latam|latin america|americas|amer\b|home ?based|colombia|brazil|mexico/i;
    for (const fixture of locations.filter((item) => signal.test(item.locationRaw))) {
      const rules = evaluatePrefilterRules(withLocation(fixture)).map((hit) => hit.rule);
      expect(rules, fixture.locationRaw).not.toContain("non_latam_location");
    }
  });

  it("every discard carries its rule and a text that comes from the input", () => {
    for (const fixture of locations) {
      const result = prefilterJob(withLocation(fixture));
      if (result.outcome !== "discarded") continue;
      expect(result.matchedText.length).toBeGreaterThan(0);
      if (result.rule === "non_latam_location") {
        expect(fixture.locationRaw).toContain(result.matchedText);
      } else {
        expect(result.matchedText).toBe(`workplaceType=${fixture.workplaceType}`);
      }
    }
  });

  it("matches the reviewed snapshot of discarded location strings", () => {
    const discarded = locations
      .filter((fixture) => prefilterJob(withLocation(fixture)).outcome === "discarded")
      .map((fixture) => `${fixture.workplaceType ?? "null"} | ${fixture.locationRaw}`);
    expect(discarded.length).toBeGreaterThan(0);
    expectSnapshot("locations/locations.discarded.json", discarded);
  });

  // Hand-reviewed expectations on real strings (decided from the text, not from the function's output).
  it.each<[string, WorkplaceType | null, "pass" | "discarded"]>([
    ["Colombia", "remote", "pass"],
    ["Colombia", "hybrid", "discarded"], // hybrid metadata, nothing contradicts it
    ["Brazil", "remote", "pass"],
    ["Latin America | Bogota, Colombia | Latin America [Remote] | Turkey", null, "pass"],
    ["Argentina, Remote | Bogota, Colombia", null, "pass"],
    ["Home Based - Americas", null, "pass"],
    ["Home Based - Shenzhen, China", null, "pass"], // "home based" is a remote signal
    ["United Kingdom", "remote", "pass"], // remote metadata: leave it to the classifier
    ["India", "remote", "pass"],
    ["Minneapolis, United States | US Remote", null, "pass"],
    ["Germany", "onsite", "discarded"],
    ["Poland", "onsite", "discarded"],
    ["Toronto, ON", "hybrid", "discarded"],
    ["Washington, DC", "hybrid", "discarded"],
    ["Office Based - London, UK", null, "discarded"],
    ["Saudi Arabia", null, "discarded"],
  ])("%j (%s) -> %s", (locationRaw, workplaceType, expected) => {
    expect(locations).toContainEqual({ locationRaw, workplaceType });
    expect(prefilterJob(job({ locationRaw, workplaceType })).outcome).toBe(expected);
  });
});

describe("real titles (1076 distinct)", () => {
  it("has the fixture it claims", () => {
    expect(titles.length).toBe(1076);
  });

  it("never discards a title that contains a technical word", () => {
    const technical =
      /engineer|developer|software|devops|\bsre\b|architect|full-?stack|backend|frontend/i;
    for (const title of titles.filter((item) => technical.test(item))) {
      const rules = evaluatePrefilterRules(job({ title, locationRaw: "Remote" })).map(
        (hit) => hit.rule,
      );
      expect(rules, title).not.toContain("non_tech_role");
    }
  });

  it("matches the reviewed snapshot of titles discarded as non-technical", () => {
    const discarded = titles.filter(
      (title) => prefilterJob(job({ title, locationRaw: "Remote" })).outcome === "discarded",
    );
    expect(discarded.length).toBeGreaterThan(0);
    expectSnapshot("titles/titles.discarded.json", discarded);
  });
});

describe("version", () => {
  it("is exported for storage next to each result", () => {
    expect(PREFILTER_VERSION).toBe("prefilter-v1");
  });
});
