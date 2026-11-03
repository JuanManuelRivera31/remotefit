// Freezes the posting text of eval cases that were never rescued from the old seed: copies the raw ATS payload stored in the
// database (jobs.raw) to data/seed-career-ops/bodies/<ats>/<board>/<externalId>.json (outside git, ADR 0002), the same format
// the eval loader reads. From then on the case is judged against THIS text even if the ATS edits the posting.
// Usage: DATABASE_URL=... npx tsx scripts/export-case-bodies.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is not set");
const cases = (JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as {
  cases: { id: string; ats: string; board: string; externalId: string; url?: string }[];
}).cases;

const client = new pg.Client({ connectionString: url });
await client.connect();
let written = 0;
const missing: string[] = [];
for (const item of cases) {
  const file = `data/seed-career-ops/bodies/${item.ats}/${item.board}/${item.externalId}.json`;
  if (existsSync(file)) continue;
  const result = await client.query<{ raw: unknown; url: string }>(
    `select j.raw, j.url from jobs j join companies co on co.id = j.company_id
      where j.source = $1 and co.board_token = $2 and j.external_id = $3`,
    [item.ats, item.board, item.externalId],
  );
  const row = result.rows[0];
  if (!row?.raw) {
    missing.push(item.id);
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      { url: row.url, ats: item.ats, board: item.board, externalId: item.externalId, fetchedAt: new Date().toISOString(), raw: row.raw },
      null,
      2,
    ),
  );
  written += 1;
}
await client.end();
console.log(`exported ${written} posting texts; missing in the database: ${missing.length}${missing.length ? " -> " + missing.join(", ") : ""}`);
