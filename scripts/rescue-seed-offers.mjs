// One-off rescue of posting text for the career-ops seed. Delete once the S3-S4 connectors replace it.
// Output stays in data/seed-career-ops/bodies/, which is ignored by git.
// Usage: node scripts/rescue-seed-offers.mjs [--dry-run] [--only=<board>] [--source=companies]
// --source=companies downloads every current posting of the active boards in data/companies.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SEED_DIR = "data/seed-career-ops";
const OUTPUT_DIR = path.join(SEED_DIR, "bodies");
const USER_AGENT = "RemoteFit/0.1 (+https://github.com/JuanManuelRivera31/remotefit)";
const PAUSE_MS = 750;
const TIMEOUT_MS = 30_000;
const LEVER_PAGE_SIZE = 100;
const SAFE_SEGMENT = /^[\w-]+$/;

const ATS_BY_PORTAL = {
  "greenhouse-api": "greenhouse",
  "lever-api": "lever",
  "ashby-api": "ashby",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

function parseGreenhouseUrl(url, company) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (url.hostname.endsWith("greenhouse.io")) {
    return { board: segments[0], externalId: segments[2], boardIsGuess: false };
  }
  // Custom career domains may hide the board token; fall back to the company name.
  const declaredBoard = url.searchParams.get("board");
  const board = declaredBoard ?? company.toLowerCase().replace(/[^a-z0-9]/g, "");
  return { board, externalId: url.searchParams.get("gh_jid"), boardIsGuess: !declaredBoard };
}

function parseSeedRow(row) {
  const ats = ATS_BY_PORTAL[row.portal];
  if (!ats) return null;
  const url = new URL(row.url);
  const parsed =
    ats === "greenhouse"
      ? parseGreenhouseUrl(url, row.company)
      : {
          board: url.pathname.split("/").filter(Boolean)[0],
          externalId: url.pathname.split("/").filter(Boolean)[1],
          boardIsGuess: false,
        };
  if (!SAFE_SEGMENT.test(parsed.board ?? "") || !SAFE_SEGMENT.test(parsed.externalId ?? "")) {
    throw new Error(`Cannot parse board and id from ${row.url}`);
  }
  return { url: row.url, ats, ...parsed };
}

async function readSeedOffers() {
  const text = await readFile(path.join(SEED_DIR, "scan-history.tsv"), "utf8");
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = header.split("\t");
  return lines
    .map((line) => {
      const cells = line.split("\t");
      return Object.fromEntries(columns.map((column, i) => [column, (cells[i] ?? "").trim()]));
    })
    .map(parseSeedRow)
    .filter(Boolean);
}

async function fetchJson(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new HttpError(response.status, url);
      return await response.json();
    } catch (error) {
      const canRetry = !(error instanceof HttpError) || error.status >= 500;
      if (attempt >= 2 || !canRetry) throw error;
      await sleep(PAUSE_MS);
    }
  }
}

async function fetchFromHosts(hosts, buildUrl, readBoard) {
  let lastError;
  for (const host of hosts) {
    try {
      return await readBoard(host, buildUrl);
    } catch (error) {
      lastError = error;
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
    }
  }
  throw lastError;
}

function asJobList(payload, url) {
  const jobs = Array.isArray(payload) ? payload : payload?.jobs;
  if (!Array.isArray(jobs)) throw new Error(`Unexpected response shape from ${url}`);
  return jobs;
}

const fetchers = {
  greenhouse: (board) =>
    fetchFromHosts(
      ["boards-api.greenhouse.io", "boards-api.eu.greenhouse.io"],
      (host) => `https://${host}/v1/boards/${board}/jobs?content=true`,
      async (host, buildUrl) => asJobList(await fetchJson(buildUrl(host)), buildUrl(host)),
    ),
  ashby: async (board) => {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
    return asJobList(await fetchJson(url), url);
  },
  lever: (board) =>
    fetchFromHosts(
      ["api.lever.co", "api.eu.lever.co"],
      (host, skip = 0) =>
        `https://${host}/v0/postings/${board}?mode=json&limit=${LEVER_PAGE_SIZE}&skip=${skip}`,
      async (host, buildUrl) => {
        const jobs = new Map();
        for (let skip = 0; ; skip += LEVER_PAGE_SIZE) {
          const url = buildUrl(host, skip);
          const page = asJobList(await fetchJson(url), url);
          const sizeBefore = jobs.size;
          page.forEach((job) => jobs.set(job.id, job));
          if (page.length < LEVER_PAGE_SIZE || jobs.size === sizeBefore) break;
          await sleep(PAUSE_MS);
        }
        return [...jobs.values()];
      },
    ),
};

// Never overwrites: text saved earlier survives after the posting closes.
async function saveOffer(offer, raw, fetchedAt) {
  const directory = path.join(OUTPUT_DIR, offer.ats, offer.board);
  await mkdir(directory, { recursive: true });
  const record = {
    url: offer.url,
    ats: offer.ats,
    board: offer.board,
    externalId: offer.externalId,
    fetchedAt,
    raw,
  };
  try {
    await writeFile(path.join(directory, `${offer.externalId}.json`), JSON.stringify(record, null, 2), {
      flag: "wx",
    });
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return false;
  }
}

async function rescueBoard(offers) {
  const { ats, board } = offers[0];
  let jobs;
  try {
    jobs = await fetchers[ats](board);
  } catch (error) {
    const status = offers.every((offer) => offer.boardIsGuess) ? "unresolved_board" : "board_error";
    return offers.map((offer) => ({ ...offer, status, detail: error.message }));
  }

  const jobsById = new Map(jobs.map((job) => [String(job.id), job]));
  const boardConfirmed = offers.some((offer) => !offer.boardIsGuess || jobsById.has(offer.externalId));
  const fetchedAt = new Date().toISOString();
  const results = [];
  for (const offer of offers) {
    const job = jobsById.get(offer.externalId);
    if (job) {
      await saveOffer(offer, job, fetchedAt);
      results.push({ ...offer, status: "saved", detail: "" });
    } else {
      // A guessed board with no matching id may simply be the wrong board.
      const status = boardConfirmed ? "not_on_board" : "unresolved_board";
      results.push({ ...offer, status, detail: `${jobs.length} jobs on board` });
    }
  }
  return results;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

async function readCompanyBoards() {
  const file = JSON.parse(await readFile("data/companies.json", "utf8"));
  return file.companies
    .filter((company) => company.active === true && fetchers[company.ats])
    .map((company) => ({ ats: company.ats, board: company.boardToken, name: company.name }));
}

function jobUrl(job, ats, board) {
  const url = job.absolute_url ?? job.hostedUrl ?? job.jobUrl;
  if (url) return url;
  return ats === "ashby" ? `https://jobs.ashbyhq.com/${board}/${job.id}` : `${ats}:${board}/${job.id}`;
}

// Saves every current posting of one board, whether or not career-ops accepted it.
async function rescueWholeBoard({ ats, board }, dryRun) {
  let jobs;
  try {
    jobs = await fetchers[ats](board);
  } catch (error) {
    return [{ url: "", ats, board, externalId: "", status: "board_error", detail: error.message }];
  }
  const fetchedAt = new Date().toISOString();
  const results = [];
  for (const job of jobs) {
    const offer = { url: jobUrl(job, ats, board), ats, board, externalId: String(job.id) };
    if (!SAFE_SEGMENT.test(offer.externalId)) {
      results.push({ ...offer, status: "bad_id", detail: "" });
      continue;
    }
    const status = dryRun ? "would_save" : (await saveOffer(offer, job, fetchedAt)) ? "saved" : "already_saved";
    results.push({ ...offer, status, detail: String(job.location?.name ?? job.location ?? "") });
  }
  return results;
}

async function writeReport(results, fileName = "rescue-report.tsv") {
  const header = "url\tats\tboard\texternal_id\tstatus\tdetail";
  const lines = results.map((result) =>
    [result.url, result.ats, result.board, result.externalId, result.status, result.detail]
      .map((value) => String(value).replace(/\s+/g, " "))
      .join("\t"),
  );
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, fileName),`${[header, ...lines].join("\n")}\n`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);

  if (process.argv.includes("--source=companies")) {
    const boards = (await readCompanyBoards()).filter((entry) => !only || entry.board === only);
    console.log(`Active boards: ${boards.length}${dryRun ? " (dry run, nothing saved)" : ""}`);
    const results = [];
    for (const entry of boards) {
      const boardResults = await rescueWholeBoard(entry, dryRun);
      results.push(...boardResults);
      console.log(`${entry.ats}:${entry.board}`, countBy(boardResults, (result) => result.status));
      await sleep(PAUSE_MS);
    }
    if (!dryRun && !only) await writeReport(results, "rescue-report-companies.tsv");
    console.log("Total:", countBy(results, (result) => result.status));
    return;
  }

  const offers = await readSeedOffers();
  const groups = new Map();
  for (const offer of offers) {
    if (only && offer.board !== only) continue;
    const key = `${offer.ats}:${offer.board}`;
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }

  const selected = [...groups.values()].flat();
  console.log(`Offers: ${selected.length} of ${offers.length} · boards: ${groups.size}`);
  console.log("By ATS:", countBy(selected, (offer) => offer.ats));
  console.log("Guessed boards:", [...groups.keys()].filter((key) => groups.get(key)[0].boardIsGuess));
  if (dryRun) return;

  const results = [];
  for (const [key, group] of groups) {
    const boardResults = await rescueBoard(group);
    results.push(...boardResults);
    console.log(key, countBy(boardResults, (result) => result.status));
    await sleep(PAUSE_MS);
  }

  if (!only) await writeReport(results);
  console.log("Total:", countBy(results, (result) => result.status));
  console.log("By ATS and status:", countBy(results, (result) => `${result.ats} ${result.status}`));
}

await main();
