import {
  OutputValidationError,
  type LLMProvider,
  type LLMUsage,
  type ThinkingLevel,
} from "../llm/types.js";
import { postprocess, POSTPROCESS_VERSION, type ClassifyStatus } from "./postprocess.js";
import {
  ELIGIBILITY_PROMPT_VERSION,
  ELIGIBILITY_SYSTEM_PROMPT,
  buildRetryMessage,
  buildUserMessage,
  type PromptJob,
} from "./prompt.js";
import { RawEligibilitySchema, type Eligibility, type RawEligibility } from "./schema.js";

export type { ClassifyStatus } from "./postprocess.js";

/**
 * What the model said, before any deterministic rule. `raw` is null when no valid answer was obtained (after one
 * retry, or a blocked prompt). This is the expensive part and the one worth caching by
 * content_hash + prompt_version + model.
 */
export interface RawOutcome {
  raw: RawEligibility | null;
  /** The exact text sent to the model; quotes are verified against it. */
  sentText: string;
  /** Tokens and cost summed over every attempt (retries consume quota too). */
  usage: LLMUsage;
  attempts: number;
  /** Validation problems seen, for logs and reports. */
  problems: string[];
  promptVersion: string;
}

export interface ClassifyOutcome {
  result: Eligibility;
  status: ClassifyStatus;
  /** What the deterministic rules did ("title_country:CO", "evidence_trimmed"...). */
  notes: string[];
  usage: LLMUsage;
  attempts: number;
  problems: string[];
  promptVersion: string;
  postprocessVersion: string;
}

export interface ClassifyOptions {
  model: string;
  thinkingLevel?: ThinkingLevel;
  maxTokens?: number;
}

const sumUsage = (a: LLMUsage, b: LLMUsage | undefined): LLMUsage =>
  b
    ? {
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        thinkingTokens: a.thinkingTokens + b.thinkingTokens,
        equivalentCostUsd: a.equivalentCostUsd + b.equivalentCostUsd,
      }
    : a;

const ZERO_USAGE: LLMUsage = {
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  equivalentCostUsd: 0,
};

/**
 * Asks the model once, with ONE retry that includes the validation error. Quota and network errors
 * (RateLimitError, QuotaExhaustedError, ProviderError) are NOT turned into anything: they propagate so the posting
 * stays pending. Nothing deterministic happens here, see `finalizeOutcome`.
 */
export async function classifyRaw(
  provider: LLMProvider,
  job: PromptJob,
  options: ClassifyOptions,
): Promise<RawOutcome> {
  const userMessage = buildUserMessage(job);
  const problems: string[] = [];
  let usage = ZERO_USAGE;
  let user = userMessage;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await provider.generateStructured({
        model: options.model,
        system: ELIGIBILITY_SYSTEM_PROMPT,
        user,
        schema: RawEligibilitySchema,
        schemaName: "eligibility",
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      });
      usage = sumUsage(usage, response.usage);
      return {
        raw: response.data,
        sentText: userMessage,
        usage,
        attempts: attempt,
        problems,
        promptVersion: ELIGIBILITY_PROMPT_VERSION,
      };
    } catch (error) {
      if (!(error instanceof OutputValidationError)) throw error;
      usage = sumUsage(usage, error.usage);
      problems.push(`attempt ${attempt}: ${error.message}`);
      // A blocked prompt will not change on retry.
      if (error.kind === "blocked" || attempt === 2) {
        return {
          raw: null,
          sentText: userMessage,
          usage,
          attempts: attempt,
          problems,
          promptVersion: ELIGIBILITY_PROMPT_VERSION,
        };
      }
      user = buildRetryMessage(userMessage, error.message);
    }
  }
  /* c8 ignore next */
  throw new Error("unreachable");
}

/** Applies the deterministic post-processing to a raw outcome. Pure and free: safe to rerun when a rule changes. */
export function finalizeOutcome(rawOutcome: RawOutcome, job: PromptJob): ClassifyOutcome {
  const processed = postprocess(rawOutcome.raw, job, rawOutcome.sentText);
  const problems =
    processed.status === "evidence_unverified"
      ? [
          ...rawOutcome.problems,
          `evidence not found in the posting: ${JSON.stringify(rawOutcome.raw?.evidence ?? [])}`,
        ]
      : rawOutcome.problems;
  return {
    result: processed.result,
    status: processed.status,
    notes: processed.notes,
    usage: rawOutcome.usage,
    attempts: rawOutcome.attempts,
    problems,
    promptVersion: rawOutcome.promptVersion,
    postprocessVersion: POSTPROCESS_VERSION,
  };
}

/** Classifies one posting: the model's answer plus the deterministic rules. */
export async function classifyJob(
  provider: LLMProvider,
  job: PromptJob,
  options: ClassifyOptions,
): Promise<ClassifyOutcome> {
  return finalizeOutcome(await classifyRaw(provider, job, options), job);
}
