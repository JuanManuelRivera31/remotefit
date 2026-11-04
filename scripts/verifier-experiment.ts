// Verifier experiment (ADR 0004): a stronger, rate-limited model gives a second opinion ONLY on positives. If it does not
// confirm, the posting would become unclear. Measured on development cases: false positives of the first classifier and an
// equal-sized sample of true positives, within the model's daily quota (16 calls/day after the safety margin).
// Usage: npx tsx scripts/verifier-experiment.ts --model gemini-3.8-flash [--fp 8] [--tp 8]
// Results are cached (data/eval-verifier-<model>.json, outside git) so a second day resumes where the quota stopped.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  GeminiProvider,
  MeteredProvider,
  ProviderError,
  QuotaExhaustedError,
  RateLimiter,
  buildUserMessage,
  effectiveLimits,
  finalizeOutcome,
  parseLimits,
  verifyPositive,
  type RawOutcome,
} from "../packages/core/src/index.js";
import { loadRawCache } from "../packages/core/evals/cache.js";
import { DEFAULT_QUOTA_LEDGER_URL, FileQuotaLedger } from "../packages/core/src/llm/quota-ledger.js";
import { loadCases, loadJob } from "../packages/core/evals/loader.js";
import { applicableFor } from "../packages/core/evals/metrics.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const model = arg("--model", "gemini-3.8-flash");
const nFp = Number(arg("--fp", "8"));
const nTp = Number(arg("--tp", "8"));
const CLASSIFIER_MODEL = "gemini-3.5-flash-lite";
const PROMPT_VERSION = "eligibility-v4";
const OUT = `data/eval-verifier-${model}.json`;

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: use the real environment
}
const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["RF_LLM_API_KEY"];

// --- Select the sample (deterministic) ----------------------------------------------------------------------------
const cache = loadRawCache(PROMPT_VERSION, CLASSIFIER_MODEL);
interface Row {
  id: string;
  board: string;
  kind: "FP-pipeline" | "FP-raw" | "TP";
  first: ReturnType<typeof finalizeOutcome>["result"];
  prompt: { title: string; locationRaw: string; workplaceType: ReturnType<typeof loadJob>["workplaceType"]; descriptionText: string };
  hash: string;
}
const rows: Row[] = [];
for (const item of loadCases("dev")) {
  const job = loadJob(item);
  const cached = cache.get(job.contentHash);
  if (!cached) continue;
  const prompt = { title: job.title, locationRaw: job.locationRaw, workplaceType: job.workplaceType, descriptionText: job.descriptionText };
  const final = finalizeOutcome({ ...cached, sentText: buildUserMessage(prompt) } as RawOutcome, prompt);
  const expected = { label: item.label, workModel: item.workModel, countries: item.countries, excludedCountries: [] as string[] };
  const exp = applicableFor(expected, "CO");
  const pipelinePos = applicableFor(final.result, "CO");
  const rawPos = cached.raw ? applicableFor({ ...cached.raw, excludedCountries: cached.raw.excludedCountries }, "CO") : false;
  if (!exp && pipelinePos) rows.push({ id: item.id, board: item.board, kind: "FP-pipeline", first: final.result, prompt, hash: job.contentHash });
  else if (!exp && rawPos && cached.raw) {
    // A false positive of the raw model that the code rules already fix: the verifier would see the raw answer.
    rows.push({ id: item.id, board: item.board, kind: "FP-raw", first: { ...final.result, ...cached.raw, evidence: cached.raw.evidence.length > 0 ? cached.raw.evidence : final.result.evidence }, prompt, hash: job.contentHash });
  } else if (exp && pipelinePos) rows.push({ id: item.id, board: item.board, kind: "TP", first: final.result, prompt, hash: job.contentHash });
}
// Seeded shuffle so the same sample is used by every model.
let state = 20261103;
const rand = (): number => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = <T>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};
const fpPipeline = rows.filter((r) => r.kind === "FP-pipeline");
const fpRaw = shuffle(rows.filter((r) => r.kind === "FP-raw"));
const fps = [...fpPipeline, ...fpRaw].slice(0, nFp);
const tps = shuffle(rows.filter((r) => r.kind === "TP")).slice(0, nTp);
const sample = [...fps, ...tps];
console.log(`Sample: ${fps.length} false positives (${fpPipeline.length} remaining in the pipeline + raw-model ones) + ${tps.length} true positives; model ${model}`);

// --- Run within the quota -------------------------------------------------------------------------------------------
const config = parseLimits(JSON.parse(readFileSync("data/llm-limits.json", "utf8")) as unknown);
const limits = effectiveLimits(config, model);
const results: Record<string, { confirmed: boolean; quote: string; quoteUnverified: boolean }> = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, "utf8")) as typeof results)
  : {};
const pending = sample.filter((r) => !(r.hash in results));
console.log(`${sample.length - pending.length} from cache · ${pending.length} to ask · limits ${limits.rpm} RPM / ${limits.rpd} RPD`);
if (pending.length > 0) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Nothing was sent.");
  // Same shared per-model counter as eval and classify (data/llm-quota.json).
  const shared = new FileQuotaLedger(DEFAULT_QUOTA_LEDGER_URL).counterFor(model);
  const limiter = new RateLimiter({ rpm: limits.rpm, rpd: limits.rpd });
  const metered = new MeteredProvider(new GeminiProvider({ apiKey, timeoutMs: 240_000 }), limiter, {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shared,
  });
  for (const row of pending) {
    try {
      let out;
      for (let attempt = 1; ; attempt += 1) {
        try {
          out = await verifyPositive(metered, row.prompt, row.first, { model, thinkingLevel: limits.thinkingLevel });
          break;
        } catch (error) {
          // 503 "high demand" is common on the preview models; each retry still counts against the local quota.
          if (error instanceof ProviderError && error.retryable && attempt < 3) {
            console.log(`  ${error.status ?? "network"}: waiting 45 s (attempt ${attempt})`);
            await new Promise((resolve) => setTimeout(resolve, 45_000));
          } else throw error;
        }
      }
      results[row.hash] = { confirmed: out.confirmed, quote: out.quote, quoteUnverified: out.quoteUnverified };
      writeFileSync(OUT, JSON.stringify(results, null, 1));
      console.log(`${row.kind} ${row.id.slice(0, 40)} -> ${out.confirmed ? "confirmed" : "NOT confirmed"}`);
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        console.log(`Quota reached (${error.message}). Run again after the Pacific-midnight reset: finished cases come from the cache.`);
        break;
      }
      throw error;
    }
  }
}
const done = sample.filter((r) => r.hash in results);
const stat = (kind: (k: Row["kind"]) => boolean) => {
  const list = done.filter((r) => kind(r.kind));
  const confirmed = list.filter((r) => results[r.hash]?.confirmed).length;
  return { n: list.length, confirmed, rejected: list.length - confirmed };
};
console.log("\nRESULT", JSON.stringify({ model, falsePositives: stat((k) => k !== "TP"), truePositives: stat((k) => k === "TP") }));
for (const r of done.filter((x) => x.kind !== "TP" && results[x.hash]?.confirmed)) console.log("  FP still confirmed:", r.id.slice(0, 50), "|", results[r.hash]?.quote);
for (const r of done.filter((x) => x.kind === "TP" && !results[x.hash]?.confirmed)) console.log("  TP lost:", r.id.slice(0, 50));
