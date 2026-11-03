import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiProvider, buildResponseJsonSchema } from "./gemini.js";
import {
  OutputValidationError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
} from "./types.js";

const SECRET = "test-secret-key-123";
const schema = z.object({
  label: z.enum(["a", "b"]),
  code: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .max(2),
});
const args = {
  model: "gemini-3.5-flash-lite",
  system: "sys",
  user: "usr",
  schema,
  schemaName: "test",
  thinkingLevel: "MINIMAL" as const,
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(
  reply: { status?: number; body: unknown; headers?: Record<string, string> },
  captured?: Captured[],
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured?.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as typeof fetch;
}

const ok = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: {
    promptTokenCount: 1000,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 30,
    totalTokenCount: 1050,
  },
  ...extra,
});

const provider = (reply: Parameters<typeof fakeFetch>[0], captured?: Captured[]) =>
  new GeminiProvider({
    apiKey: SECRET,
    fetch: fakeFetch(reply, captured),
    now: () => new Date("2026-11-02T00:00:00Z"),
  });

describe("GeminiProvider request", () => {
  it("sends the key in a header, asks for JSON and sets the thinking level", async () => {
    const captured: Captured[] = [];
    await provider({ body: ok('{"label":"a","code":"CO"}') }, captured).generateStructured(args);
    const call = captured[0];
    expect(call?.url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(call?.url).not.toContain(SECRET);
    expect(call?.headers["x-goog-api-key"]).toBe(SECRET);
    const config = call?.body["generationConfig"] as Record<string, unknown>;
    expect(config["responseMimeType"]).toBe("application/json");
    expect(config["thinkingConfig"]).toEqual({ thinkingLevel: "MINIMAL" });
    expect(config["maxOutputTokens"]).toBe(1024);
    expect(call?.body["systemInstruction"]).toEqual({ parts: [{ text: "sys" }] });
  });

  it("sends a JSON Schema without keywords Gemini ignores", () => {
    const json = JSON.stringify(buildResponseJsonSchema(schema));
    for (const key of ["$schema", "pattern", "maxLength", "minLength"]) {
      expect(json).not.toContain(`"${key}"`);
    }
    expect(json).toContain('"enum":["a","b"]');
    expect(json).toContain('"required"');
  });
});

describe("GeminiProvider response", () => {
  it("returns validated data, splits visible and thinking tokens and prices them", async () => {
    const result = await provider({ body: ok('{"label":"b","code":"MX"}') }).generateStructured(
      args,
    );
    expect(result.data).toEqual({ label: "b", code: "MX" });
    expect(result.usage).toMatchObject({ inputTokens: 1000, outputTokens: 20, thinkingTokens: 30 });
    // 1000 * 0.30/1M + (20 + 30) * 2.50/1M
    expect(result.usage.equivalentCostUsd).toBeCloseTo(0.000425, 7);
  });

  it("ignores thought parts and joins the visible text", async () => {
    const body = {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "secret reasoning", thought: true },
              { text: '{"label":"a",' },
              { text: '"code":"CO"}' },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 5 },
    };
    const result = await provider({ body }).generateStructured(args);
    expect(result.data.code).toBe("CO");
  });

  it.each([
    ["MAX_TOKENS", "truncated"],
    ["SAFETY", "blocked"],
    ["OTHER", "invalid"],
  ])("treats finishReason %s as an output problem (%s)", async (finishReason, kind) => {
    const body = {
      candidates: [{ finishReason, content: { parts: [{ text: '{"label":"a","code":"CO"}' }] } }],
    };
    const error = await provider({ body })
      .generateStructured(args)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OutputValidationError);
    expect((error as OutputValidationError).kind).toBe(kind);
  });

  it("reports a blocked prompt, an empty answer and non-JSON text as validation errors", async () => {
    const blocked = { promptFeedback: { blockReason: "SAFETY" } };
    await expect(provider({ body: blocked }).generateStructured(args)).rejects.toMatchObject({
      kind: "blocked",
    });
    const empty = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "  " }] } }] };
    await expect(provider({ body: empty }).generateStructured(args)).rejects.toMatchObject({
      kind: "empty",
    });
    await expect(provider({ body: ok("not json") }).generateStructured(args)).rejects.toMatchObject(
      { kind: "invalid" },
    );
  });

  it("rejects JSON that does not satisfy the Zod schema, keeping the spent usage for the caller", async () => {
    const error = await provider({ body: ok('{"label":"zzz","code":"colombia"}') })
      .generateStructured(args)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OutputValidationError);
    expect((error as OutputValidationError).usage?.inputTokens).toBe(1000);
  });
});

describe("GeminiProvider errors", () => {
  it("maps a per-minute 429 to RateLimitError with the suggested delay", async () => {
    const body = {
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" },
        ],
      },
    };
    const error = await provider({ status: 429, body })
      .generateStructured(args)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(34_000);
  });

  it("maps a per-day 429 to QuotaExhaustedError", async () => {
    const body = {
      error: {
        code: 429,
        message: "Quota exceeded",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
          },
        ],
      },
    };
    await expect(provider({ status: 429, body }).generateStructured(args)).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
  });

  it("treats an unparseable 429 as a per-minute limit, honouring Retry-After", async () => {
    const error = await provider({
      status: 429,
      body: "slow down",
      headers: { "retry-after": "7" },
    })
      .generateStructured(args)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(7000);
  });

  it("marks 5xx as retryable and 4xx as not", async () => {
    const e500 = await provider({ status: 503, body: { error: { message: "overloaded" } } })
      .generateStructured(args)
      .catch((e: unknown) => e);
    expect(e500).toBeInstanceOf(ProviderError);
    expect((e500 as ProviderError).retryable).toBe(true);
    const e400 = await provider({ status: 400, body: { error: { message: "bad schema" } } })
      .generateStructured(args)
      .catch((e: unknown) => e);
    expect((e400 as ProviderError).retryable).toBe(false);
  });

  it("never leaks the API key in error messages", async () => {
    const leaky = { error: { message: `API key ${SECRET} is invalid` } };
    const error = await provider({ status: 403, body: leaky })
      .generateStructured(args)
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).message).toContain("[redacted]");

    const network = new GeminiProvider({
      apiKey: SECRET,
      fetch: (async () => {
        throw new Error(`connect failed for key=${SECRET}`);
      }) as typeof fetch,
    });
    const netError = await network.generateStructured(args).catch((e: unknown) => e);
    expect(netError).toBeInstanceOf(ProviderError);
    expect((netError as Error).message).not.toContain(SECRET);
  });

  it("requires an API key", () => {
    expect(() => new GeminiProvider({ apiKey: "" })).toThrow(/API key/);
  });
});
