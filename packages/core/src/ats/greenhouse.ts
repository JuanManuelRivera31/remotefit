import { z } from "zod";
import {
  computeContentHash,
  parseDate,
  type CompanyRef,
  type NormalizedJob,
} from "../normalize/job.js";
import { htmlToText } from "../normalize/html.js";
import { getJson, ConnectorError, type ConnectorDeps, type FetchJobsResult } from "./http.js";

// Shape taken from packages/core/fixtures/greenhouse/sezzle.json. Unused fields pass through untouched.
const greenhouseJobSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).transform(String),
  title: z.string(),
  absolute_url: z.string(),
  location: z.looseObject({ name: z.string() }).nullish(),
  offices: z.array(z.looseObject({ name: z.string() })).nullish(),
  requisition_id: z.string().nullish(),
  first_published: z.string().nullish(),
  content: z.string().nullish(),
});
const greenhouseResponseSchema = z.looseObject({ jobs: z.array(z.unknown()) });

export type GreenhouseJob = z.infer<typeof greenhouseJobSchema>;

export async function fetchJobs(
  boardToken: string,
  deps: ConnectorDeps = {},
): Promise<FetchJobsResult<unknown>> {
  const body = await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`,
    deps,
  );
  if (body === null) return { status: "not_found" };
  const parsed = greenhouseResponseSchema.safeParse(body);
  if (!parsed.success) throw new ConnectorError(`Unexpected Greenhouse response for ${boardToken}`);
  return { status: "ok", jobs: parsed.data.jobs };
}

export function toNormalizedJob(raw: unknown, company: CompanyRef): NormalizedJob {
  const job = greenhouseJobSchema.parse(raw);
  // Greenhouse has one main location plus offices; keep both, without repeating.
  const locations = [
    job.location?.name,
    ...(job.offices ?? []).map((office) => office.name),
  ].filter((name): name is string => Boolean(name));
  const locationRaw = [...new Set(locations)].join(" | ");
  const title = job.title.trim();
  const descriptionText = htmlToText(job.content ?? "", { escaped: true });
  return {
    source: "greenhouse",
    companyName: company.name,
    boardToken: company.boardToken,
    externalId: job.id,
    requisitionId: job.requisition_id || null,
    title,
    locationRaw,
    // The public Greenhouse API has no workplace-type field.
    workplaceType: null,
    url: job.absolute_url,
    descriptionText,
    postedAt: parseDate(job.first_published),
    raw,
    contentHash: computeContentHash({ title, locationRaw, descriptionText }),
  };
}
