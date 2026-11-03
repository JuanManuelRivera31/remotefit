import { isQuoteInSource } from "../src/eligibility/postprocess.js";

export type EvidenceVerdict = "literal" | "metadata" | "fail_missing" | "fail_unverified";

export interface EvidenceJob {
  title: string;
  locationRaw: string;
  workplaceType: string | null;
  descriptionText: string;
}

const norm = (t: string): string =>
  t
    .toLowerCase()
    .replace(/[‐-―—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** The text a label may quote: title, location, ATS workplace type and body. */
export function evidenceSource(job: EvidenceJob): string {
  return `${job.title}\n${job.locationRaw}\n${job.workplaceType ?? ""}\n${job.descriptionText}`;
}

/**
 * Verifies metadata-style evidence ("[metadata] location "X", workplaceType "Y"", "LOCATION: X; ATS_WORKPLACE_TYPE: y",
 * "TITLE: ...") against the structured fields. Returns null when the text is not metadata-style.
 * Upper-case keys are labels written by the labeller; "Location: ..." is a quote from the body.
 */
export function checkMetadataEvidence(evidence: string, job: EvidenceJob): boolean | null {
  const isMeta =
    /^(ATS_WORKPLACE_TYPE:|LOCATION:|TITLE:)/.test(evidence) ||
    /^\[metadata\]|workplaceType\s+"?(remote|hybrid|onsite)/i.test(evidence);
  if (!isMeta) return null;
  const source = evidenceSource(job);
  const checks: boolean[] = [];
  for (const m of evidence.matchAll(/workplaceType\s+"?(remote|hybrid|onsite)"?/gi))
    checks.push(norm(job.workplaceType ?? "") === norm(m[1] as string));
  for (const m of evidence.matchAll(/ATS_WORKPLACE_TYPE:\s*(remote|hybrid|onsite)/gi))
    checks.push(norm(job.workplaceType ?? "") === norm(m[1] as string));
  for (const m of evidence.matchAll(/\blocation\s+"([^"]+)"/gi))
    checks.push(norm(job.locationRaw).includes(norm(m[1] as string)));
  for (const m of evidence.matchAll(/LOCATION:\s*([^;(]+?)\s*(?:;|\(|$)/g))
    checks.push(norm(job.locationRaw).includes(norm(m[1] as string)));
  for (const m of evidence.matchAll(/TITLE:\s*([^;|]+?)\s*(?:;|\||$)/g)) {
    const parts = (m[1] as string)
      .split(/\.\.\./)
      .map((p) => norm(p))
      .filter((p) => p.length > 2);
    checks.push(parts.every((p) => norm(job.title).includes(p)));
  }
  for (const m of evidence.matchAll(/body tag (#\S+)/gi))
    checks.push(norm(source).includes(norm(m[1] as string)));
  return checks.length > 0 && checks.every(Boolean);
}

/** Classifies the evidence of a label: literal in the posting, verified metadata, missing or not verifiable. */
export function verifyEvidence(
  evidenceRaw: string | null | undefined,
  job: EvidenceJob,
): EvidenceVerdict {
  const evidence = (evidenceRaw ?? "").trim();
  if (!evidence) return "fail_missing";
  const source = evidenceSource(job);
  const quotes = [...evidence.matchAll(/"([^"]{4,})"/g)].map((m) => m[1] as string);
  const meta = checkMetadataEvidence(evidence, job);
  if (meta === true) return "metadata";
  if (meta === null && quotes.length > 0 && quotes.every((q) => isQuoteInSource(q, source)))
    return "literal";
  if (
    meta === null &&
    quotes.length === 0 &&
    isQuoteInSource(evidence.replace(/^location\s*:\s*/i, ""), source)
  )
    return "literal";
  return "fail_unverified";
}
