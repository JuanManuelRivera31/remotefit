// `npm run export`: writes the public JSON the static site downloads (S11). Only what PublicDataSchema allows.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  MEASURED_COUNTRIES,
  PublicDataSchema,
  decisionFor,
  publishableRows,
  toPublicJob,
  type ClassifierDecision,
  type ClassifierKey,
  type PublicData,
} from "@remotefit/core";
import type { Db } from "../db/client.js";
import { countPendingClassification, loadListingRows } from "../jobs/repository.js";

export async function buildPublicData(
  db: Db,
  options: { classifier: ClassifierKey; decisions?: readonly ClassifierDecision[]; now: Date },
): Promise<PublicData> {
  const rows = publishableRows(await loadListingRows(db, options.classifier));
  const decision = decisionFor(options.classifier, options.decisions);
  return PublicDataSchema.parse({
    generatedAt: options.now.toISOString(),
    classifier: options.classifier,
    acceptance: {
      state: decision?.state ?? "not_accepted",
      decidedAt: decision?.decidedAt ?? null,
      testSet: decision?.testSet ?? null,
      precision: decision?.precision ?? null,
      recall: decision?.recall ?? null,
      precisionCi: decision?.precisionCi ?? null,
      recallCi: decision?.recallCi ?? null,
    },
    measuredCountries: [...MEASURED_COUNTRIES],
    pendingClassification: await countPendingClassification(db, options.classifier),
    jobs: rows.map(toPublicJob),
  });
}

export function writePublicData(file: string, data: PublicData): { bytes: number } {
  mkdirSync(dirname(file), { recursive: true });
  const text = JSON.stringify(data);
  writeFileSync(file, text);
  return { bytes: Buffer.byteLength(text) };
}
