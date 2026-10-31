// One-off builder for the first 150 eligibility evaluation cases (S7, ADR 0004).
// Reads the rescued postings in data/seed-career-ops/bodies/ (outside git) and writes:
//   - packages/core/evals/eligibility/cases.json  -> ids, split and provenance only, NO posting text (ADR 0002)
//   - data/seed-career-ops/eval-labeling-sheet.tsv -> titles, locations and excerpts for hand labeling (ignored by git)
// Selection is deterministic (seeded). Labels stay pending: only the project owner confirms them.
// Usage: node scripts/build-eval-set.mjs
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BODIES = "data/seed-career-ops/bodies";
const CASES_OUT = "packages/core/evals/eligibility/cases.json";
const SHEET_OUT = "data/seed-career-ops/eval-labeling-sheet.tsv";
const SEED = 7;
const MAX_PER_COMPANY = 10;
const TARGET = { candidates: 80, hardNegatives: 50, discards: 20 };
const HARD_NEGATIVE_QUOTAS = { us_only: 12, country_specific: 12, worldwide_doubtful: 8, hybrid: 8, false_match: 10 };

// ---------- text helpers ----------
const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const strip = (s) => decode(String(s ?? "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const STRONG = /colombia|bogot[aá]|medell[ií]n|latam|latin america|am[eé]rica latina|south america|sudam[eé]rica/i;
const WEAK = /\bamericas\b|worldwide|anywhere|remote[- ]global|global[- ]remote/i;
const US_ONLY =
  /\bUS[- ]only\b|\bU\.S\.[- ]only\b|US[- ]based|U\.S\.[- ]based|(authorized|eligible|legally authorized) to work in the (US|U\.S\.|United States)|must (reside|live|be located|be based) in the (US|U\.S\.|United States)|United States only|(US|U\.S\.) (residents|citizens) only/i;
const ONSITE = /hybrid|h[ií]brido|on-?site|presencial/i;
const RESTRICTION =
  /must (be|reside|live|be located|be based)|eligible to work in|time ?zone|\bEMEA\b|europe|\bCET\b|\bEST\b|\bPST\b|north america|canada/i;
const COUNTRIES = {
  colombia: "CO", mexico: "MX", "méxico": "MX", brazil: "BR", brasil: "BR", argentina: "AR", chile: "CL",
  peru: "PE", "perú": "PE", uruguay: "UY", ecuador: "EC", venezuela: "VE", "costa rica": "CR", panama: "PA",
  "panamá": "PA", "dominican republic": "DO", guatemala: "GT", "el salvador": "SV", bolivia: "BO", paraguay: "PY",
};

function fields(ats, r) {
  if (ats === "greenhouse") {
    return { loc: [r.location?.name, ...(r.offices ?? []).map((o) => o.name)].filter(Boolean).join(" | "), body: strip(r.content), title: r.title ?? "" };
  }
  if (ats === "lever") {
    return {
      loc: [r.categories?.location, ...(r.categories?.allLocations ?? []), r.country].filter(Boolean).join(" | "),
      body: [r.descriptionPlain, r.additionalPlain, ...(r.lists ?? []).map((l) => strip(l.content))].join(" "),
      title: r.text ?? "",
    };
  }
  return {
    loc: [r.location, ...(r.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join(" | "),
    body: r.descriptionPlain ?? strip(r.descriptionHtml),
    title: r.title ?? "",
  };
}

// Same vacancy posted once per country: "(LATAM)" / "(Colombia)" / "- Mexico" suffixes are removed.
const siblingKey = (board, title) =>
  `${board}|${title.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[-–|,]\s*[a-zá-ú ]{0,25}$/i, "").replace(/\s+/g, " ").trim()}`;

// ---------- deterministic randomness ----------
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
// Round-robin over groups so no single company dominates; `cap` limits items per group.
function roundRobin(items, groupOf, n, cap = Infinity) {
  const groups = new Map();
  for (const item of shuffle(items)) groups.set(groupOf(item), [...(groups.get(groupOf(item)) ?? []), item]);
  const queues = [...groups.entries()].map(([group, queue]) => queue.slice(0, typeof cap === "function" ? cap(group) : cap));
  const picked = [];
  while (picked.length < n && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (picked.length >= n) break;
      const next = queue.shift();
      if (next) picked.push(next);
    }
  }
  return picked;
}

// ---------- load ----------
const statusByUrl = new Map();
{
  const text = await readFile("data/seed-career-ops/scan-history.tsv", "utf8");
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split("\t");
  for (const line of lines) {
    const cells = line.split("\t");
    statusByUrl.set(cells[cols.indexOf("url")], cells[cols.indexOf("status")]);
  }
}

const all = [];
for (const ats of await readdir(BODIES)) {
  if (ats.endsWith(".tsv")) continue;
  for (const board of await readdir(path.join(BODIES, ats))) {
    for (const file of await readdir(path.join(BODIES, ats, board))) {
      const record = JSON.parse(await readFile(path.join(BODIES, ats, board, file), "utf8"));
      const f = fields(ats, record.raw);
      const locStrong = f.loc.match(STRONG)?.[0];
      const bodyStrong = f.body.match(STRONG)?.[0];
      const locWeak = f.loc.match(WEAK)?.[0];
      const bodyWeak = f.body.match(WEAK)?.[0];
      const hit = locStrong ?? bodyStrong ?? locWeak ?? bodyWeak ?? "";
      const at = hit ? f.body.toLowerCase().indexOf(hit.toLowerCase()) : -1;
      all.push({
        id: `${ats}:${board}:${record.externalId}`,
        ats, board, externalId: record.externalId, url: record.url,
        title: f.title, loc: f.loc,
        tier: locStrong ? "A" : bodyStrong ? "B" : locWeak || bodyWeak ? "C" : "none",
        locWeak: Boolean(locWeak),
        usFlag: Boolean(f.body.match(US_ONLY) ?? f.title.match(US_ONLY)),
        onsite: ONSITE.test(`${f.title} ${f.loc}`),
        restriction: RESTRICTION.test(f.body),
        careerOpsStatus: statusByUrl.get(record.url) ?? "",
        hit,
        excerpt: at >= 0 ? f.body.slice(Math.max(0, at - 80), at + 100) : "",
        key: siblingKey(board, f.title),
      });
    }
  }
}
const distinctByKey = (items) => {
  const seen = new Set();
  return items.filter((item) => (seen.has(item.key) ? false : seen.add(item.key)));
};
const used = new Set();
const take = (items) => items.filter((item) => !used.has(item.id));
const mark = (items) => items.forEach((item) => used.add(item.id));

// ---------- 1) candidates (80) ----------
const FORCED_TITLES = [
  // docs/07 section 3 and ADR 0004 reference cases that are available outside Get on Board.
  { board: "sezzle", re: /software engineer ii.*\(latam\)/i },
  { board: "sezzle", re: /software engineer ii.*\(colombia\)/i },
  { board: "sezzle", re: /ai intern/i },
  { board: "elevenlabs", re: /full-?stack/i },
  { board: "amplemarket", re: /front-?end/i },
  { board: "addi", re: /front-?end/i },
];
const forced = [];
for (const rule of FORCED_TITLES) {
  const match = all.find((o) => o.board === rule.board && rule.re.test(o.title) && !forced.includes(o));
  if (match) forced.push(match);
}
mark(forced);

const strict = take(all).filter((o) => o.tier === "A" && !o.usFlag && !o.onsite);
const worldwide = take(all).filter((o) => o.tier === "C" && !o.usFlag && o.locWeak && /worldwide|americas/i.test(o.loc) && !o.restriction);
const worldwidePicked = roundRobin(distinctByKey(worldwide), (o) => o.board, 5, 5);
mark(worldwidePicked);
const strictPicked = roundRobin(
  distinctByKey(strict),
  (o) => o.board,
  TARGET.candidates - forced.length - worldwidePicked.length,
  (board) => MAX_PER_COMPANY - forced.filter((o) => o.board === board).length,
);
mark(strictPicked);

const candidateGroup = [...forced, ...worldwidePicked, ...strictPicked].map((o) => ({ ...o, group: "candidate", subtype: o.tier === "A" ? "strict_location" : "worldwide_location" }));

// ---------- 2) hard negatives (50) ----------
const pools = {
  us_only: take(all).filter((o) => o.usFlag && (o.tier !== "none" || /remote/i.test(o.loc))),
  country_specific: take(all).filter(
    (o) => !o.usFlag && !o.onsite && /mexico|méxico|brazil|brasil|argentina|chile|peru|perú|uruguay|ecuador|venezuela/i.test(o.loc) && !/colombia/i.test(o.loc) && o.tier !== "none",
  ),
  worldwide_doubtful: take(all).filter((o) => o.tier === "C" && !o.usFlag && o.restriction),
  hybrid: take(all).filter((o) => o.tier === "A" && o.onsite),
  false_match: take(all).filter((o) => o.tier === "B" && !o.usFlag && !o.onsite),
};
const hardNegatives = [];
for (const [subtype, quota] of Object.entries(HARD_NEGATIVE_QUOTAS)) {
  const picked = roundRobin(distinctByKey(take(pools[subtype])), (o) => o.board, quota, MAX_PER_COMPANY);
  mark(picked);
  hardNegatives.push(...picked.map((o) => ({ ...o, group: "hard_negative", subtype })));
}
// Backfill if a pool ran short, from the pools with leftovers, in quota order.
for (const subtype of Object.keys(HARD_NEGATIVE_QUOTAS)) {
  if (hardNegatives.length >= TARGET.hardNegatives) break;
  const extra = roundRobin(distinctByKey(take(pools[subtype])), (o) => o.board, TARGET.hardNegatives - hardNegatives.length, MAX_PER_COMPANY);
  mark(extra);
  hardNegatives.push(...extra.map((o) => ({ ...o, group: "hard_negative", subtype })));
}

// ---------- 3) career-ops discards (20) ----------
const discardPool = take(all).filter((o) => o.careerOpsStatus === "skipped_location");
const discards = roundRobin(distinctByKey(discardPool), (o) => o.board, TARGET.discards, 3);
mark(discards);
const discardGroup = discards.map((o) => ({ ...o, group: "career_ops_discard", subtype: "skipped_location" }));

// ---------- splits: 50 dev / 100 test, spread across companies and subtypes ----------
const interleave = (items, keyOf) => {
  const buckets = new Map();
  for (const item of items) buckets.set(keyOf(item), [...(buckets.get(keyOf(item)) ?? []), item]);
  const queues = [...buckets.values()];
  const out = [];
  while (queues.some((q) => q.length)) for (const q of queues) { const next = q.shift(); if (next) out.push(next); }
  return out;
};
const candidatesOrdered = interleave(candidateGroup, (o) => o.board);
const negativesOrdered = interleave(hardNegatives, (o) => o.subtype);
const discardsOrdered = interleave(discardGroup, (o) => o.board);
const assign = (items, devCount) => items.map((o, i) => ({ ...o, split: i % 3 === 0 && i / 3 < devCount ? "dev" : "test" }));
let cases = [...assign(candidatesOrdered, 27), ...assign(negativesOrdered, 17), ...assign(discardsOrdered, 6)];

// Sibling vacancies must stay in the same split to avoid leaking between dev and test.
const bySibling = new Map();
for (const c of cases) bySibling.set(c.key, [...(bySibling.get(c.key) ?? []), c]);
for (const siblings of bySibling.values()) {
  if (siblings.length < 2 || siblings.every((s) => s.split === siblings[0].split)) continue;
  for (const s of siblings) {
    if (s.split === "dev") continue;
    s.split = "dev";
    const swap = cases.find((c) => c.split === "dev" && c.group === s.group && !bySibling.get(c.key)?.some((x) => x !== c) && c !== s);
    if (swap) swap.split = "test";
  }
}

// ---------- proposed labels (heuristic suggestions only; the owner decides) ----------
function proposeLabel(o) {
  const loc = o.loc.toLowerCase();
  const countries = [...new Set(Object.entries(COUNTRIES).filter(([name]) => loc.includes(name)).map(([, code]) => code))];
  if (o.usFlag) return { label: "us_only", countries: [], workModel: "remote" };
  if (o.onsite) return { label: "onsite_or_hybrid", countries, workModel: /hybrid|h[ií]brido/i.test(`${o.title} ${o.loc}`) ? "hybrid" : "onsite" };
  if (/latam|latin america|am[eé]rica latina|south america/i.test(o.loc)) return { label: "latam_eligible", countries: [], workModel: "unknown" };
  if (/worldwide|anywhere/i.test(o.loc)) return { label: o.restriction ? "unclear" : "worldwide", countries: [], workModel: "unknown" };
  if (countries.length > 0) return { label: "country_specific", countries, workModel: "unknown" };
  return { label: "unclear", countries: [], workModel: "unknown" };
}

cases = cases.map((c) => ({ ...c, proposal: proposeLabel(c) }));
cases.sort((a, b) => (a.split === b.split ? a.id.localeCompare(b.id) : a.split === "dev" ? -1 : 1));

// ---------- write ----------
const counts = (key) => cases.reduce((acc, c) => ({ ...acc, [key(c)]: (acc[key(c)] ?? 0) + 1 }), {});
const output = {
  version: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  seed: SEED,
  note: "Ids and provenance only; posting text lives in data/seed-career-ops/bodies/ (ignored by git, ADR 0002). Every label is pending until the project owner confirms it (ADR 0004). proposedLabel is a heuristic suggestion, not a decision.",
  composition: { total: cases.length, bySplit: counts((c) => c.split), byGroup: counts((c) => c.group), bySubtype: counts((c) => `${c.group}/${c.subtype}`), byBoard: counts((c) => c.board) },
  cases: cases.map((c) => ({
    id: c.id, ats: c.ats, board: c.board, externalId: c.externalId, url: c.url,
    split: c.split, group: c.group, subtype: c.subtype, siblingKey: c.key,
    selectionReason: c.hit ? `matched "${c.hit}"` : c.careerOpsStatus,
    proposedLabel: c.proposal.label, proposedCountries: c.proposal.countries, proposedWorkModel: c.proposal.workModel,
    label: null, labelStatus: "pending",
  })),
};
await mkdir(path.dirname(CASES_OUT), { recursive: true });
await writeFile(CASES_OUT, `${JSON.stringify(output, null, 2)}\n`);

const sheetHeader = ["id", "split", "group", "subtype", "company", "title", "location", "matched", "excerpt", "proposed_label", "proposed_countries", "proposed_workModel", "your_label"];
const sheetLines = cases.map((c) =>
  [c.id, c.split, c.group, c.subtype, c.board, c.title, c.loc, c.hit, c.excerpt, c.proposal.label, c.proposal.countries.join(","), c.proposal.workModel, ""]
    .map((v) => String(v).replace(/[\t\r\n]+/g, " "))
    .join("\t"),
);
await writeFile(SHEET_OUT, `${[sheetHeader.join("\t"), ...sheetLines].join("\n")}\n`);

console.log(JSON.stringify(output.composition, null, 2));
console.log("forced cases found:", forced.map((o) => `${o.board}: ${o.title}`));
console.log("proposed labels:", counts((c) => c.proposal.label));
