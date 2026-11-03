export const CORE_PACKAGE_NAME = "@remotefit/core";

export { connectors, ConnectorError } from "./ats/index.js";
export type { AtsConnector, FetchJobsResult } from "./ats/index.js";
export { htmlToText } from "./normalize/html.js";
export { ATS_NAMES, computeContentHash } from "./normalize/job.js";
export type { AtsName, CompanyRef, NormalizedJob, WorkplaceType } from "./normalize/job.js";
export { assignSiblingGroups, isReliableRequisitionId, normalizeTitle } from "./ingest/siblings.js";
export type { SiblingInput } from "./ingest/siblings.js";
export { reconcileBoard } from "./ingest/reconcile.js";
export type { ReconcilePlan, StoredJobState } from "./ingest/reconcile.js";
export {
  PREFILTER_RULES,
  PREFILTER_RULE_KINDS,
  PREFILTER_VERSION,
  evaluatePrefilterRules,
  prefilterJob,
} from "./rules/prefilter.js";
export type { PrefilterInput, PrefilterResult, PrefilterRule, RuleHit } from "./rules/prefilter.js";
