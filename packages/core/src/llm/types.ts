import type { z } from "zod";

export interface LLMUsage {
  inputTokens: number;
  /** Visible output tokens (the JSON the model returned). */
  outputTokens: number;
  /** Tokens spent "thinking". They are billed as output and count against maxTokens. */
  thinkingTokens: number;
  /** Price if it were paid; the real spend on the free tier is USD 0. */
  equivalentCostUsd: number;
}

export type ThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface GenerateStructuredArgs<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  /** Hard cap on generated tokens, thinking included. */
  maxTokens?: number;
  thinkingLevel?: ThinkingLevel;
}

export interface GenerateStructuredResult<T> {
  data: T;
  usage: LLMUsage;
  model: string;
}

/** Every access to an LLM goes through this interface; the provider SDK/HTTP details never leave `src/llm/`. */
export interface LLMProvider {
  readonly name: string;
  generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<GenerateStructuredResult<T>>;
}

/** Per-minute limit (HTTP 429): retry after waiting. */
export class RateLimitError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super("rate limited");
    this.name = "RateLimitError";
  }
}

/** Daily quota exhausted: pause until the next quota day. */
export class QuotaExhaustedError extends Error {
  constructor(message = "daily quota exhausted") {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

/** The model answered, but not with a usable, schema-valid JSON. The classifier retries once, then falls back to unclear. */
export class OutputValidationError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid" | "truncated" | "blocked" | "empty",
    /** Tokens already spent by the failed call (retries consume quota too). */
    readonly usage?: LLMUsage,
  ) {
    super(message);
    this.name = "OutputValidationError";
  }
}

/** Network failure, auth/config problem or 5xx. It never becomes an `unclear` result: the posting stays pending. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
