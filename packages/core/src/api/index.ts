// Browser-safe entry point (`@remotefit/core/api`): the S9 contract and the pure listing logic. apps/web imports
// only this, never the root entry (which pulls Node modules such as node:fs).
export * from "./contract.js";
export {
  ageInDays,
  excerptAround,
  fold,
  listJobs,
  seniorityOf,
  summarizeOne,
  trimEvidence,
  verdictFor,
} from "./listing.js";
export type { ListingResult, ListingRow } from "./listing.js";
export {
  CLASSIFIER_DECISIONS,
  DEFAULT_CLASSIFY_MODEL,
  decisionFor,
} from "../eligibility/decisions.js";
export type {
  AcceptanceState,
  ClassifierDecision,
  ClassifierKey,
} from "../eligibility/decisions.js";
