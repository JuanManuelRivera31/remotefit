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

export const fetchJobs = (filters: Filters): Promise<JobsPage> =>
  getJson(`/api/jobs?${apiQueryFromFilters(filters)}`, JobsPageSchema);

export const fetchJob = (id: number, country: string): Promise<JobDetail> =>
  getJson(`/api/jobs/${id}?country=${encodeURIComponent(country)}`, JobDetailSchema);

export const fetchStatus = (): Promise<ApiStatus> => getJson("/api/status", ApiStatusSchema);
