import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConnectorError,
  type AtsConnector,
  type AtsName,
  type FetchJobsResult,
  type NormalizedJob,
} from "@remotefit/core";
import { createDb } from "../db/client.js";
import { loadEnv } from "../db/env.js";
import { companies, jobs } from "../db/schema.js";
import { runIngest, type CompanyEntry } from "./run.js";

loadEnv();
const hasDatabase = Boolean(process.env["DATABASE_URL"]);

interface FakeRaw {
  id: string;
  title: string;
  requisitionId: string | null;
}

// Tiny fake ATS so the test is deterministic and never touches the network.
function fakeConnector(respond: () => FetchJobsResult<FakeRaw>): Record<AtsName, AtsConnector> {
  const connector: AtsConnector = {
    fetchJobs: async () => respond(),
    toNormalizedJob: (raw, company): NormalizedJob => {
      const job = raw as FakeRaw;
      return {
        source: "greenhouse",
        companyName: company.name,
        boardToken: company.boardToken,
        externalId: job.id,
        requisitionId: job.requisitionId,
        title: job.title,
        locationRaw: "Colombia, Remote",
        workplaceType: "remote",
        url: `https://example.test/${job.id}`,
        descriptionText: `Description of ${job.title}`,
        postedAt: null,
        raw,
        contentHash: `hash-${job.id}`,
      };
    },
  };
  return { greenhouse: connector, lever: connector, ashby: connector };
}

const entry: CompanyEntry = {
  name: "FakeCo",
  ats: "greenhouse",
  boardToken: "fakeco",
  active: true,
};
const a: FakeRaw = { id: "a", title: "Solutions Engineer", requisitionId: "481" };
const b: FakeRaw = { id: "b", title: "Solutions Engineer", requisitionId: "481" };
const c: FakeRaw = { id: "c", title: "Solutions Engineer", requisitionId: "482" };

// Needs a migrated database (npm run db:migrate). Skipped when DATABASE_URL is not set.
describe.skipIf(!hasDatabase)("runIngest against PostgreSQL", () => {
  let connection: ReturnType<typeof createDb>;

  beforeAll(() => {
    connection = createDb();
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`truncate table fit_results, jobs, companies restart identity cascade`,
    );
  });
  afterAll(async () => {
    await connection.db.execute(
      sql`truncate table fit_results, jobs, companies restart identity cascade`,
    );
    await connection.pool.end();
  });

  const run = (respond: () => FetchJobsResult<FakeRaw>) =>
    runIngest(connection.db, [entry], { connectors: fakeConnector(respond), pauseMs: 0 });
  const rows = () => connection.db.select().from(jobs).orderBy(jobs.externalId);

  it("inserts postings, groups siblings and keeps distinct postings with the same title apart", async () => {
    await run(() => ({ status: "ok", jobs: [a, b, c] }));
    const stored = await rows();
    expect(stored).toHaveLength(3);
    const [rowA, rowB, rowC] = stored;
    expect(rowA?.siblingGroup).toBe(rowB?.siblingGroup);
    expect(rowC?.siblingGroup).not.toBe(rowA?.siblingGroup);
  });

  it("closes an absent posting without deleting it, then reopens it when it returns", async () => {
    await run(() => ({ status: "ok", jobs: [a, b] }));
    const [closeSummary] = await run(() => ({ status: "ok", jobs: [a] }));
    expect(closeSummary?.closed).toBe(1);
    const afterClose = await rows();
    expect(afterClose).toHaveLength(2);
    expect(afterClose.find((r) => r.externalId === "b")).toMatchObject({ isActive: false });
    expect(afterClose.find((r) => r.externalId === "b")?.closedAt).not.toBeNull();

    const [reopenSummary] = await run(() => ({ status: "ok", jobs: [a, b] }));
    expect(reopenSummary?.reopened).toBe(1);
    const afterReopen = await rows();
    expect(afterReopen.find((r) => r.externalId === "b")).toMatchObject({
      isActive: true,
      closedAt: null,
    });
  });

  it("does not close anything when the board fails, is not found, or comes back empty", async () => {
    await run(() => ({ status: "ok", jobs: [a, b] }));

    const [failed] = await run(() => {
      throw new ConnectorError("HTTP 500", 500);
    });
    expect(failed?.status).toBe("error");

    const [missing] = await run(() => ({ status: "not_found" }));
    expect(missing?.status).toBe("not_found");

    const [empty] = await run(() => ({ status: "ok", jobs: [] }));
    expect(empty?.closed).toBe(0);

    const stored = await rows();
    expect(stored.every((r) => r.isActive && r.closedAt === null)).toBe(true);
  });

  it("is idempotent and creates a single company row", async () => {
    await run(() => ({ status: "ok", jobs: [a] }));
    const [second] = await run(() => ({ status: "ok", jobs: [a] }));
    expect(second).toMatchObject({ inserted: 0, updated: 1 });
    expect(await rows()).toHaveLength(1);
    const found = await connection.db
      .select()
      .from(companies)
      .where(eq(companies.boardToken, "fakeco"));
    expect(found).toHaveLength(1);
  });
});
