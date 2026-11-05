import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { RawEligibilitySchema } from "../src/eligibility/schema.js";
import type { RawOutcome } from "../src/eligibility/classify.js";

// Git-ignored. Holds what the MODEL said about each posting text, so interrupted or repeated runs never repeat a call.
// The deterministic post-processing is NOT cached: it is free, so a changed rule recomputes without spending quota.
const CACHE_DIR = new URL("cache/", import.meta.url);

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  thinkingTokens: z.number(),
  equivalentCostUsd: z.number(),
});
const rawEntrySchema = z.object({
  raw: RawEligibilitySchema.nullable(),
  usage: usageSchema,
  attempts: z.number(),
  problems: z.array(z.string()),
  promptVersion: z.string(),
});
const cacheFileSchema = z.record(z.string(), rawEntrySchema);

/** The posting text is rebuilt from the job on load, so it is not stored. */
export type CachedRaw = Omit<RawOutcome, "sentText">;

const safe = (text: string): string => text.replace(/[^a-zA-Z0-9._-]/g, "_");
const cacheFile = (promptVersion: string, model: string): URL =>
  new URL(`raw-${safe(promptVersion)}-${safe(model)}.json`, CACHE_DIR);

/** Raw model answers keyed by content_hash for one (prompt version, model): the expensive part of the cache key. */
export function loadRawCache(promptVersion: string, model: string): Map<string, CachedRaw> {
  try {
    const parsed = cacheFileSchema.parse(
      JSON.parse(readFileSync(cacheFile(promptVersion, model), "utf8")) as unknown,
    );
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveRawCache(
  promptVersion: string,
  model: string,
  cache: ReadonlyMap<string, CachedRaw>,
): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    cacheFile(promptVersion, model),
    `${JSON.stringify(Object.fromEntries(cache), null, 1)}\n`,
  );
}
