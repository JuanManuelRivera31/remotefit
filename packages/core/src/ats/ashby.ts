import { z } from "zod";
import {
  computeContentHash,
  parseDate,
  parseWorkplaceType,
  type CompanyRef,
  type NormalizedJob,
} from "../normalize/job.js";
import { htmlToText } from "../normalize/html.js";
import { getJson, ConnectorError, type ConnectorDeps, type FetchJobsResult } from "./http.js";

// Shape taken from packages/core/fixtures/ashby/addi.json.
const ashbyJobSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string(),
  isListed: z.boolean().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.looseObject({ location: z.string().nullish() })).nullish(),
  workplaceType: z.string().nullish(),
  publishedAt: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
});
const ashbyResponseSchema = z.looseObject({ jobs: z.array(z.unknown()) });

export type AshbyJob = z.infer<typeof ashbyJobSchema>;

export async function fetchJobs(
  boardToken: string,
  deps: ConnectorDeps = {},
): Promise<FetchJobsResult<unknown>> {
  const body = await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardToken)}?includeCompensation=true`,
    deps,
  );
  if (body === null) return { status: "not_found" };
  const parsed = ashbyResponseSchema.safeParse(body);
  if (!parsed.success) throw new ConnectorError(`Unexpected Ashby response for ${boardToken}`);
  // Unlisted postings are not public: drop them (rules/ats-connectors.md).
  const jobs = parsed.data.jobs.filter(
    (job) => ashbyJobSchema.safeParse(job).data?.isListed !== false,
  );
  return { status: "ok", jobs };
}

export function toNormalizedJob(raw: unknown, company: CompanyRef): NormalizedJob {
  const job = ashbyJobSchema.parse(raw);
  const locations = [
    job.location,
    ...(job.secondaryLocations ?? []).map((item) => item.location),
  ].filter((name): name is string => Boolean(name));
  const locationRaw = [...new Set(locations)].join(" | ");
  const title = job.title.trim();
  const descriptionText = job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml ?? "");
  return {
    source: "ashby",
    companyName: company.name,
    boardToken: company.boardToken,
    externalId: job.id,
    // Ashby does not expose a requisition id.
    requisitionId: null,
    title,
    locationRaw,
    workplaceType: parseWorkplaceType(job.workplaceType),
    url: job.jobUrl,
    descriptionText,
    postedAt: parseDate(job.publishedAt),
    raw,
    contentHash: computeContentHash({ title, locationRaw, descriptionText }),
  };
}
