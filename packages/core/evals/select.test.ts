import { describe, expect, it } from "vitest";
import { selectTestSet, stratumOf, type PoolJob, type SelectOptions } from "./select.js";

const job = (overrides: Partial<PoolJob> & { id: string }): PoolJob => ({
  company: "Acme",
  title: "Software Engineer",
  locationRaw: "Colombia, Remote",
  workplaceType: null,
  siblingGroup: null,
  titleKey: `${overrides.company ?? "Acme"}|${overrides.title ?? "software engineer"}|${overrides.id}`,
  ...overrides,
});

const options = (overrides: Partial<SelectOptions> = {}): SelectOptions => ({
  seed: 11,
  maxPerCompany: 25,
  maxPerGroup: 3,
  targetNegatives: 10,
  excludeIds: new Set(),
  excludeGroups: new Set(),
  ...overrides,
});

describe("stratumOf (metadata only)", () => {
  it.each([
    ["Colombia, Remote", null, "candidate"],
    ["Latin America [Remote]", null, "candidate"],
    ["Home based - Worldwide", null, "candidate"],
    ["Bogota, Colombia", "hybrid", "negative_hybrid"],
    ["Hybrid - San Francisco", null, "negative_hybrid"],
    ["New York", null, "negative_us"],
    ["United States", null, "negative_us"],
    ["Poland", null, "negative_other_country"],
    ["Atlantis", null, "negative_other"],
  ])("%s (%s) -> %s", (locationRaw, workplaceType, expected) => {
    expect(stratumOf(job({ id: "x", locationRaw, workplaceType }))).toBe(expected);
  });
});

describe("selectTestSet", () => {
  // 40 sibling groups of 5 per-country variants for Sezzle, plus other companies.
  const countries = ["Colombia", "Mexico", "Brazil", "Peru", "Chile"];
  const sezzle = Array.from({ length: 40 }, (_, g) =>
    countries.map((country, i) =>
      job({
        id: `greenhouse:sezzle:${g}-${i}`,
        company: "Sezzle",
        title: `Engineer ${g}`,
        locationRaw: `${country}, Remote | Latin America [Remote]`,
        siblingGroup: `sezzle-${g}`,
      }),
    ),
  ).flat();
  const others = [
    ...Array.from({ length: 12 }, (_, i) =>
      job({ id: `ashby:acme:${i}`, company: "Acme", title: `Role ${i}`, locationRaw: "New York" }),
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      job({ id: `lever:beta:${i}`, company: "Beta", title: `Role ${i}`, locationRaw: "Poland" }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      job({
        id: `lever:gamma:${i}`,
        company: "Gamma",
        title: `Role ${i}`,
        locationRaw: "Colombia, Remote",
      }),
    ),
  ];
  const pool = [...sezzle, ...others];

  it("is deterministic for a seed and changes with another one", () => {
    const a = selectTestSet(pool, options()).selected.map((s) => s.id);
    const b = selectTestSet(pool, options()).selected.map((s) => s.id);
    const c = selectTestSet(pool, options({ seed: 12 })).selected.map((s) => s.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("respects the per-company cap and the per-group cap", () => {
    const { selected } = selectTestSet(pool, options({ maxPerCompany: 25, maxPerGroup: 3 }));
    const perCompany = new Map<string, number>();
    const perGroup = new Map<string, number>();
    for (const item of selected) {
      perCompany.set(item.company, (perCompany.get(item.company) ?? 0) + 1);
      if (item.siblingGroup)
        perGroup.set(item.siblingGroup, (perGroup.get(item.siblingGroup) ?? 0) + 1);
    }
    expect(Math.max(...perCompany.values())).toBeLessThanOrEqual(25);
    expect(perCompany.get("Sezzle")).toBe(25);
    expect(Math.max(...perGroup.values())).toBeLessThanOrEqual(3);
  });

  it("prefers different countries inside a sibling group", () => {
    const { selected } = selectTestSet(pool, options());
    const byGroup = new Map<string, string[]>();
    for (const item of selected.filter((s) => s.siblingGroup)) {
      const list = byGroup.get(item.siblingGroup as string) ?? [];
      list.push(item.locationRaw.split(",")[0] as string);
      byGroup.set(item.siblingGroup as string, list);
    }
    for (const list of byGroup.values()) expect(new Set(list).size).toBe(list.length);
  });

  it("leaves the rest of each chosen group out of the eval instead of reusing it", () => {
    const { selected, leftOut } = selectTestSet(pool, options());
    const chosen = new Set(selected.map((s) => s.id));
    const chosenGroups = new Set(selected.map((s) => s.siblingGroup).filter(Boolean));
    expect(leftOut.length).toBeGreaterThan(0);
    for (const item of leftOut) {
      expect(chosen.has(item.id)).toBe(false);
      expect(chosenGroups.has(item.siblingGroup)).toBe(true);
    }
  });

  it("never picks an excluded id or a posting of an excluded sibling group", () => {
    const result = selectTestSet(
      pool,
      options({
        excludeIds: new Set(["ashby:acme:0"]),
        excludeGroups: new Set(["sezzle-0", "sezzle-1"]),
      }),
    );
    for (const item of [...result.selected, ...result.leftOut]) {
      expect(item.id).not.toBe("ashby:acme:0");
      expect(["sezzle-0", "sezzle-1"]).not.toContain(item.siblingGroup);
    }
  });

  it("puts candidates first and fills the remaining room with negatives of several strata", () => {
    const { selected } = selectTestSet(pool, options({ targetNegatives: 10 }));
    const strata = new Set(selected.map((s) => s.stratum));
    expect(strata.has("candidate")).toBe(true);
    expect(strata.has("negative_us")).toBe(true);
    expect(strata.has("negative_other_country")).toBe(true);
    expect(selected.filter((s) => s.stratum !== "candidate").length).toBeLessThanOrEqual(10);
  });
});
