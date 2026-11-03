import {
  OutputValidationError,
  type LLMProvider,
  type LLMUsage,
  type ThinkingLevel,
} from "../llm/types.js";
import {
  ELIGIBILITY_PROMPT_VERSION,
  ELIGIBILITY_SYSTEM_PROMPT,
  buildRetryMessage,
  buildUserMessage,
  type PromptJob,
} from "./prompt.js";
import { EligibilitySchema, type Eligibility } from "./schema.js";

/**
 * ok: valid answer with verified evidence.
 * evidence_unverified: the model picked an applicable-capable label but none of its quotes appears in the posting,
 *   so the result was downgraded to unclear (never applicable without evidence).
 * fallback_unclear: the answer did not validate (after one retry) or was blocked; the result is unclear.
 */
export type ClassifyStatus = "ok" | "evidence_unverified" | "fallback_unclear";

export interface ClassifyOutcome {
  result: Eligibility;
  status: ClassifyStatus;
  /** Tokens and cost summed over every attempt (retries consume quota too). */
  usage: LLMUsage;
  attempts: number;
  /** Validation problems seen, for logs and reports. */
  problems: string[];
  promptVersion: string;
}

export interface ClassifyOptions {
  model: string;
  thinkingLevel?: ThinkingLevel;
  maxTokens?: number;
}

const APPLICABLE_CAPABLE = new Set(["latam_eligible", "worldwide", "country_specific"]);
const MIN_FRAGMENT_CHARS = 6;

const normalizeForQuote = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’“”"']/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** A quote is verified when every fragment (split at "..." or "…") appears verbatim in the posting text. */
export function isQuoteInSource(quote: string, source: string): boolean {
  const haystack = normalizeForQuote(source);
  const fragments = quote
    .split(/\.{3}|…/)
    .map(normalizeForQuote)
    .filter((fragment) => fragment.length >= MIN_FRAGMENT_CHARS);
  return fragments.length > 0 && fragments.every((fragment) => haystack.includes(fragment));
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

/** A verifiable quote for results that did not come from a valid model answer: the location, else the title. */
function fallbackEvidence(job: PromptJob): string {
  const source = job.locationRaw.trim() || job.title.trim() || "(no text)";
  return source.slice(0, 160);
}

function unclearResult(job: PromptJob, base?: Eligibility): Eligibility {
  return {
    label: "unclear",
    countries: [],
    excludedCountries: [],
    workModel: base?.workModel ?? "unknown",
    workModelConflict: base?.workModelConflict ?? false,
    seniority: base?.seniority ?? "unknown",
    minYearsExperience: base?.minYearsExperience ?? null,
    hiringModel: base?.hiringModel ?? "unknown",
    timezoneRequirement: base?.timezoneRequirement ?? null,
    requiresUsWorkAuthorization: base?.requiresUsWorkAuthorization ?? null,
    postingLanguage: base?.postingLanguage ?? "other",
    evidence: [fallbackEvidence(job)],
  };
}

/**
 * Classifies one posting. An invalid answer gets ONE retry that includes the validation error; a second failure
 * becomes `unclear`. Quota and network errors (RateLimitError, QuotaExhaustedError, ProviderError) are NOT turned
 * into `unclear`: they propagate so the posting stays pending.
 */
export async function classifyJob(
  provider: LLMProvider,
  job: PromptJob,
  options: ClassifyOptions,
): Promise<ClassifyOutcome> {
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
        schema: EligibilitySchema,
        schemaName: "eligibility",
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      });
      usage = sumUsage(usage, response.usage);
      return finish(job, userMessage, response.data, usage, attempt, problems);
    } catch (error) {
      if (!(error instanceof OutputValidationError)) throw error;
      usage = sumUsage(usage, error.usage);
      problems.push(`attempt ${attempt}: ${error.message}`);
      // A blocked prompt will not change on retry.
      if (error.kind === "blocked" || attempt === 2) {
        return {
          result: unclearResult(job),
          status: "fallback_unclear",
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

function finish(
  job: PromptJob,
  sentText: string,
  data: Eligibility,
  usage: LLMUsage,
  attempts: number,
  problems: string[],
): ClassifyOutcome {
  const verified = data.evidence.some((quote) => isQuoteInSource(quote, sentText));
  if (APPLICABLE_CAPABLE.has(data.label) && !verified) {
    problems.push(`evidence not found in the posting: ${JSON.stringify(data.evidence)}`);
    return {
      result: unclearResult(job, data),
      status: "evidence_unverified",
      usage,
      attempts,
      problems,
      promptVersion: ELIGIBILITY_PROMPT_VERSION,
    };
  }
  return {
    result: data,
    status: "ok",
    usage,
    attempts,
    problems,
    promptVersion: ELIGIBILITY_PROMPT_VERSION,
  };
}
