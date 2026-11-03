import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { EligibilitySchema } from "../src/eligibility/schema.js";
import type { ClassifyOutcome } from "../src/eligibility/classify.js";

// Git-ignored. Holds classifier outcomes of posting texts, so interrupted runs resume without repeating calls.
const CACHE_DIR = new URL("cache/", import.meta.url);

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  thinkingTokens: z.number(),
  equivalentCostUsd: z.number(),
});
const outcomeSchema = z.object({
  result: EligibilitySchema,
  status: z.enum(["ok", "evidence_unverified", "fallback_unclear"]),
  usage: usageSchema,
  attempts: z.number(),
  problems: z.array(z.string()),
  promptVersion: z.string(),
});
const cacheFileSchema = z.record(z.string(), outcomeSchema);

const safe = (text: string): string => text.replace(/[^a-zA-Z0-9._-]/g, "_");
const cacheFile = (promptVersion: string, model: string): URL =>
  new URL(`outcomes-${safe(promptVersion)}-${safe(model)}.json`, CACHE_DIR);
const usageFile = new URL("usage.json", CACHE_DIR);

/** Outcomes keyed by content_hash for one (prompt version, model): the cache key of docs/02 section 5. */
export function loadOutcomeCache(
  promptVersion: string,
  model: string,
): Map<string, ClassifyOutcome> {
  try {
    const parsed = cacheFileSchema.parse(
      JSON.parse(readFileSync(cacheFile(promptVersion, model), "utf8")) as unknown,
    );
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveOutcomeCache(
  promptVersion: string,
  model: string,
  cache: ReadonlyMap<string, ClassifyOutcome>,
): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    cacheFile(promptVersion, model),
    `${JSON.stringify(Object.fromEntries(cache), null, 1)}\n`,
  );
}

const usageFileSchema = z.record(z.string(), z.object({ day: z.string(), count: z.number() }));

function readUsage(): z.infer<typeof usageFileSchema> {
  try {
    return usageFileSchema.parse(JSON.parse(readFileSync(usageFile, "utf8")) as unknown);
  } catch {
    return {};
  }
}

/** Requests already made today per model (provider quota day), so the daily count survives between runs. */
export function loadDailyUsage(model: string): { day: string; count: number } | null {
  return readUsage()[model] ?? null;
}

export function saveDailyUsage(model: string, day: string, count: number): void {
  const all = readUsage();
  all[model] = { day, count };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(usageFile, `${JSON.stringify(all, null, 1)}\n`);
}
