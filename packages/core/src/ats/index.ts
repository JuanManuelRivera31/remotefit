import type { AtsName, CompanyRef, NormalizedJob } from "../normalize/job.js";
import * as ashby from "./ashby.js";
import * as greenhouse from "./greenhouse.js";
import * as lever from "./lever.js";
import type { ConnectorDeps, FetchJobsResult } from "./http.js";

export interface AtsConnector {
  fetchJobs(boardToken: string, deps?: ConnectorDeps): Promise<FetchJobsResult<unknown>>;
  toNormalizedJob(raw: unknown, company: CompanyRef): NormalizedJob;
}

export const connectors: Record<AtsName, AtsConnector> = { greenhouse, lever, ashby };

export { ConnectorError, USER_AGENT } from "./http.js";
export type { ConnectorDeps, FetchJobsResult } from "./http.js";
