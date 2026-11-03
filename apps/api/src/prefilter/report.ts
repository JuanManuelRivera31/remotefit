import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  PREFILTER_RULES,
  PREFILTER_RULE_KINDS,
  PREFILTER_VERSION,
  connectors,
  evaluatePrefilterRules,
  type AtsName,
  type NormalizedJob,
  type PrefilterInput,
  type PrefilterRule,
  type WorkplaceType,
} from "@remotefit/core";
import type { Db } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";

const CASES_URL = new URL(
  "../../../../packages/core/evals/eligibility/cases.json",
  import.meta.url,
);
const BODIES_URL = new URL("../../../../data/seed-career-ops/bodies/", import.meta.url);

const caseSchema = z.looseObject({
  id: z.string(),
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  board: z.string(),
  externalId: z.string(),
  split: z.string(),
  label: z.string(),
  workModel: z.string(),
  countries: z.array(z.string()).default([]),
  excludedCountries: z.array(z.string()).default([]),
});
const casesFileSchema = z.looseObject({ cases: z.array(caseSchema) });
export type EvalCase = z.infer<typeof caseSchema>;

const LATAM_ISO2 = new Set(
  "AR BO BR BZ CL CO CR CU DO EC GT GY HN HT MX NI PA PE PY SR SV UY VE".split(" "),
);

/** ADR 0004 section 4 for Colombia. Temporary copy: S6 brings the real `isApplicable` into core. */
export function isApplicableForColombia(item: EvalCase): boolean {
  if (item.workModel !== "remote") return false;
  if (item.excludedCountries.includes("CO")) return false;
  switch (item.label) {
    case "latam_eligible":
      return LATAM_ISO2.has("CO");
    case "worldwide":
      return true;
    case "country_specific":
      return item.countries.includes("CO");
    default:
      return false;
  }
}

function toInput(job: {
  title: string;
  locationRaw: string | null;
  workplaceType: string | null;
  descriptionText: string | null;
}): PrefilterInput {
  const wt = job.workplaceType;
  const workplaceType: WorkplaceType | null =
    wt === "remote" || wt === "hybrid" || wt === "onsite" ? wt : null;
  return {
    title: job.title,
    locationRaw: job.locationRaw ?? "",
    workplaceType,
    descriptionText: job.descriptionText,
  };
}

export interface RuleCount {
  /** Postings where the rule fires (a posting can trigger several). */
  fires: number;
  /** Postings discarded by this rule counting only those no earlier rule already discarded (stored `prefilter_rule`). */
  firstHit: number;
  /** Fires if the body guard were off (shows how many postings the guard sends to the classifier instead). */
  firesWithoutBodyGuard: number;
}

export interface DevDiscard {
  id: string;
  applicable: boolean;
  rules: PrefilterRule[];
  matchedText: string;
  source: "db" | "bodies";
}

export interface ReportData {
  version: string;
  total: number;
  discarded: number;
  byRule: Record<PrefilterRule, RuleCount>;
  byCompany: { company: string; total: number; discarded: number }[];
  dev: {
    cases: number;
    resolved: number;
    fromBodies: number;
    unresolved: string[];
    applicable: number;
    /** Applicable cases discarded by at least one eligibility rule. Goal: 0. */
    eligibilityLost: DevDiscard[];
    /** Applicable cases discarded only by scope rules (not development roles): expected, not a loss. */
    outOfScopeExpected: DevDiscard[];
    nonApplicableDiscarded: number;
  };
}

function loadDevCases(): EvalCase[] {
  const parsed = casesFileSchema.parse(JSON.parse(readFileSync(CASES_URL, "utf8")) as unknown);
  // Frozen test split: never read beyond this filter.
  return parsed.cases.filter((item) => item.split === "dev");
}

function jobFromBodies(item: EvalCase): NormalizedJob | null {
  const file = new URL(`${item.ats}/${item.board}/${item.externalId}.json`, BODIES_URL);
  if (!existsSync(file)) return null;
  try {
    const stored = z
      .looseObject({ raw: z.unknown() })
      .parse(JSON.parse(readFileSync(file, "utf8")));
    return connectors[item.ats as AtsName].toNormalizedJob(stored.raw, {
      name: item.board,
      boardToken: item.board,
    });
  } catch {
    return null;
  }
}

export async function collectReport(db: Db): Promise<ReportData> {
  const rows = await db
    .select({
      company: companies.name,
      source: jobs.source,
      board: companies.boardToken,
      externalId: jobs.externalId,
      title: jobs.title,
      locationRaw: jobs.locationRaw,
      workplaceType: jobs.workplaceType,
      descriptionText: jobs.descriptionText,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.isActive, true));

  const byRule = Object.fromEntries(
    PREFILTER_RULES.map((rule) => [rule, { fires: 0, firstHit: 0, firesWithoutBodyGuard: 0 }]),
  ) as Record<PrefilterRule, RuleCount>;
  const companyMap = new Map<string, { total: number; discarded: number }>();
  const hitsByKey = new Map<string, { rules: PrefilterRule[]; matchedText: string }>();
  let discarded = 0;

  for (const row of rows) {
    const hits = evaluatePrefilterRules(toInput(row));
    const stats = companyMap.get(row.company) ?? { total: 0, discarded: 0 };
    stats.total += 1;
    for (const hit of hits) byRule[hit.rule].fires += 1;
    for (const hit of evaluatePrefilterRules({ ...toInput(row), descriptionText: null })) {
      byRule[hit.rule].firesWithoutBodyGuard += 1;
    }
    const first = hits[0];
    if (first) {
      byRule[first.rule].firstHit += 1;
      discarded += 1;
      stats.discarded += 1;
    }
    companyMap.set(row.company, stats);
    hitsByKey.set(`${row.source}:${row.board}:${row.externalId}`, {
      rules: hits.map((hit) => hit.rule),
      matchedText: first?.matchedText ?? "",
    });
  }

  const devCases = loadDevCases();
  const dev: ReportData["dev"] = {
    cases: devCases.length,
    resolved: 0,
    fromBodies: 0,
    unresolved: [],
    applicable: devCases.filter(isApplicableForColombia).length,
    eligibilityLost: [],
    outOfScopeExpected: [],
    nonApplicableDiscarded: 0,
  };
  for (const item of devCases) {
    const stored = hitsByKey.get(item.id);
    let found: { rules: PrefilterRule[]; matchedText: string };
    let source: "db" | "bodies";
    if (stored) {
      found = stored;
      source = "db";
    } else {
      const job = jobFromBodies(item);
      if (!job) {
        dev.unresolved.push(item.id);
        continue;
      }
      source = "bodies";
      dev.fromBodies += 1;
      const hits = evaluatePrefilterRules({
        title: job.title,
        locationRaw: job.locationRaw,
        workplaceType: job.workplaceType,
        descriptionText: job.descriptionText,
      });
      found = { rules: hits.map((hit) => hit.rule), matchedText: hits[0]?.matchedText ?? "" };
    }
    const { rules, matchedText } = found;
    dev.resolved += 1;
    if (rules.length === 0) continue;
    if (!isApplicableForColombia(item)) {
      dev.nonApplicableDiscarded += 1;
      continue;
    }
    const entry = { id: item.id, applicable: true, rules, matchedText, source };
    if (rules.some((rule) => PREFILTER_RULE_KINDS[rule] === "eligibility")) {
      dev.eligibilityLost.push(entry);
    } else {
      dev.outOfScopeExpected.push(entry);
    }
  }

  return {
    version: PREFILTER_VERSION,
    total: rows.length,
    discarded,
    byRule,
    byCompany: [...companyMap.entries()]
      .map(([company, value]) => ({ company, ...value }))
      .sort((a, b) => b.total - a.total),
    dev,
  };
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`;

export function formatReport(data: ReportData): string {
  const lines: string[] = [];
  lines.push(`Prefilter ${data.version}`);
  lines.push(
    `Total: ${data.total} active jobs · discarded ${data.discarded} (${pct(data.discarded, data.total)}) · pass to classifier ${data.total - data.discarded}`,
  );
  lines.push(
    "",
    "Savings per rule (fires = rule matches; first hit = discarded counting rules in order):",
  );
  for (const rule of PREFILTER_RULES) {
    const count = data.byRule[rule];
    lines.push(
      `  ${rule.padEnd(26)} ${PREFILTER_RULE_KINDS[rule].padEnd(11)} fires ${String(count.fires).padStart(4)} (${pct(count.fires, data.total)}, ${count.firesWithoutBodyGuard} without body guard) · first hit ${String(count.firstHit).padStart(4)} (${pct(count.firstHit, data.total)})`,
    );
  }
  const byKind = { eligibility: 0, scope: 0 };
  for (const rule of PREFILTER_RULES)
    byKind[PREFILTER_RULE_KINDS[rule]] += data.byRule[rule].firstHit;
  lines.push(
    `  by kind (first hit): eligibility ${byKind.eligibility} (${pct(byKind.eligibility, data.total)}) · scope ${byKind.scope} (${pct(byKind.scope, data.total)})`,
    `  ${"TOTAL".padEnd(26)} discarded ${data.discarded} (${pct(data.discarded, data.total)})`,
  );
  lines.push("", "Per company (discarded / total · pass to classifier):");
  for (const row of data.byCompany) {
    lines.push(
      `  ${row.company.padEnd(14)} ${String(row.discarded).padStart(3)} / ${String(row.total).padStart(3)} (${pct(row.discarded, row.total)}) · pass ${row.total - row.discarded}`,
    );
  }
  const dev = data.dev;
  lines.push("", "Development split check (the frozen test split is never read):");
  lines.push(
    `  dev cases ${dev.cases} · resolved ${dev.resolved} (${dev.fromBodies} from rescued bodies) · unresolved ${dev.unresolved.length}${dev.unresolved.length > 0 ? ` [${dev.unresolved.join(", ")}]` : ""}`,
  );
  lines.push(
    `  applicable for CO in dev: ${dev.applicable} · eligibility rules discarded: ${dev.eligibilityLost.length} (goal 0) · out of scope (expected): ${dev.outOfScopeExpected.length} · non-applicable discarded: ${dev.nonApplicableDiscarded}`,
  );
  for (const item of dev.eligibilityLost) {
    lines.push(
      `    LOST ${item.id} [${item.rules.join(", ")}] "${item.matchedText}" (${item.source})`,
    );
  }
  for (const item of dev.outOfScopeExpected) {
    lines.push(
      `    OUT OF SCOPE (expected) ${item.id} [${item.rules.join(", ")}] "${item.matchedText}" (${item.source})`,
    );
  }
  return lines.join("\n");
}
