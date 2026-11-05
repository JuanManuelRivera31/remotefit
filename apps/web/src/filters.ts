// Filters live in the URL (no login, no stored personal data): Spanish parameter names for the user, mapped to the
// API's query. Pure functions, tested without a browser.
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  MEASURED_COUNTRIES,
  SENIORITY_FILTERS,
  type SeniorityFilter,
} from "@remotefit/core/api";

export interface Filters {
  country: string;
  seniority: SeniorityFilter[];
  maxAgeDays: number | null;
  company: string;
  q: string;
  showUnconfirmed: boolean;
  page: number;
}

export const DEFAULT_FILTERS: Filters = {
  country: DEFAULT_COUNTRY,
  seniority: [],
  maxAgeDays: null,
  company: "",
  q: "",
  showUnconfirmed: false,
  page: 1,
};

const KNOWN_COUNTRIES = new Set(COUNTRY_OPTIONS.map((c) => c.code));
const KNOWN_LEVELS: ReadonlySet<string> = new Set(SENIORITY_FILTERS);

const positiveInt = (value: string | null): number | null => {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n > 0 ? n : null;
};

/** Reads the filters from the page URL; anything unknown or malformed falls back to the default. */
export function filtersFromParams(params: URLSearchParams): Filters {
  const country = (params.get("pais") ?? "").toUpperCase();
  return {
    country: KNOWN_COUNTRIES.has(country) ? country : DEFAULT_COUNTRY,
    seniority: (params.get("nivel") ?? "")
      .split(",")
      .filter((level): level is SeniorityFilter => KNOWN_LEVELS.has(level)),
    maxAgeDays: positiveInt(params.get("dias")),
    company: (params.get("empresa") ?? "").trim(),
    q: (params.get("q") ?? "").trim(),
    showUnconfirmed: params.get("sin_confirmar") === "1",
    page: positiveInt(params.get("pagina")) ?? 1,
  };
}

/** The page URL for some filters, omitting defaults so a plain link is "/". */
export function paramsFromFilters(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.country !== DEFAULT_COUNTRY) params.set("pais", filters.country);
  if (filters.seniority.length > 0) params.set("nivel", filters.seniority.join(","));
  if (filters.maxAgeDays !== null) params.set("dias", String(filters.maxAgeDays));
  if (filters.company) params.set("empresa", filters.company);
  if (filters.q) params.set("q", filters.q);
  if (filters.showUnconfirmed) params.set("sin_confirmar", "1");
  if (filters.page > 1) params.set("pagina", String(filters.page));
  return params;
}

/** The query string for GET /api/jobs. */
export function apiQueryFromFilters(filters: Filters): string {
  const params = new URLSearchParams({ country: filters.country, page: String(filters.page) });
  if (filters.seniority.length > 0) params.set("seniority", filters.seniority.join(","));
  if (filters.maxAgeDays !== null) params.set("maxAgeDays", String(filters.maxAgeDays));
  if (filters.company) params.set("company", filters.company);
  if (filters.q) params.set("q", filters.q);
  if (filters.showUnconfirmed) params.set("showUnconfirmed", "1");
  return params.toString();
}

export const isMeasured = (country: string): boolean => MEASURED_COUNTRIES.includes(country);

export const countryName = (code: string): string =>
  COUNTRY_OPTIONS.find((c) => c.code === code)?.name ?? code;
