import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLLMProvider } from "./fake.js";
import { effectiveLimits, parseLimits } from "./limits.js";
import { equivalentCostUsd, priceFor } from "./pricing.js";
import { RateLimiter, quotaDay } from "./rate-limiter.js";
import { OutputValidationError } from "./types.js";

describe("pricing", () => {
  it("prices the flash-lite models", () => {
    expect(priceFor("gemini-3.5-flash-lite")).toEqual({
      inputPerMTokUsd: 0.3,
      outputPerMTokUsd: 2.5,
    });
    expect(priceFor("gemini-3.1-flash-lite")).toEqual({
      inputPerMTokUsd: 0.25,
      outputPerMTokUsd: 1.5,
    });
  });

  it("doubles the Flash price from 2027", () => {
    const before = priceFor("gemini-3.8-flash", new Date("2026-12-31T23:00:00Z"));
    const after = priceFor("gemini-3.8-flash", new Date("2027-01-01T00:00:00Z"));
    expect(after.inputPerMTokUsd).toBe(before.inputPerMTokUsd * 2);
  });

  it("throws for an unknown model instead of returning 0", () => {
    expect(() => priceFor("gemini-9-unknown")).toThrow(/No equivalent price/);
  });

  it("bills thinking tokens as output", () => {
    const cost = equivalentCostUsd("gemini-3.5-flash-lite", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      thinkingTokens: 100_000,
    });
    expect(cost).toBeCloseTo(0.3 + 0.5, 6);
  });
});

describe("limits configuration (data/llm-limits.json)", () => {
  const config = parseLimits(
    JSON.parse(
      readFileSync(new URL("../../../../data/llm-limits.json", import.meta.url), "utf8"),
    ) as unknown,
  );

  it("validates and holds the owner's panel numbers", () => {
    expect(config.models["gemini-3.5-flash-lite"]).toMatchObject({
      rpm: 15,
      tpm: 250000,
      rpd: 500,
    });
    expect(config.models["gemini-3.8-flash"]).toMatchObject({ rpm: 5, rpd: 20 });
  });

  it("applies the safety margin below every limit", () => {
    expect(effectiveLimits(config, "gemini-3.5-flash-lite")).toMatchObject({
      rpm: 12,
      tpm: 200000,
      rpd: 400,
    });
    expect(effectiveLimits(config, "gemini-3.6-flash")).toMatchObject({ rpm: 4, rpd: 16 });
  });

  it("every configured model has a known price", () => {
    for (const model of Object.keys(config.models)) expect(() => priceFor(model)).not.toThrow();
  });

  it("rejects an unknown model and a malformed file", () => {
    expect(() => effectiveLimits(config, "nope")).toThrow(/not in data\/llm-limits.json/);
    expect(() => parseLimits({ models: {} })).toThrow();
  });
});

describe("RateLimiter", () => {
  const at = (iso: string) => new Date(iso);

  it("spaces requests by 60/rpm seconds", () => {
    let now = at("2026-11-02T12:00:00Z");
    const limiter = new RateLimiter({ rpm: 12, rpd: 100, now: () => now });
    expect(limiter.msUntilNextSlot()).toBe(0);
    limiter.record();
    expect(limiter.msUntilNextSlot()).toBe(5000);
    now = at("2026-11-02T12:00:03Z");
    expect(limiter.msUntilNextSlot()).toBe(2000);
    now = at("2026-11-02T12:00:06Z");
    expect(limiter.msUntilNextSlot()).toBe(0);
  });

  it("counts retries, reports what is left and warns once at 80 %", () => {
    const limiter = new RateLimiter({ rpm: 60, rpd: 10, now: () => at("2026-11-02T12:00:00Z") });
    for (let i = 0; i < 7; i += 1) limiter.record();
    expect(limiter.consumeWarning()).toBe(false);
    limiter.record();
    expect(limiter.consumeWarning()).toBe(true);
    expect(limiter.consumeWarning()).toBe(false);
    expect(limiter.remainingToday).toBe(2);
  });

  it("uses the Pacific quota day, not the local or UTC day", () => {
    // 2026-11-03 05:00 UTC is still 2026-11-02 21:00 in Los Angeles (PST, UTC-8).
    expect(quotaDay(at("2026-11-03T05:00:00Z"))).toBe("2026-11-02");
    expect(quotaDay(at("2026-11-03T08:00:00Z"))).toBe("2026-11-03");
  });

  it("resets the counter when the quota day rolls over and restores persisted usage", () => {
    let now = at("2026-11-03T07:59:00Z");
    const limiter = new RateLimiter({
      rpm: 60,
      rpd: 5,
      usedToday: 4,
      usedDay: "2026-11-02",
      now: () => now,
    });
    expect(limiter.usedTodayCount).toBe(4);
    limiter.record();
    expect(limiter.remainingToday).toBe(0);
    now = at("2026-11-03T08:01:00Z");
    expect(limiter.remainingToday).toBe(5);
    // Persisted usage from another day is ignored.
    const fresh = new RateLimiter({
      rpm: 60,
      rpd: 5,
      usedToday: 4,
      usedDay: "2026-11-01",
      now: () => now,
    });
    expect(fresh.usedTodayCount).toBe(0);
  });
});

describe("FakeLLMProvider", () => {
  const schema = z.object({ n: z.number() });
  const base = { model: "m", system: "s", user: "u", schema, schemaName: "x" };

  it("returns scripted answers, throws scripted errors and records calls", async () => {
    const fake = new FakeLLMProvider([{ data: { n: 1 } }, new Error("boom")]);
    expect((await fake.generateStructured(base)).data).toEqual({ n: 1 });
    await expect(fake.generateStructured(base)).rejects.toThrow("boom");
    expect(fake.callCount).toBe(2);
    await expect(fake.generateStructured(base)).rejects.toThrow(/ran out/);
  });

  it("turns schema-invalid answers into OutputValidationError like the real provider", async () => {
    const fake = new FakeLLMProvider([{ data: { n: "x" } }]);
    await expect(fake.generateStructured(base)).rejects.toBeInstanceOf(OutputValidationError);
  });
});
