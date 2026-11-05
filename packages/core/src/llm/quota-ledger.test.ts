import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLLMProvider } from "./fake.js";
import { MeteredProvider } from "./metered.js";
import {
  FileQuotaLedger,
  MemoryQuotaLedger,
  emptyQuotaState,
  usedOn,
  withRequest,
} from "./quota-ledger.js";
import { RateLimiter } from "./rate-limiter.js";
import { QuotaExhaustedError } from "./types.js";

const args = {
  model: "m",
  system: "s",
  user: "u",
  schema: z.object({ n: z.number() }),
  schemaName: "x",
};

describe("quota state", () => {
  it("counts per model and day, and a new day restarts the count", () => {
    let state = emptyQuotaState();
    state = withRequest(state, "a", "2026-11-04");
    state = withRequest(state, "a", "2026-11-04");
    state = withRequest(state, "b", "2026-11-04");
    expect(usedOn(state, "a", "2026-11-04")).toBe(2);
    expect(usedOn(state, "b", "2026-11-04")).toBe(1);
    expect(usedOn(state, "a", "2026-11-05")).toBe(0);
    state = withRequest(state, "a", "2026-11-05");
    expect(usedOn(state, "a", "2026-11-05")).toBe(1);
  });
});

describe("FileQuotaLedger", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("is shared by two instances (two processes) and keeps the pending-eval reservation", async () => {
    dir = mkdtempSync(join(tmpdir(), "rf-quota-"));
    const path = join(dir, "llm-quota.json");
    const evalSide = new FileQuotaLedger(path);
    const classifySide = new FileQuotaLedger(path);
    await evalSide.record("m", "2026-11-04");
    await classifySide.record("m", "2026-11-04");
    expect(await evalSide.used("m", "2026-11-04")).toBe(2);

    await evalSide.setPendingEval({
      split: "test",
      model: "m",
      promptVersion: "eligibility-v4",
      postprocessVersion: "postprocess-v3",
      remaining: 144,
      since: "2026-11-04T22:00:00Z",
    });
    expect((await classifySide.pendingEval())?.remaining).toBe(144);
    await evalSide.clearPendingEval();
    expect(await classifySide.pendingEval()).toBeNull();
    expect(await classifySide.used("m", "2026-11-04")).toBe(2);
  });

  it("fails loudly on a corrupt file instead of resetting the count to 0", async () => {
    dir = mkdtempSync(join(tmpdir(), "rf-quota-"));
    const path = join(dir, "llm-quota.json");
    writeFileSync(path, "{ not json");
    await expect(new FileQuotaLedger(path).used("m", "2026-11-04")).rejects.toThrow();
  });
});

describe("MeteredProvider with a shared counter", () => {
  it("counts requests made by another process against the daily limit", async () => {
    const now = new Date("2026-11-04T20:00:00Z"); // 2026-11-04 in Pacific time
    const ledger = new MemoryQuotaLedger();
    await ledger.record("m", "2026-11-04"); // the eval already spent two requests today
    await ledger.record("m", "2026-11-04");
    const fake = new FakeLLMProvider([{ data: { n: 1 } }, { data: { n: 2 } }]);
    const metered = new MeteredProvider(
      fake,
      new RateLimiter({ rpm: 6000, rpd: 3, now: () => now }),
      { sleep: async () => undefined, shared: ledger.counterFor("m") },
    );
    await metered.generateStructured(args);
    expect(await ledger.used("m", "2026-11-04")).toBe(3);
    await expect(metered.generateStructured(args)).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(fake.callCount).toBe(1);
  });
});
