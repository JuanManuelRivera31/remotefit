/**
 * Sibling groups: the same posting published once per country (Sezzle does this).
 * Precision first: two postings join only when company and normalized title match AND their
 * requisition ids do not contradict each other. A placeholder id ("TBD", "0000") proves nothing.
 */

const PLACEHOLDER_REQUISITION =
  /^(t\.?b\.?[dc]\w*|n\/?a|none|null|undefined|-+|x+|0+|[1-9]0{3,})$/i;

/** True when the id can tell two postings apart (not empty and not a filler like "TBD", "tbc", "0000"). */
export function isReliableRequisitionId(value: string | null | undefined): value is string {
  const id = value?.trim();
  return Boolean(id) && !PLACEHOLDER_REQUISITION.test(id as string);
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface SiblingInput {
  source: string;
  boardToken: string;
  title: string;
  requisitionId: string | null;
}

/**
 * Returns one group key per input, in the same order.
 * - Reliable requisition id: key = company + title + id, so equal ids join and different ids stay apart.
 * - Unreliable id: key = company + title, kept apart from any reliable-id group (we cannot prove they match).
 */
export function assignSiblingGroups(jobs: readonly SiblingInput[]): string[] {
  return jobs.map((job) => {
    const base = `${job.source}:${job.boardToken}|${normalizeTitle(job.title)}`;
    return isReliableRequisitionId(job.requisitionId)
      ? `${base}|req:${job.requisitionId.trim().toLowerCase()}`
      : base;
  });
}
