// Error analysis from the cache (no quota): false positives / negatives of the cached prompt versions on the development
// split, grouped by company and by pattern, with a first split into structural (how the ATS builds location and metadata)
// and interpretation (reading the text) causes. Uses the CURRENT post-processing on the cached raw model answers.
// Usage: npx tsx scripts/analyze-errors.ts [promptVersion=eligibility-v4] [model=gemini-3.5-flash-lite]
import { loadRawCache } from "../packages/core/evals/cache.js";
import { loadCases, loadJob } from "../packages/core/evals/loader.js";
import { applicableFor } from "../packages/core/evals/metrics.js";
import { buildUserMessage, finalizeOutcome, type RawOutcome } from "../packages/core/src/index.js";

const promptVersion = process.argv[2] ?? "eligibility-v4";
const model = process.argv[3] ?? "gemini-3.5-flash-lite";
const cache = loadRawCache(promptVersion, model);

interface Finding {
  kind: "FP" | "FN";
  id: string;
  board: string;
  expected: string;
  predicted: string;
  pattern: string;
  family: "structural" | "interpretation";
  detail: string;
}

/** First-pass pattern classification, from the posting fields and what the model answered. */
function classify(kind: "FP" | "FN", job: ReturnType<typeof loadJob>, predictedEvidence: string[], expectedLabel: string, predictedLabel: string): Pick<Finding, "pattern" | "family"> {
  const text = job.descriptionText;
  const evidence = predictedEvidence.join(" ").toLowerCase();
  const segments = job.locationRaw.split("|").map((s) => s.trim());
  if (kind === "FP") {
    if (predictedLabel === "worldwide" && /executed globally|globally|anywhere/i.test(evidence) && /\|/.test(job.locationRaw))
      return { pattern: "worldwide phrase vs ATS country list", family: "structural" };
    if (segments.length > 1 && segments.some((s) => /remote/i.test(s)) && segments.some((s) => !/remote/i.test(s) && /colombia|bogot/i.test(s)))
      return { pattern: "country segment without its own Remote (compound location)", family: "structural" };
    if (segments.length > 1 && expectedLabel === "country_specific")
      return { pattern: "compound location: model adds a country the label does not", family: "structural" };
    if (/hybrid|híbrid/i.test(text) || job.workplaceType === "hybrid" || job.workplaceType === "onsite")
      return { pattern: "hybrid/onsite signal missed (metadata or body)", family: job.workplaceType === "hybrid" || job.workplaceType === "onsite" ? "structural" : "interpretation" };
    if (/distributed across|global team|across the globe/i.test(evidence)) return { pattern: "team distribution read as eligibility", family: "interpretation" };
    if (/[぀-ヿ가-힯]/.test(job.title)) return { pattern: "title in another script", family: "structural" };
    return { pattern: "other text interpretation", family: "interpretation" };
  }
  if (predictedLabel === "onsite_or_hybrid") return { pattern: "model reads hybrid where the label is remote (rule 6)", family: "interpretation" };
  if (predictedLabel === "us_only") return { pattern: "model reads US-only from a location list", family: "structural" };
  return { pattern: "other text interpretation", family: "interpretation" };
}

const findings: Finding[] = [];
let n = 0;
let tp = 0;
let tn = 0;
for (const item of loadCases("dev")) {
  const job = loadJob(item);
  const cached = cache.get(job.contentHash);
  if (!cached) continue;
  n += 1;
  const prompt = { title: job.title, locationRaw: job.locationRaw, workplaceType: job.workplaceType, descriptionText: job.descriptionText };
  const outcome = finalizeOutcome({ ...cached, sentText: buildUserMessage(prompt) } as RawOutcome, prompt);
  const expected = { label: item.label, workModel: item.workModel, countries: item.countries, excludedCountries: [] as string[] };
  const exp = applicableFor(expected, "CO");
  const pred = applicableFor(outcome.result, "CO");
  if (exp && pred) tp += 1;
  else if (!exp && !pred) tn += 1;
  else {
    const kind = pred ? "FP" : "FN";
    const { pattern, family } = classify(kind, job, outcome.result.evidence, item.label, outcome.result.label);
    findings.push({
      kind,
      id: item.id,
      board: item.board,
      expected: `${item.label}/${item.workModel}[${item.countries.join(",")}]`,
      predicted: `${outcome.result.label}/${outcome.result.workModel}[${outcome.result.countries.join(",")}]`,
      pattern,
      family,
      detail: `${job.locationRaw.slice(0, 90)} || ${outcome.result.evidence[0]?.slice(0, 90) ?? ""}`,
    });
  }
}
const fp = findings.filter((f) => f.kind === "FP");
const fn = findings.filter((f) => f.kind === "FN");
console.log(`${promptVersion} / ${model}: ${n} dev cases from cache · TP ${tp} FP ${fp.length} FN ${fn.length} TN ${tn} · precision ${(tp / (tp + fp.length) * 100).toFixed(1)}% recall ${(tp / (tp + fn.length) * 100).toFixed(1)}%`);
const group = (list: Finding[], key: (f: Finding) => string): void => {
  const counts = new Map<string, number>();
  for (const f of list) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
};
for (const [name, list] of [["FALSE POSITIVES", fp], ["FALSE NEGATIVES", fn]] as const) {
  console.log(`\n== ${name} (${list.length}) by company`);
  group(list, (f) => f.board);
  console.log(`== ${name} by family`);
  group(list, (f) => f.family);
  console.log(`== ${name} by pattern`);
  group(list, (f) => `${f.family}: ${f.pattern}`);
}
console.log("\n== DETAIL");
for (const f of findings) console.log(`${f.kind} ${f.id.slice(0, 44)} | ${f.family} | ${f.pattern}\n    exp ${f.expected} -> pred ${f.predicted}\n    ${f.detail}`);
