import { describe, expect, it } from "vitest";
import { JobsQuerySchema } from "./contract.js";
import {
  ageInDays,
  excerptAround,
  listJobs,
  postingCountries,
  summarizeOne,
  verdictFor,
  type ListingResult,
  type ListingRow,
} from "./listing.js";

const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const result = (over: Partial<ListingResult> = {}): ListingResult => ({
  label: "latam_eligible",
  countries: [],
  excludedCountries: [],
  workModel: "remote",
  seniority: "senior",
  evidence: ["Remote - LATAM"],
  status: "ok",
  ...over,
});

let nextId = 1;
const row = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: nextId++,
  title: "Backend Engineer",
  company: "Acme",
  locationRaw: "Remote - LATAM",
  url: "https://jobs.example.com/1",
  siblingGroup: null,
  postedAt: daysAgo(3),
  firstSeenAt: daysAgo(2),
  lastSeenAt: daysAgo(0),
  result: result(),
  ...over,
});

const query = (input: Record<string, unknown> = {}) => JobsQuerySchema.parse(input);

describe("verdictFor", () => {
  it("uses isApplicable for the confirmed verdict", () => {
    expect(verdictFor(result(), "CO")).toBe("applicable");
    expect(verdictFor(result({ label: "country_specific", countries: ["CO"] }), "CO")).toBe(
      "applicable",
    );
    expect(verdictFor(result({ label: "country_specific", countries: ["MX"] }), "CO")).toBeNull();
    expect(verdictFor(result({ label: "us_only" }), "CO")).toBeNull();
    expect(verdictFor(result({ workModel: "hybrid" }), "CO")).toBeNull();
  });

  it("marks unclear labels and an unknown work model as unconfirmed, never as applicable", () => {
    expect(verdictFor(result({ label: "unclear" }), "CO")).toBe("unconfirmed");
    expect(verdictFor(result({ workModel: "unknown" }), "CO")).toBe("unconfirmed");
    expect(
      verdictFor(
        result({ workModel: "unknown", label: "country_specific", countries: ["MX"] }),
        "CO",
      ),
    ).toBeNull();
  });

  it("hides postings that exclude the country, even when unclear", () => {
    expect(verdictFor(result({ label: "unclear", excludedCountries: ["CO"] }), "CO")).toBeNull();
  });
});

describe("ageInDays", () => {
  it("uses the publication date, or the first time we saw the posting", () => {
    expect(ageInDays(daysAgo(10), daysAgo(1), now)).toBe(10);
    expect(ageInDays(null, daysAgo(4), now)).toBe(4);
  });
});

describe("excerptAround", () => {
  const text = `${"a".repeat(300)} We hire  anywhere in\nLatin America for this role. ${"b".repeat(300)}`;

  it("finds the quote despite spacing and case, and marks the cut ends", () => {
    const excerpt = excerptAround(text, "we hire anywhere in latin america", 20);
    expect(excerpt?.match).toBe("We hire anywhere in Latin America");
    expect(excerpt?.before.startsWith("…")).toBe(true);
    expect(excerpt?.after.endsWith("…")).toBe(true);
  });

  it("returns null when the quote is not in the body (title or location quotes)", () => {
    expect(excerptAround(text, "Remote - Colombia")).toBeNull();
    expect(excerptAround(text, "  ")).toBeNull();
  });

  it("treats regex characters in the quote literally", () => {
    expect(excerptAround("Pay: $5k (USD)+ per month", "$5k (USD)+")?.match).toBe("$5k (USD)+");
  });
});

describe("listJobs", () => {
  it("shows one card per vacancy, led by the posting in the user's country, with every country of the vacancy", () => {
    const rows = [
      row({ id: 1, siblingGroup: "g1", locationRaw: "Bogotá, Colombia", postedAt: daysAgo(5) }),
      row({ id: 2, siblingGroup: "g1", locationRaw: "Lima, Peru", postedAt: daysAgo(1) }),
      row({ id: 3, postedAt: daysAgo(2), locationRaw: "Remote - LATAM" }),
    ];
    const page = listJobs(rows, query(), now);
    expect(page.items.map((i) => i.id)).toEqual([3, 1]);
    expect(page.items[1]).toMatchObject({
      siblingCount: 1,
      siblingLocations: ["Lima, Peru"],
      groupCountries: ["CO", "PE"],
    });
    expect(page.total).toBe(2);
  });

  it("keeps a vacancy whose only visible posting is for the user's country and lists the others' countries", () => {
    const sezzleLike = (id: number, location: string, countries: string[]) =>
      row({
        id,
        siblingGroup: "g2",
        locationRaw: location,
        result: result({ label: "country_specific", countries }),
      });
    const rows = [
      sezzleLike(5, "Mexico, Remote", ["MX"]),
      sezzleLike(6, "Colombia, Remote", ["CO"]),
      row({ id: 7, siblingGroup: "g2", locationRaw: "US Remote", result: result({ label: "us_only" }) }),
    ];
    const page = listJobs(rows, query(), now);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 6, siblingCount: 2, groupCountries: ["CO", "MX", "US"] });
  });

  it("hides unconfirmed postings unless asked, and puts them after the applicable ones", () => {
    const rows = [
      row({ id: 10, result: result({ label: "unclear" }), postedAt: daysAgo(0) }),
      row({ id: 11, postedAt: daysAgo(30) }),
      row({ id: 12, result: result({ label: "us_only" }) }),
    ];
    expect(listJobs(rows, query(), now).items.map((i) => i.id)).toEqual([11]);
    const all = listJobs(rows, query({ showUnconfirmed: "1" }), now);
    expect(all.items.map((i) => [i.id, i.verdict])).toEqual([
      [11, "applicable"],
      [10, "unconfirmed"],
    ]);
    expect(all.counts).toEqual({ applicable: 1, unconfirmed: 1 });
  });

  it("filters by level (with a 'sin dato' bucket), age, company and accent-insensitive text", () => {
    const rows = [
      row({ id: 20, title: "Ingeniero de Datos", result: result({ seniority: "junior" }) }),
      row({ id: 21, company: "Beta", result: result({ seniority: null }), postedAt: daysAgo(200) }),
      row({ id: 22, result: result({ seniority: "senior" }) }),
    ];
    const ids = (input: Record<string, unknown>) =>
      listJobs(rows, query(input), now).items.map((i) => i.id);
    expect(ids({ seniority: "junior,unknown" })).toEqual([20, 21]);
    expect(ids({ maxAgeDays: "30" })).toEqual([22, 20]);
    expect(ids({ company: "beta" })).toEqual([21]);
    expect(ids({ q: "ingeniero DATOS" })).toEqual([20]);
    expect(listJobs(rows, query(), now).items.find((i) => i.id === 21)?.stale).toBe(true);
  });

  it("decides per country: a Mexico-only posting is not shown for Colombia", () => {
    const rows = [
      row({ id: 30, result: result({ label: "country_specific", countries: ["MX"] }) }),
    ];
    expect(listJobs(rows, query(), now).total).toBe(0);
    expect(listJobs(rows, query({ country: "MX" }), now).total).toBe(1);
  });

  it("paginates and caps evidence to 2 quotes of at most 160 characters", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: 40 + i, result: result({ evidence: ["x".repeat(300), "b", "c"] }) }),
    );
    const page = listJobs(rows, query({ page: "2", pageSize: "2" }), now);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.items[0]?.evidence).toHaveLength(2);
    expect(page.items[0]?.evidence[0]?.length).toBe(160);
  });
});

describe("postingCountries", () => {
  it("reads countries from the ATS location, or from a country_specific result when the location names none", () => {
    expect(postingCountries(row({ locationRaw: "Sucre, Bolivia" }))).toEqual(["BO"]);
    expect(postingCountries(row({ locationRaw: "Brazil | Latin America [Remote]" }))).toEqual(["BR"]);
    expect(
      postingCountries(
        row({ locationRaw: "Remote", result: result({ label: "country_specific", countries: ["AR"] }) }),
      ),
    ).toEqual(["AR"]);
    expect(postingCountries(row({ locationRaw: "Remote - LATAM" }))).toEqual([]);
  });
});

describe("summarizeOne", () => {
  it("returns null when the posting is not visible for the country", () => {
    const r = row({ result: result({ label: "us_only" }) });
    expect(summarizeOne(r, [], "CO", now)).toBeNull();
  });
});

describe("JobsQuerySchema", () => {
  it("defaults to Colombia, applicable only, first page", () => {
    expect(query()).toMatchObject({
      country: "CO",
      showUnconfirmed: false,
      page: 1,
      seniority: [],
    });
  });

  it("rejects an invalid country or level", () => {
    expect(JobsQuerySchema.safeParse({ country: "Colombia" }).success).toBe(false);
    expect(JobsQuerySchema.safeParse({ seniority: "guru" }).success).toBe(false);
  });
});
