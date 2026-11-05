import { Router, type Request } from "express";
import {
  JobsQuerySchema,
  MEASURED_COUNTRIES,
  DEFAULT_COUNTRY,
  decisionFor,
  excerptAround,
  listJobs,
  postingCountries,
  summarizeOne,
  verdictFor,
  type ApiStatus,
  type ClassifierDecision,
  type ClassifierKey,
  type JobDetail,
} from "@remotefit/core";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { countPendingClassification, loadJob, loadListingRows } from "./repository.js";

export interface JobsRoutesOptions {
  db: Db;
  /** The classifier combination whose results are shown (the one `npm run classify` uses). */
  classifier: ClassifierKey;
  decisions?: readonly ClassifierDecision[];
  now?: () => Date;
}

/** Errors with a stable code; the error handler in app.ts turns them into `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(
      400,
      "invalid_query",
      first ? `${first.path.join(".") || "query"}: ${first.message}` : "Invalid query",
    );
  }
  return parsed.data;
}

const IdSchema = z.coerce.number().int().positive();
const CountryOnly = z.object({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default(DEFAULT_COUNTRY),
});

const queryOf = (req: Request): unknown => req.query;

export function jobsRouter(options: JobsRoutesOptions): Router {
  const { db, classifier } = options;
  const now = options.now ?? (() => new Date());
  const router = Router();

  router.get("/jobs", async (req, res) => {
    const query = parse(JobsQuerySchema, queryOf(req));
    const rows = await loadListingRows(db, classifier);
    res.json(listJobs(rows, query, now()));
  });

  router.get("/jobs/:id", async (req, res) => {
    const id = parse(IdSchema, req.params["id"]);
    const { country } = parse(CountryOnly, queryOf(req));
    const loaded = await loadJob(db, id, classifier);
    const summary = loaded ? summarizeOne(loaded.row, loaded.siblings, country, now()) : null;
    if (!loaded || !summary) {
      throw new HttpError(
        404,
        "not_found",
        "Posting not found, closed, or not shown for this country",
      );
    }
    const text = loaded.descriptionText ?? "";
    const excerpt =
      loaded.row.result.evidence
        .map((quote) => excerptAround(text, quote))
        .find((found) => found !== null) ?? null;
    const detail: JobDetail = {
      ...summary,
      excerpt,
      // The whole vacancy: siblings for other countries are listed too, marked as not visible for this country.
      siblings: loaded.siblings.map((s) => ({
        id: s.id,
        location: s.locationRaw,
        url: s.url,
        countries: postingCountries(s),
        visible: verdictFor(s.result, country) !== null,
      })),
      provenance: loaded.provenance,
    };
    res.json(detail);
  });

  router.get("/status", async (_req, res) => {
    const decision = decisionFor(classifier, options.decisions);
    const status: ApiStatus = {
      classifier,
      acceptance: {
        state: decision?.state ?? "not_accepted",
        decidedAt: decision?.decidedAt ?? null,
        testSet: decision?.testSet ?? null,
        precision: decision?.precision ?? null,
        recall: decision?.recall ?? null,
      },
      measuredCountries: [...MEASURED_COUNTRIES],
      pendingClassification: await countPendingClassification(db, classifier),
    };
    res.json(status);
  });

  return router;
}
