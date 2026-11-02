export const CORE_PACKAGE_NAME = "@remotefit/core";

export { connectors, ConnectorError } from "./ats/index.js";
export type { AtsConnector, FetchJobsResult } from "./ats/index.js";
export { htmlToText } from "./normalize/html.js";
export { ATS_NAMES, computeContentHash } from "./normalize/job.js";
export type { AtsName, CompanyRef, NormalizedJob, WorkplaceType } from "./normalize/job.js";
