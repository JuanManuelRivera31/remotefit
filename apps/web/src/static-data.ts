// Static mode (the published site, S11): no server. The browser downloads the public JSON once and answers the same
// questions the API answers, with the same pure functions of @remotefit/core/api (listJobs, verdictFor...).
import {
  JobsQuerySchema,
  PublicDataSchema,
  fromPublicJob,
  listJobs,
  postingCountries,
  summarizeOne,
  verdictFor,
  type ApiStatus,
  type JobDetail,
  type JobsPage,
  type ListingRow,
  type PublicData,
} from "@remotefit/core/api";

export interface LoadedData {
  data: PublicData;
  rows: ListingRow[];
}

/** Pure: the API's /api/jobs answer from the public data. */
export function staticJobs(loaded: LoadedData, query: URLSearchParams, now: Date): JobsPage {
  return listJobs(loaded.rows, JobsQuerySchema.parse(Object.fromEntries(query)), now);
}

/** Pure: the API's /api/jobs/:id answer (no excerpt: the public file has only the short quote). Null = 404. */
export function staticJob(
  loaded: LoadedData,
  id: number,
  country: string,
  now: Date,
): JobDetail | null {
  const row = loaded.rows.find((r) => r.id === id);
  if (!row) return null;
  const siblings = row.siblingGroup
    ? loaded.rows.filter((r) => r.siblingGroup === row.siblingGroup && r.id !== row.id)
    : [];
  const summary = summarizeOne(row, siblings, country, now);
  if (!summary) return null;
  return {
    ...summary,
    excerpt: null,
    siblings: siblings.map((s) => ({
      id: s.id,
      location: s.locationRaw,
      url: s.url,
      countries: postingCountries(s),
      visible: verdictFor(s.result, country) !== null,
    })),
    provenance: {
      promptVersion: loaded.data.classifier.promptVersion,
      model: loaded.data.classifier.model,
      postprocessVersion: loaded.data.classifier.postprocessVersion,
      status: row.result.status,
      classifiedAt: null,
    },
  };
}

/** Pure: the API's /api/status answer. */
export function staticStatus(loaded: LoadedData): ApiStatus {
  const { data } = loaded;
  return {
    classifier: data.classifier,
    acceptance: data.acceptance,
    measuredCountries: data.measuredCountries,
    pendingClassification: data.pendingClassification,
    dataGeneratedAt: data.generatedAt,
  };
}

export function parsePublicData(json: unknown): LoadedData {
  const data = PublicDataSchema.parse(json);
  return { data, rows: data.jobs.map(fromPublicJob) };
}

let loading: Promise<LoadedData> | null = null;

/** Downloads data/jobs.json once per page load (next to index.html, so it works under any base path). */
export function loadPublicData(): Promise<LoadedData> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/jobs.json`, { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parsePublicData(await response.json());
    })
    .catch((error: unknown) => {
      loading = null; // let a retry download it again
      throw error;
    });
  return loading;
}
