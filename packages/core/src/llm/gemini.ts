import { z } from "zod";
import { equivalentCostUsd } from "./pricing.js";
import {
  OutputValidationError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  type GenerateStructuredArgs,
  type GenerateStructuredResult,
  type LLMProvider,
  type LLMUsage,
} from "./types.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 60_000;
/** Headroom above the < 300 token goal: thinking tokens count against this cap too. */
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export interface GeminiProviderOptions {
  apiKey: string;
  /** Injectable so tests never touch the network. */
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
}

// Only the fields we use; everything else passes through untouched.
const responseSchema = z.looseObject({
  candidates: z
    .array(
      z.looseObject({
        content: z
          .looseObject({
            parts: z
              .array(
                z.looseObject({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
        finishMessage: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.looseObject({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .looseObject({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});

/** Keywords Gemini documents as supported; anything else (pattern, min/maxLength, $schema...) is dropped. */
const SUPPORTED_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "items",
  "minItems",
  "maxItems",
  "anyOf",
]);

function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && value && typeof value === "object") {
      // Property NAMES are free-form; only the schemas under them are filtered.
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, toGeminiSchema(schema)]),
      );
    } else if (SUPPORTED_SCHEMA_KEYS.has(key)) {
      out[key] = toGeminiSchema(value);
    }
  }
  return out;
}

/** Zod schema -> the JSON Schema subset accepted by `responseJsonSchema`. Zod keeps enforcing the stripped rules. */
export function buildResponseJsonSchema(schema: z.ZodType): unknown {
  return toGeminiSchema(z.toJSONSchema(schema, { io: "output" }));
}

function parseRetryDelayMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match?.[1] ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

/** Maps a failed HTTP response to the errors the rest of the system understands. */
export function mapHttpError(status: number, bodyText: string, secret: string): Error {
  const clean = (text: string): string => redact(text, secret).slice(0, 300);
  const errorBody = z.looseObject({
    error: z
      .looseObject({
        message: z.string().optional(),
        details: z.array(z.unknown()).optional(),
      })
      .optional(),
  });
  let message: string;
  let details: unknown[];
  try {
    const parsed = errorBody.parse(JSON.parse(bodyText));
    message = parsed.error?.message ?? "";
    details = parsed.error?.details ?? [];
  } catch {
    message = bodyText;
    details = [];
  }

  if (status === 429) {
    const text = JSON.stringify(details) + message;
    // The documented quota ids look like "GenerateRequestsPerDayPerProjectPerModel-FreeTier".
    const daily = /PerDay|per day|daily/i.test(text);
    if (daily) return new QuotaExhaustedError(clean(message || "daily quota exhausted"));
    let retryMs: number | undefined;
    for (const detail of details) {
      if (detail && typeof detail === "object" && "retryDelay" in detail) {
        retryMs = parseRetryDelayMs((detail as { retryDelay: unknown }).retryDelay);
      }
    }
    return new RateLimitError(retryMs);
  }
  const retryable = status >= 500;
  return new ProviderError(`Gemini HTTP ${status}: ${clean(message)}`, status, retryable);
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) throw new Error("GeminiProvider needs an API key.");
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.now = options.now ?? (() => new Date());
  }

  async generateStructured<T>(
    args: GenerateStructuredArgs<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json",
      responseJsonSchema: buildResponseJsonSchema(args.schema),
      maxOutputTokens: args.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    };
    if (args.thinkingLevel)
      generationConfig["thinkingConfig"] = { thinkingLevel: args.thinkingLevel };

    const body = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: "user", parts: [{ text: args.user }] }],
      generationConfig,
    };

    let response: Response;
    try {
      // The key travels in a header, never in the URL, so it cannot end up in logs.
      response = await this.fetchFn(
        `${this.baseUrl}/models/${encodeURIComponent(args.model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderError(
        `Gemini request failed: ${redact(reason, this.apiKey)}`,
        undefined,
        true,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      const mapped = mapHttpError(response.status, text, this.apiKey);
      if (mapped instanceof RateLimitError && mapped.retryAfterMs === undefined) {
        const header = Number(response.headers.get("retry-after"));
        if (Number.isFinite(header) && header > 0)
          return Promise.reject(new RateLimitError(header * 1000));
      }
      throw mapped;
    }

    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(JSON.parse(text));
    } catch {
      throw new ProviderError(
        "Gemini returned a response that is not the expected JSON.",
        response.status,
      );
    }

    const meta = parsed.usageMetadata;
    const tokens = {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: meta?.candidatesTokenCount ?? 0,
      thinkingTokens: meta?.thoughtsTokenCount ?? 0,
    };
    const usage: LLMUsage = {
      ...tokens,
      equivalentCostUsd: equivalentCostUsd(args.model, tokens, this.now()),
    };

    const blockReason = parsed.promptFeedback?.blockReason;
    if (blockReason) {
      throw new OutputValidationError(`Prompt blocked (${blockReason}).`, "blocked", usage);
    }
    const candidate = parsed.candidates?.[0];
    if (!candidate)
      throw new OutputValidationError("No candidate in the response.", "empty", usage);
    const finish = candidate.finishReason;
    if (finish === "MAX_TOKENS") {
      throw new OutputValidationError("Output cut off (MAX_TOKENS).", "truncated", usage);
    }
    if (finish !== "STOP") {
      throw new OutputValidationError(
        `Generation ended with ${finish ?? "no finish reason"}${candidate.finishMessage ? `: ${candidate.finishMessage}` : ""}.`,
        finish === "SAFETY" ? "blocked" : "invalid",
        usage,
      );
    }
    const answer = (candidate.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    if (answer.trim() === "") throw new OutputValidationError("Empty answer.", "empty", usage);

    let json: unknown;
    try {
      json = JSON.parse(answer);
    } catch {
      throw new OutputValidationError("The answer is not valid JSON.", "invalid", usage);
    }
    const validated = args.schema.safeParse(json);
    if (!validated.success) {
      throw new OutputValidationError(
        z.prettifyError(validated.error).slice(0, 600),
        "invalid",
        usage,
      );
    }
    return { data: validated.data, usage, model: args.model };
  }
}
