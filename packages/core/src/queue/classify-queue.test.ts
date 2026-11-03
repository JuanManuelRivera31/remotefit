import { describe, expect, it } from "vitest";
import { FakeLLMProvider, type FakeStep } from "../llm/fake.js";
import { ProviderError, QuotaExhaustedError, RateLimitError } from "../llm/types.js";
import type { RawOutcome } from "../eligibility/classify.js";
import type { ClassifyOutcome } from "../eligibility/classify.js";
import {
  runClassifyQueue,
  type QueueEvent,
  type QueueJob,
  type QueueStore,
  type UsageDelta,
} from "./classify-queue.js";

const answer = {
  label: "country_specific",
  countries: ["CO"],
  excludedCountries: [],
  workModel: "remote",
  workModelConflict: false,
  seniority: "mid",
  minYearsExperience: null,
  hiringModel: "unknown",
  timezoneRequirement: null,
  requiresUsWorkAuthorization: null,
  postingLanguage: "en",
  evidence: ["Colombia, Remote"],
};
const ok: FakeStep = { data: answer };

const makeJob = (id: number): QueueJob => ({
  id,
  contentHash: `hash-${id}`,
  prompt: {
    title: "Software Engineer",
    locationRaw: "Colombia, Remote",
    workplaceType: null,
    descriptionText: "Fully remote role.",
  },
});
const jobs = (n: number): QueueJob[] => Array.from({ length: n }, (_, i) => makeJob(i + 1));

function memoryStore() {
  const saved: { jobId: number; model: string; label: string; status: string }[] = [];
  const usage = new Map<string, Required<UsageDelta>>();
  const store: QueueStore = {
    async save(entry: { job: QueueJob; model: string; raw: RawOutcome; outcome: ClassifyOutcome }) {
      saved.push({
        jobId: entry.job.id,
        model: entry.model,
        label: entry.outcome.result.label,
        status: entry.outcome.status,
      });
    },
    async recordUsage(model, delta) {
      const current = usage.get(model) ?? {
        requests: 0,
        rateLimited: 0,
        tokensIn: 0,
        tokensOut: 0,
        equivalentCostUsd: 0,
      };
      usage.set(model, {
        requests: current.requests + (delta.requests ?? 0),
        rateLimited: current.rateLimited + (delta.rateLimited ?? 0),
        tokensIn: current.tokensIn + (delta.tokensIn ?? 0),
        tokensOut: current.tokensOut + (delta.tokensOut ?? 0),
        equivalentCostUsd: current.equivalentCostUsd + (delta.equivalentCostUsd ?? 0),
      });
    },
  };
  return { store, saved, usage };
}

function harness() {
  const sleeps: number[] = [];
  const events: QueueEvent[] = [];
  return {
    sleeps,
    events,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    onEvent: (event: QueueEvent) => events.push(event),
  };
}

describe("runClassifyQueue", () => {
  it("classifies every posting in the given order and stores one result per posting", async () => {
    const { store, saved, usage } = memoryStore();
    const h = harness();
    const provider = new FakeLLMProvider([ok, ok, ok]);
    const summary = await runClassifyQueue({
      jobs: jobs(3),
      primary: { model: "m1", provider },
      store,
      sleep: h.sleep,
    });
    expect(summary).toMatchObject({ total: 3, classified: 3, pending: 0, stopped: null });
    expect(saved.map((s) => s.jobId)).toEqual([1, 2, 3]);
    expect(saved.every((s) => s.model === "m1" && s.label === "country_specific")).toBe(true);
    expect(usage.get("m1")?.tokensIn).toBe(3000);
  });

  it("waits with exponential backoff on 429 and then succeeds", async () => {
    const { store, saved, usage } = memoryStore();
    const h = harness();
    const provider = new FakeLLMProvider([new RateLimitError(), new RateLimitError(), ok, ok]);
    const summary = await runClassifyQueue({
      jobs: jobs(2),
      primary: { model: "m1", provider },
      store,
      sleep: h.sleep,
      backoffBaseMs: 1000,
    });
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(summary).toMatchObject({ classified: 2, pending: 0, rateLimitedResponses: 2 });
    expect(saved).toHaveLength(2);
    expect(usage.get("m1")?.rateLimited).toBe(2);
  });

  it("honours retryAfterMs when it is longer than the backoff", async () => {
    const { store } = memoryStore();
    const h = harness();
    const provider = new FakeLLMProvider([new RateLimitError(30_000), ok]);
    await runClassifyQueue({
      jobs: jobs(1),
      primary: { model: "m1", provider },
      store,
      sleep: h.sleep,
      backoffBaseMs: 1000,
    });
    expect(h.sleeps).toEqual([30_000]);
  });

  it("stops without losing postings when the daily quota runs out (429, then quota)", async () => {
    const { store, saved } = memoryStore();
    const h = harness();
    const provider = new FakeLLMProvider([ok, new RateLimitError(), new QuotaExhaustedError()]);
    const summary = await runClassifyQueue({
      jobs: jobs(5),
      primary: { model: "m1", provider },
      store,
      sleep: h.sleep,
      backoffBaseMs: 10,
      onEvent: h.onEvent,
    });
    expect(summary.classified).toBe(1);
    expect(summary.pending).toBe(4);
    expect(summary.stopped?.reason).toBe("quota_exhausted");
    expect(saved.map((s) => s.jobId)).toEqual([1]);
    expect(h.events.at(-1)?.kind).toBe("stopped");
    // Job 3 onwards were never touched: only 3 provider calls were made.
    expect(provider.callCount).toBe(3);
  });

  it("keeps a posting pending when 503 persists, then stops after consecutive failures (no fallback)", async () => {
    const { store, saved } = memoryStore();
    const h = harness();
    const down = new ProviderError("high demand", 503, true);
    const provider = new FakeLLMProvider(Array.from({ length: 6 }, () => down));
    const summary = await runClassifyQueue({
      jobs: jobs(5),
      primary: { model: "m1", provider },
      store,
      sleep: h.sleep,
      maxAttempts: 2,
      failuresBeforeStop: 3,
    });
    expect(saved).toHaveLength(0);
    expect(summary.classified).toBe(0);
    expect(summary.pending).toBe(5);
    expect(summary.failedJobIds).toEqual([1, 2, 3]);
    expect(summary.stopped?.reason).toBe("provider_unavailable");
  });

  it("switches to the fallback after sustained 503s and stores under the fallback's own model", async () => {
    const { store, saved } = memoryStore();
    const h = harness();
    const down = new ProviderError("high demand", 503, true);
    const primary = new FakeLLMProvider([down, down, down, down, down, down]);
    const fallback = new FakeLLMProvider([ok, ok, ok]);
    const summary = await runClassifyQueue({
      jobs: jobs(3),
      primary: { model: "m1", provider: primary },
      fallback: { model: "m2", provider: fallback },
      store,
      sleep: h.sleep,
      maxAttempts: 2,
      failuresBeforeStop: 3,
      onEvent: h.onEvent,
    });
    expect(summary.usedFallback).toBe(true);
    expect(summary.classified).toBe(3);
    expect(summary.pending).toBe(0);
    expect(saved.every((s) => s.model === "m2")).toBe(true);
    expect(summary.classifiedByModel).toEqual({ m2: 3 });
    expect(h.events.some((e) => e.kind === "switched_to_fallback")).toBe(true);
  });

  it("switches to the fallback when the primary's daily quota is exhausted, retrying the same posting", async () => {
    const { store, saved } = memoryStore();
    const primary = new FakeLLMProvider([ok, new QuotaExhaustedError()]);
    const fallback = new FakeLLMProvider([ok, ok]);
    const summary = await runClassifyQueue({
      jobs: jobs(3),
      primary: { model: "m1", provider: primary },
      fallback: { model: "m2", provider: fallback },
      store,
      sleep: async () => undefined,
    });
    expect(saved.map((s) => [s.jobId, s.model])).toEqual([
      [1, "m1"],
      [2, "m2"],
      [3, "m2"],
    ]);
    expect(summary.pending).toBe(0);
  });

  it("stops when both the primary and the fallback have no quota left", async () => {
    const { store } = memoryStore();
    const summary = await runClassifyQueue({
      jobs: jobs(3),
      primary: { model: "m1", provider: new FakeLLMProvider([new QuotaExhaustedError()]) },
      fallback: { model: "m2", provider: new FakeLLMProvider([new QuotaExhaustedError()]) },
      store,
      sleep: async () => undefined,
    });
    expect(summary).toMatchObject({ classified: 0, pending: 3 });
    expect(summary.stopped?.reason).toBe("quota_exhausted");
  });

  it("stops on a non-retryable provider error (bad key) instead of looping", async () => {
    const { store } = memoryStore();
    const provider = new FakeLLMProvider([new ProviderError("API key not valid", 400, false)]);
    const summary = await runClassifyQueue({
      jobs: jobs(3),
      primary: { model: "m1", provider },
      store,
      sleep: async () => undefined,
    });
    expect(summary.stopped).toEqual({ reason: "provider_error", message: "API key not valid" });
    expect(provider.callCount).toBe(1);
  });

  it("stores unclear (fallback_unclear) when the model never returns a valid answer, never for quota errors", async () => {
    const { store, saved } = memoryStore();
    const bad: FakeStep = { data: { label: "nonsense" } };
    const provider = new FakeLLMProvider([bad, bad, ok]);
    const summary = await runClassifyQueue({
      jobs: jobs(2),
      primary: { model: "m1", provider },
      store,
      sleep: async () => undefined,
    });
    expect(summary.classified).toBe(2);
    expect(saved[0]).toMatchObject({ jobId: 1, label: "unclear", status: "fallback_unclear" });
    expect(saved[1]).toMatchObject({ jobId: 2, label: "country_specific" });
  });
});
