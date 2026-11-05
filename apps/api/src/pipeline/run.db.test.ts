import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FakeLLMProvider,
  PublicDataSchema,
  SqlQuotaLedger,
  parseLimits,
  type AtsConnector,
  type AtsName,
  type LLMProvider,
  type NormalizedJob,
} from "@remotefit/core";
import type { createDb } from "../db/client.js";
import { getTestDatabaseUrl, openTestDatabase } from "../db/test-db.js";
import { redactSecrets, runPipeline } from "./run.js";

const testDatabaseUrl = getTestDatabaseUrl();

// Distinctive posting text and secret values: none of them may ever appear in a log line (public Actions logs).
const TITLE = "Backend Engineer ZQXTITLEMARKER";
const LOCATION = "Colombia, Remote";
const QUOTE = "ZQXQUOTEMARKER we hire remotely anywhere in Colombia";
const DESCRIPTION = `ZQXBODYMARKER private-looking paragraph. ${QUOTE}. ZQXBODYMARKER more text.`;
const API_KEY = "AIzaFAKEKEYZQX0123456789abcdefghijklmnop";
const DATABASE_URL = "postgres://remotefit:ZQXPASSWORDMARKER@db.example.test:5432/remotefit";
const FORBIDDEN = [
  "ZQXTITLEMARKER",
  "ZQXQUOTEMARKER",
  "ZQXBODYMARKER",
  API_KEY,
  "ZQXPASSWORDMARKER",
];

const answer = {
  label: "country_specific",
  countries: ["CO"],
  excludedCountries: [],
  workModel: "remote",
  workModelConflict: false,
  seniority: "mid",
  minYearsExperience: null,
  hiringModel: "unknown",
  timezoneRequirement: null,
  requiresUsWorkAuthorization: null,
  postingLanguage: "en",
  evidence: [QUOTE],
};

const limits = parseLimits({
  source: "test",
  verifiedAt: null,
  safetyMargin: 0,
  models: { "model-a": { rpm: 6000, tpm: 1000000, rpd: 1000, thinkingLevel: "MINIMAL" } },
});

function fakeConnectors(): Record<AtsName, AtsConnector> {
  const connector: AtsConnector = {
    fetchJobs: async () => ({ status: "ok", jobs: [{ id: "p1" }] }),
    toNormalizedJob: (raw, company): NormalizedJob => ({
      source: "greenhouse",
      companyName: company.name,
      boardToken: company.boardToken,
      externalId: (raw as { id: string }).id,
      requisitionId: null,
      title: TITLE,
      locationRaw: LOCATION,
      workplaceType: "remote",
      url: "https://example.test/p1",
      descriptionText: DESCRIPTION,
      postedAt: null,
      raw,
      contentHash: "hash-p1",
    }),
  };
  return { greenhouse: connector, lever: connector, ashby: connector };
}

/** A provider that fails with a message carrying posting text, as a real API error could. */
const leakyFailure: LLMProvider = {
  name: "leaky",
  generateStructured: async () => {
    throw new Error(`Bad request for prompt: ${DESCRIPTION} key=${API_KEY}`);
  },
};

describe("redactSecrets", () => {
  it("masks secret values and the password inside a database URL", () => {
    expect(redactSecrets(`key ${API_KEY} url ${DATABASE_URL}`, [API_KEY, DATABASE_URL])).toBe(
      "key *** url ***",
    );
    expect(redactSecrets("password ZQXPASSWORDMARKER alone", [DATABASE_URL])).toBe(
      "password *** alone",
    );
  });
});

describe.skipIf(!testDatabaseUrl)("pipeline logs (public in GitHub Actions)", () => {
  let connection: ReturnType<typeof createDb>;
  let dir = "";

  const wipe = () =>
    connection.db.execute(
      sql`truncate table eligibility_results, llm_usage_daily, llm_eval_reservation, fit_results, jobs, companies restart identity cascade`,
    );

  const run = async (provider: LLMProvider) => {
    const lines: string[] = [];
    const outFile = join(dir, "jobs.json");
    const summary = await runPipeline(connection.db, {
      companies: [{ name: "FakeCo", ats: "greenhouse", boardToken: "fakeco", active: true }],
      ingest: { connectors: fakeConnectors(), pauseMs: 0 },
      classifier: {
        promptVersion: "eligibility-v4",
        postprocessVersion: "postprocess-v3",
        model: "model-a",
      },
      classify: {
        model: "model-a",
        providerFor: () => provider,
        limits,
        ledger: new SqlQuotaLedger((text, params) => connection.pool.query(text, params)),
        sleep: async () => undefined,
        backoffBaseMs: 1,
        maxAttempts: 1,
      },
      outFile,
      log: (line) => lines.push(line),
      secrets: [API_KEY, DATABASE_URL],
    });
    return { summary, lines, outFile };
  };

  const expectClean = (lines: readonly string[]) => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const forbidden of FORBIDDEN) expect(line, line).not.toContain(forbidden);
      expect(line, line).not.toContain(LOCATION);
    }
  };

  beforeAll(async () => {
    connection = await openTestDatabase(testDatabaseUrl ?? "");
  });
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rf-pipeline-"));
    await wipe();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  afterAll(async () => {
    await wipe();
    await connection.pool.end();
  });

  it("logs only counts and ids on a full run, and the public file has the quote but never the description", async () => {
    const { summary, lines, outFile } = await run(new FakeLLMProvider([{ data: answer }]));
    expect(summary).toEqual({ ok: true, failedStep: null });
    expectClean(lines);
    expect(lines.some((l) => l.startsWith("classify eligibility-v4"))).toBe(true);

    const published = readFileSync(outFile, "utf8");
    const data = PublicDataSchema.parse(JSON.parse(published));
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0]?.result.evidence).toEqual([QUOTE]);
    expect(published).not.toContain("ZQXBODYMARKER");
    expect(published).not.toContain(API_KEY);
  });

  it("keeps posting text and secrets out of the logs when a step fails with a leaky error message", async () => {
    const { lines } = await run(leakyFailure);
    expectClean(lines);
  });
});
