import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLLMProvider } from "./fake.js";
import { MeteredProvider } from "./metered.js";
import { RateLimiter } from "./rate-limiter.js";
import { QuotaExhaustedError } from "./types.js";

const args = {
  model: "m",
  system: "s",
  user: "u",
  schema: z.object({ n: z.number() }),
  schemaName: "x",
};

describe("MeteredProvider", () => {
  it("waits for the RPM slot, counts every call and stops at the daily limit without calling the provider", async () => {
    let now = new Date("2026-11-02T12:00:00Z");
    const sleeps: number[] = [];
    const limiter = new RateLimiter({ rpm: 12, rpd: 2, now: () => now });
    const fake = new FakeLLMProvider([{ data: { n: 1 } }, { data: { n: 2 } }, { data: { n: 3 } }]);
    let requests = 0;
    const metered = new MeteredProvider(fake, limiter, {
      sleep: async (ms) => {
        sleeps.push(ms);
        now = new Date(now.getTime() + ms);
      },
      onRequest: () => {
        requests += 1;
      },
    });

    await metered.generateStructured(args);
    await metered.generateStructured(args);
    expect(sleeps).toEqual([5000]); // the second call waited for the 5 s spacing
    expect(requests).toBe(2);

    await expect(metered.generateStructured(args)).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(fake.callCount).toBe(2);
  });
});
