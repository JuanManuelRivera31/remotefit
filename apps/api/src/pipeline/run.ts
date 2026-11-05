// The daily pipeline of the published site (S11): ingest → prefilter → classify → export. The ingest also verifies
// that postings are still open (absent ones are closed, never deleted) and the export only includes open ones.
// Logging rule: GitHub Actions logs of a public repository are public, so every line goes through `safeLog`, which
// prints counts, ids, versions and company names from the directory only, never posting text, and masks the values
// of the secrets as a second line of defence.
import {
  ELIGIBILITY_PROMPT_VERSION,
  type ClassifierDecision,
  type ClassifierKey,
  type QueueEvent,
} from "@remotefit/core";
import type { Db } from "../db/client.js";
import { runClassify, type ClassifyRunOptions } from "../classify/run.js";
import { buildPublicData, writePublicData } from "../export/run.js";
import { runIngest, type CompanyEntry, type IngestOptions } from "../ingest/run.js";
import { runPrefilter } from "../prefilter/run.js";

/** Replaces every occurrence of a secret value (and of the password inside a database URL) with ***. */
export function redactSecrets(line: string, secrets: readonly (string | undefined)[]): string {
  let out = line;
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    out = out.split(secret).join("***");
    const password = /^[a-z]+:\/\/[^:/@]+:([^@]+)@/i.exec(secret)?.[1];
    if (password && password.length >= 4) out = out.split(password).join("***");
  }
  return out;
}

export interface PipelineOptions {
  companies: readonly CompanyEntry[];
  ingest?: IngestOptions;
  classify: Omit<ClassifyRunOptions, "onEvent" | "onWarn" | "model"> & { model: string };
  classifier: ClassifierKey;
  decisions?: readonly ClassifierDecision[];
  outFile: string;
  /** Raw sink (console.log in the CLI). Lines reach it only through safeLog. */
  log: (line: string) => void;
  /** Secret values to mask in every line (GEMINI_API_KEY, DATABASE_URL...). */
  secrets: readonly (string | undefined)[];
  now?: () => Date;
}

export interface PipelineSummary {
  ok: boolean;
  failedStep: string | null;
}

export async function runPipeline(db: Db, options: PipelineOptions): Promise<PipelineSummary> {
  const now = options.now ?? (() => new Date());
  const safeLog = (line: string) => options.log(redactSecrets(line, options.secrets));
  let step = "ingest";
  try {
    const boards = await runIngest(db, options.companies, options.ingest);
    const sum = (key: "inserted" | "updated" | "closed" | "reopened" | "fetched") =>
      boards.reduce((total, b) => total + b[key], 0);
    const problems = boards.filter((b) => b.status === "error" || b.status === "not_found");
    safeLog(
      `ingest: ${boards.length} boards · fetched ${sum("fetched")} · new ${sum("inserted")} · ` +
        `closed ${sum("closed")} · reopened ${sum("reopened")} · problems ${problems.length}`,
    );
    for (const board of problems) safeLog(`ingest problem: ${board.company} (${board.status})`);

    step = "prefilter";
    const pre = await runPrefilter(db);
    safeLog(
      `prefilter ${pre.version}: evaluated ${pre.evaluated} · changed ${pre.changed} · ` +
        `discarded ${pre.discarded} · pass ${pre.passed}`,
    );

    step = "classify";
    const classified = await runClassify(db, {
      ...options.classify,
      onEvent: (event: QueueEvent) => {
        if (event.kind === "retry") {
          safeLog(
            `classify retry: job ${event.jobId} · ${event.why} · ${Math.round(event.waitMs / 1000)} s`,
          );
        } else if (event.kind === "stopped") {
          safeLog(`classify stopped: ${event.reason}`);
        }
      },
      onWarn: () => safeLog("classify warning: 80 % of the daily request limit used"),
    });
    if (classified.blockedByEval) {
      safeLog(
        `classify skipped: an eval is pending (${classified.blockedByEval.split}, ` +
          `${classified.blockedByEval.remaining} cases left) and has priority on the quota`,
      );
    } else {
      safeLog(
        `classify ${ELIGIBILITY_PROMPT_VERSION} · ${classified.model}: classified ${classified.classified} ` +
          `of ${classified.total} · still pending ${classified.pendingAfter}`,
      );
    }

    step = "export";
    const data = await buildPublicData(db, {
      classifier: options.classifier,
      ...(options.decisions ? { decisions: options.decisions } : {}),
      now: now(),
    });
    const { bytes } = writePublicData(options.outFile, data);
    const vacancies = new Set(data.jobs.map((j) => j.siblingGroup ?? `j${j.id}`)).size;
    safeLog(
      `export: ${data.jobs.length} postings in ${vacancies} vacancies · ${Math.round(bytes / 1024)} KB`,
    );
    return { ok: true, failedStep: null };
  } catch (error) {
    // Only the error class: messages can carry a provider response or a query with posting text.
    safeLog(`pipeline failed at ${step}: ${error instanceof Error ? error.name : "unknown error"}`);
    return { ok: false, failedStep: step };
  }
}
