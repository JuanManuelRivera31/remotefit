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
export {
  OutputValidationError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
} from "./llm/types.js";
export type {
  GenerateStructuredArgs,
  GenerateStructuredResult,
  LLMProvider,
  LLMUsage,
  ThinkingLevel,
} from "./llm/types.js";
export { GeminiProvider } from "./llm/gemini.js";
export { FakeLLMProvider } from "./llm/fake.js";
export type { FakeStep } from "./llm/fake.js";
export { equivalentCostUsd, priceFor, PRICING_SOURCE } from "./llm/pricing.js";
export { effectiveLimits, llmLimitsSchema, parseLimits } from "./llm/limits.js";
export type { EffectiveLimits, LlmLimitsConfig, ModelLimits } from "./llm/limits.js";
export { RateLimiter, quotaDay } from "./llm/rate-limiter.js";
export {
  ELIGIBILITY_LABELS,
  EligibilitySchema,
  RawEligibilitySchema,
} from "./eligibility/schema.js";
export type { Eligibility, EligibilityLabel, RawEligibility } from "./eligibility/schema.js";
export { LATAM_COUNTRIES, isApplicable } from "./eligibility/applicable.js";
export {
  ELIGIBILITY_PROMPT_VERSION,
  ELIGIBILITY_SYSTEM_PROMPT,
  buildUserMessage,
} from "./eligibility/prompt.js";
export type { PromptJob } from "./eligibility/prompt.js";
export { classifyJob, classifyRaw, finalizeOutcome } from "./eligibility/classify.js";
export type { ClassifyOptions, ClassifyOutcome, RawOutcome } from "./eligibility/classify.js";
export {
  POSTPROCESS_VERSION,
  countriesNamedInTitle,
  isQuoteInSource,
  postprocess,
  resultCacheKey,
} from "./eligibility/postprocess.js";
export type { ClassifyStatus, PostprocessOutcome } from "./eligibility/postprocess.js";
export { MeteredProvider } from "./llm/metered.js";
export {
  DEFAULT_QUOTA_LEDGER_URL,
  FileQuotaLedger,
  MemoryQuotaLedger,
  QuotaLedger,
  emptyQuotaState,
  quotaStateSchema,
  usedOn,
  withRequest,
} from "./llm/quota-ledger.js";
export type { PendingEval, QuotaState, SharedQuotaCounter } from "./llm/quota-ledger.js";
export { runClassifyQueue } from "./queue/classify-queue.js";
export type {
  QueueEvent,
  QueueJob,
  QueueModel,
  QueueOptions,
  QueueStopReason,
  QueueStore,
  QueueSummary,
  UsageDelta,
} from "./queue/classify-queue.js";
export {
  VERIFIER_PROMPT_VERSION,
  VERIFIER_SYSTEM_PROMPT,
  VerifierSchema,
  buildVerifierMessage,
  verifyPositive,
} from "./eligibility/verifier.js";
export type { VerifierAnswer, VerifierOptions, VerifierOutcome } from "./eligibility/verifier.js";
export * from "./api/index.js";
