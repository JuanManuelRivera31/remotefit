// One-off builder for test-v2 (ADR 0004, section 6). Reads the pool of postings from the database (select only),
// applies the pure selection of packages/core/evals/select.ts and, with --write, appends the chosen cases (ids and
// provenance only, NO posting text: ADR 0002) to packages/core/evals/eligibility/cases.json.
// Usage: DATABASE_URL=... npx tsx scripts/build-test-v2.ts [--write]
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { selectTestSet, type PoolJob } from "../packages/core/evals/select.js";

const CASES = "packages/core/evals/eligibility/cases.json";
const SEED = 11;
const MAX_PER_COMPANY = 25;
const MAX_PER_GROUP = 3;
const TARGET_NEGATIVES = 55;
const TODAY = "2026-11-03";
const write = process.argv.includes("--write");

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is not set");

interface Row {
  company: string;
  board: string;
  source: string;
  external_id: string;
  title: string;
  location_raw: string | null;
  workplace_type: string | null;
  sibling_group: string | null;
  url: string;
}

// Same sibling key the first eval builder used, to catch variants of already-used vacancies by title.
const siblingKey = (board: string, title: string): string =>
  `${board}|${title
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[-–|,]\s*[a-zá-ú ]{0,25}$/i, "")
    .replace(/\s+/g, " ")
    .trim()}`;

const raw = readFileSync(CASES, "utf8");
const data = JSON.parse(raw) as {
  cases: { id: string; siblingKey?: string }[];
  testSet: Record<string, unknown>;
  excludedFromEval?: { id: string; siblingGroup: string | null; reason: string }[];
};
if (data.cases.some((item) => (item as { split?: string }).split === "test")) {
  throw new Error("cases.json already has test cases: test-v2 was already built; refusing to rebuild.");
}
const used = new Set(data.cases.map((item) => item.id));
const usedKeys = new Set(data.cases.map((item) => item.siblingKey).filter((k): k is string => Boolean(k)));

const client = new pg.Client({ connectionString: url });
await client.connect();
const result = await client.query<Row>(
  `select co.name as company, co.board_token as board, j.source, j.external_id, j.title, j.location_raw,
          j.workplace_type, j.sibling_group, j.url
     from jobs j join companies co on co.id = j.company_id
    where j.is_active and j.prefilter_outcome = 'pass'`,
);
const all = await client.query<{ source: string; board: string; external_id: string; sibling_group: string | null }>(
  `select j.source, co.board_token as board, j.external_id, j.sibling_group
     from jobs j join companies co on co.id = j.company_id where j.is_active`,
);
await client.end();

const idOf = (r: { source: string; board: string; external_id: string }): string =>
  `${r.source}:${r.board}:${r.external_id}`;
const excludeGroups = new Set(
  all.rows.filter((r) => used.has(idOf(r)) && r.sibling_group).map((r) => r.sibling_group as string),
);

const pool: PoolJob[] = result.rows
  .filter((r) => !usedKeys.has(siblingKey(r.board, r.title)))
  .map((r) => ({
    id: idOf(r),
    company: r.company,
    title: r.title,
    locationRaw: r.location_raw ?? "",
    workplaceType: r.workplace_type,
    siblingGroup: r.sibling_group,
    titleKey: siblingKey(r.board, r.title),
  }));

const { selected, leftOut } = selectTestSet(pool, {
  seed: SEED,
  maxPerCompany: MAX_PER_COMPANY,
  maxPerGroup: MAX_PER_GROUP,
  targetNegatives: TARGET_NEGATIVES,
  excludeIds: used,
  excludeGroups,
});

const byCompany = new Map<string, Record<string, number>>();
for (const item of selected) {
  const row = byCompany.get(item.company) ?? {};
  row[item.stratum] = (row[item.stratum] ?? 0) + 1;
  row["total"] = (row["total"] ?? 0) + 1;
  byCompany.set(item.company, row);
}
console.log(`pool ${pool.length} | selected ${selected.length} | left out (siblings) ${leftOut.length} | excluded groups ${excludeGroups.size}`);
for (const [company, row] of [...byCompany.entries()].sort((a, b) => (b[1]["total"] ?? 0) - (a[1]["total"] ?? 0))) {
  console.log(`  ${company.padEnd(12)} ${JSON.stringify(row)}`);
}
const strata = new Map<string, number>();
for (const item of selected) strata.set(item.stratum, (strata.get(item.stratum) ?? 0) + 1);
console.log("strata:", JSON.stringify(Object.fromEntries(strata)));

if (!write) {
  console.log("dry run: nothing written (use --write)");
  process.exit(0);
}

const meta = new Map(result.rows.map((r) => [idOf(r), r]));
for (const item of selected) {
  const row = meta.get(item.id);
  if (!row) throw new Error("lost row " + item.id);
  data.cases.push({
    id: item.id,
    ats: row.source,
    board: row.board,
    externalId: row.external_id,
    url: row.url,
    split: "test",
    group: item.stratum === "candidate" ? "candidate" : "hard_negative",
    subtype: item.stratum,
    siblingKey: siblingKey(row.board, row.title),
    selectionReason: `test-v2 selection (seed ${SEED}, ${item.stratum})`,
    labelStatus: "pending",
    testSetName: "test-v2",
    addedAt: TODAY,
  } as unknown as { id: string });
}
data.excludedFromEval = [
  ...(data.excludedFromEval ?? []),
  ...leftOut.map((job) => ({ id: job.id, siblingGroup: job.siblingGroup, reason: "test-v2 sibling cap: left out of the eval" })),
];
data.testSet = {
  ...data.testSet,
  seed: SEED,
  maxPerCompany: MAX_PER_COMPANY,
  maxPerGroup: MAX_PER_GROUP,
  builtAt: TODAY,
  selected: selected.length,
  leftOut: leftOut.length,
};
writeFileSync(CASES, JSON.stringify(data, null, 2).replace(/\n/g, "\r\n") + "\r\n");
console.log("written", selected.length, "cases and", leftOut.length, "left-out ids");
