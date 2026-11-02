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

// Shape taken from packages/core/fixtures/lever/deuna.json.
const leverJobSchema = z.looseObject({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  createdAt: z.number().nullish(),
  workplaceType: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  additionalPlain: z.string().nullish(),
  lists: z
    .array(z.looseObject({ text: z.string().nullish(), content: z.string().nullish() }))
    .nullish(),
  categories: z
    .looseObject({ location: z.string().nullish(), allLocations: z.array(z.string()).nullish() })
    .nullish(),
});

export type LeverJob = z.infer<typeof leverJobSchema>;

export const LEVER_PAGE_SIZE = 100;
/** Hard stop so a misbehaving API cannot loop forever (50 000 postings). */
const MAX_PAGES = 500;

export async function fetchJobs(
  boardToken: string,
  deps: ConnectorDeps = {},
): Promise<FetchJobsResult<unknown>> {
  const jobs: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}?mode=json&skip=${page * LEVER_PAGE_SIZE}&limit=${LEVER_PAGE_SIZE}`;
    const body = await getJson(url, deps);
    if (body === null) {
      // A 404 on a later page would mean a partial list: do not report success.
      if (page === 0) return { status: "not_found" };
      throw new ConnectorError(`Lever board ${boardToken} disappeared while paginating`, 404);
    }
    if (!Array.isArray(body))
      throw new ConnectorError(`Unexpected Lever response for ${boardToken}`);
    jobs.push(...body);
    if (body.length < LEVER_PAGE_SIZE) return { status: "ok", jobs };
  }
  throw new ConnectorError(`Lever board ${boardToken} exceeded ${MAX_PAGES} pages`);
}

export function toNormalizedJob(raw: unknown, company: CompanyRef): NormalizedJob {
  const job = leverJobSchema.parse(raw);
  const locations = [job.categories?.location, ...(job.categories?.allLocations ?? [])].filter(
    (name): name is string => Boolean(name),
  );
  const locationRaw = [...new Set(locations)].join(" | ");
  const title = job.text.trim();
  const descriptionText = [
    job.descriptionPlain ?? "",
    ...(job.lists ?? []).map((list) =>
      [list.text ?? "", htmlToText(list.content ?? "")].filter(Boolean).join("\n"),
    ),
    job.additionalPlain ?? "",
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    source: "lever",
    companyName: company.name,
    boardToken: company.boardToken,
    externalId: job.id,
    // Lever does not expose a requisition id.
    requisitionId: null,
    title,
    locationRaw,
    workplaceType: parseWorkplaceType(job.workplaceType),
    url: job.hostedUrl,
    descriptionText,
    postedAt: parseDate(job.createdAt),
    raw,
    contentHash: computeContentHash({ title, locationRaw, descriptionText }),
  };
}
