import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectors, ConnectorError } from "./index.js";
import type { FetchLike } from "./http.js";
import { htmlToText } from "../normalize/html.js";

const load = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/${path}`, import.meta.url), "utf8"));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fakeFetch =
  (...responses: Response[]): FetchLike =>
  async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return next;
  };

describe("htmlToText", () => {
  it("decodes escaped Greenhouse HTML and keeps list structure", () => {
    const text = htmlToText(
      "&lt;p&gt;Hello&amp;nbsp;world&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;",
      {
        escaped: true,
      },
    );
    expect(text).toBe("Hello world\n\n- One");
  });

  it("removes tags and scripts from plain HTML", () => {
    expect(htmlToText("<div>A<script>x()</script><br>B &#169;</div>")).toBe("A\nB ©");
  });
});

describe("greenhouse connector", () => {
  const company = { name: "Sezzle", boardToken: "sezzle" };
  const fixture = load("greenhouse/sezzle.json") as { jobs: unknown[] };

  it("normalizes a real posting", () => {
    const job = connectors.greenhouse.toNormalizedJob(fixture.jobs[0], company);
    expect(job).toMatchObject({
      source: "greenhouse",
      externalId: "7980309003",
      requisitionId: "0000",
      title: "A.I. Engineering Intern",
      workplaceType: null,
      url: "https://job-boards.greenhouse.io/sezzle/jobs/7980309003",
    });
    expect(job.locationRaw).toBe("Latin America | Bogota, Colombia");
    expect(job.descriptionText).toContain("About Sezzle");
    expect(job.descriptionText).not.toContain("<");
    expect(job.postedAt?.toISOString()).toBe("2026-08-28T13:51:09.000Z");
    expect(job.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns every posting of the board", async () => {
    const result = await connectors.greenhouse.fetchJobs("sezzle", {
      fetch: fakeFetch(json(fixture)),
    });
    expect(result).toEqual({ status: "ok", jobs: fixture.jobs });
  });

  it("handles an empty board and a missing board", async () => {
    expect(
      await connectors.greenhouse.fetchJobs("x", { fetch: fakeFetch(json({ jobs: [] })) }),
    ).toEqual({
      status: "ok",
      jobs: [],
    });
    expect(await connectors.greenhouse.fetchJobs("x", { fetch: fakeFetch(json({}, 404)) })).toEqual(
      {
        status: "not_found",
      },
    );
  });

  it("throws on server errors so the caller never treats them as an empty board", async () => {
    await expect(
      connectors.greenhouse.fetchJobs("x", { fetch: fakeFetch(json({}, 500)) }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe("lever connector", () => {
  const company = { name: "DEUNA", boardToken: "deuna" };
  const fixture = load("lever/deuna.json") as Record<string, unknown>[];

  it("normalizes a real posting", () => {
    const job = connectors.lever.toNormalizedJob(fixture[2], company);
    expect(job).toMatchObject({
      source: "lever",
      externalId: fixture[2]?.id,
      requisitionId: null,
      title: "Engineering Manager",
      workplaceType: "remote",
    });
    expect(job.locationRaw).toContain("Mexico");
    expect(job.descriptionText).toContain("DEUNA");
    expect(job.postedAt).toBeInstanceOf(Date);
  });

  it("maps hybrid workplace type", () => {
    expect(connectors.lever.toNormalizedJob(fixture[1], company).workplaceType).toBe("hybrid");
  });

  it("paginates until a short page", async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...fixture[0], id: `job-${n}-${i}` }));
    const urls: string[] = [];
    const doFetch: FetchLike = async (url) => {
      urls.push(url);
      return json(urls.length === 1 ? page(100) : page(3));
    };
    const result = await connectors.lever.fetchJobs("deuna", { fetch: doFetch });
    expect(result.status === "ok" && result.jobs.length).toBe(103);
    expect(urls[0]).toContain("skip=0&limit=100");
    expect(urls[1]).toContain("skip=100&limit=100");
  });

  it("handles empty and missing boards", async () => {
    expect(await connectors.lever.fetchJobs("x", { fetch: fakeFetch(json([])) })).toEqual({
      status: "ok",
      jobs: [],
    });
    expect(await connectors.lever.fetchJobs("x", { fetch: fakeFetch(json({}, 404)) })).toEqual({
      status: "not_found",
    });
  });

  it("does not report a partial list when a later page fails", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ ...fixture[0], id: `j${i}` }));
    await expect(
      connectors.lever.fetchJobs("x", { fetch: fakeFetch(json(full), json({}, 404)) }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe("ashby connector", () => {
  const company = { name: "Addi", boardToken: "addi" };
  const fixture = load("ashby/addi.json") as { jobs: Record<string, unknown>[] };

  it("normalizes a real posting", () => {
    const job = connectors.ashby.toNormalizedJob(fixture.jobs[0], company);
    expect(job).toMatchObject({
      source: "ashby",
      title: "Backend JVM Software Engineer | IC3",
      locationRaw: "Colombia",
      workplaceType: "remote",
      requisitionId: null,
    });
    expect(job.descriptionText.length).toBeGreaterThan(100);
    expect(job.postedAt?.toISOString()).toBe("2026-05-14T18:21:50.166Z");
  });

  it("leaves workplaceType null when Ashby does not say", () => {
    expect(connectors.ashby.toNormalizedJob(fixture.jobs[2], company).workplaceType).toBeNull();
  });

  it("drops unlisted postings", async () => {
    const body = { ...fixture, jobs: [fixture.jobs[0], { ...fixture.jobs[1], isListed: false }] };
    const result = await connectors.ashby.fetchJobs("addi", { fetch: fakeFetch(json(body)) });
    expect(result.status === "ok" && result.jobs).toEqual([fixture.jobs[0]]);
  });

  it("handles empty and missing boards", async () => {
    expect(await connectors.ashby.fetchJobs("x", { fetch: fakeFetch(json({ jobs: [] })) })).toEqual(
      {
        status: "ok",
        jobs: [],
      },
    );
    expect(await connectors.ashby.fetchJobs("x", { fetch: fakeFetch(json({}, 404)) })).toEqual({
      status: "not_found",
    });
  });
});

describe("content hash", () => {
  it("changes when the description changes and is stable otherwise", () => {
    const fixture = load("ashby/addi.json") as { jobs: Record<string, unknown>[] };
    const company = { name: "Addi", boardToken: "addi" };
    const a = connectors.ashby.toNormalizedJob(fixture.jobs[0], company);
    const again = connectors.ashby.toNormalizedJob(fixture.jobs[0], company);
    const edited = connectors.ashby.toNormalizedJob(
      { ...fixture.jobs[0], descriptionPlain: "different" },
      company,
    );
    expect(again.contentHash).toBe(a.contentHash);
    expect(edited.contentHash).not.toBe(a.contentHash);
  });
});
