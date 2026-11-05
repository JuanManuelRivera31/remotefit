import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  apiQueryFromFilters,
  countryName,
  filtersFromParams,
  isMeasured,
  paramsFromFilters,
} from "./filters.js";

describe("filters in the URL", () => {
  it("defaults to Colombia, applicable only, page 1, and a plain URL", () => {
    expect(filtersFromParams(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
    expect(paramsFromFilters(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("round-trips every filter through Spanish URL parameters", () => {
    const filters = {
      country: "MX",
      seniority: ["junior" as const, "unknown" as const],
      maxAgeDays: 30,
      company: "Nortal",
      q: "react native",
      showUnconfirmed: true,
      page: 3,
    };
    const params = paramsFromFilters(filters);
    expect(params.get("pais")).toBe("MX");
    expect(params.get("sin_confirmar")).toBe("1");
    expect(filtersFromParams(params)).toEqual(filters);
  });

  it("ignores unknown or malformed values instead of failing", () => {
    const filters = filtersFromParams(
      new URLSearchParams("pais=XX&nivel=guru,senior&dias=-4&pagina=abc&sin_confirmar=yes"),
    );
    expect(filters).toMatchObject({
      country: "CO",
      seniority: ["senior"],
      maxAgeDays: null,
      page: 1,
      showUnconfirmed: false,
    });
  });

  it("maps to the API query names", () => {
    const query = new URLSearchParams(
      apiQueryFromFilters({ ...DEFAULT_FILTERS, seniority: ["mid"], showUnconfirmed: true }),
    );
    expect(Object.fromEntries(query)).toEqual({
      country: "CO",
      page: "1",
      seniority: "mid",
      showUnconfirmed: "1",
    });
  });

  it("counts active filters besides the country, for the folded mobile bar", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, country: "MX" })).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_FILTERS, seniority: ["mid"], q: "react", showUnconfirmed: true }),
    ).toBe(3);
  });

  it("names every country in Spanish, also those outside the selector", () => {
    expect(countryName("CO")).toBe("Colombia");
    expect(countryName("BZ")).toBe("Belice");
    expect(countryName("US")).toBe("Estados Unidos");
  });

  it("marks only Colombia as measured", () => {
    expect(isMeasured("CO")).toBe(true);
    expect(isMeasured("MX")).toBe(false);
  });
});
