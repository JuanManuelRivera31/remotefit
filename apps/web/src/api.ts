// Typed client: every response is validated with the shared Zod contract before the UI uses it.
import {
  ApiErrorSchema,
  ApiStatusSchema,
  JobDetailSchema,
  JobsPageSchema,
  type ApiStatus,
  type JobDetail,
  type JobsPage,
} from "@remotefit/core/api";
import type { z } from "zod";
import { apiQueryFromFilters, type Filters } from "./filters.js";
import { loadPublicData, staticJob, staticJobs, staticStatus } from "./static-data.js";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      response.status,
      parsed.success ? parsed.data.error.code : "http_error",
      parsed.success ? parsed.data.error.message : `HTTP ${response.status}`,
    );
  }
  return schema.parse(body);
}

/** "static" on the published site (data/jobs.json, no server); the API otherwise (local development). */
export const STATIC_MODE = import.meta.env.VITE_DATA_MODE === "static";

export const fetchJobs = async (filters: Filters): Promise<JobsPage> =>
  STATIC_MODE
    ? staticJobs(await loadPublicData(), new URLSearchParams(apiQueryFromFilters(filters)), new Date())
    : getJson(`/api/jobs?${apiQueryFromFilters(filters)}`, JobsPageSchema);

export const fetchJob = async (id: number, country: string): Promise<JobDetail> => {
  if (!STATIC_MODE) {
    return getJson(`/api/jobs/${id}?country=${encodeURIComponent(country)}`, JobDetailSchema);
  }
  const job = staticJob(await loadPublicData(), id, country, new Date());
  if (!job) throw new ApiRequestError(404, "not_found", "Posting not found");
  return job;
};

export const fetchStatus = async (): Promise<ApiStatus> =>
  STATIC_MODE ? staticStatus(await loadPublicData()) : getJson("/api/status", ApiStatusSchema);
