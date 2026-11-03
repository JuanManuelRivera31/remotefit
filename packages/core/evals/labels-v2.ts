import { ELIGIBILITY_LABELS, isApplicable, type EligibilityLabel } from "../src/index.js";

/** One hand label for a test-v2 case, as written in data/eval-v2-labels-claude.tsv (outside git). */
export interface LabelRow {
  id: string;
  label: EligibilityLabel;
  countries: string[];
  workModel: "remote" | "hybrid" | "onsite" | "unknown";
  workModelConflict: boolean;
  needsOwner: boolean;
  evidence: string;
  note: string;
  /** Optional 9th column (rule 6 of the labelling guide): travel or periodic in-person weeks of a remote role. */
  travelRequirement?: string;
}

export const LABEL_COLUMNS = [
  "id",
  "label",
  "countries",
  "workModel",
  "workModelConflict",
  "needsOwner",
  "evidence",
  "note",
] as const;

const WORK_MODELS = new Set(["remote", "hybrid", "onsite", "unknown"]);

/** Parses and validates the TSV. Throws with every problem found, so a bad batch is fixed in one go. */
export function parseLabelRows(tsv: string): LabelRow[] {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = (lines[0] ?? "").split("\t");
  const withTravel = [...LABEL_COLUMNS, "travelRequirement"].join(",");
  if (header.join(",") !== LABEL_COLUMNS.join(",") && header.join(",") !== withTravel) {
    throw new Error(
      `Unexpected header. Expected: ${LABEL_COLUMNS.join("\\t")} (optionally followed by travelRequirement)`,
    );
  }
  const problems: string[] = [];
  const rows: LabelRow[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split("\t");
    const where = `row ${index + 2}`;
    const [
      id = "",
      label = "",
      countries = "",
      workModel = "",
      conflict = "",
      needs = "",
      evidence = "",
      note = "",
      travel = "",
    ] = cells;
    if (cells.length < 7)
      problems.push(`${where}: expected ${LABEL_COLUMNS.length} columns, got ${cells.length}`);
    if (seen.has(id)) problems.push(`${where}: duplicate id ${id}`);
    seen.add(id);
    if (!(ELIGIBILITY_LABELS as readonly string[]).includes(label))
      problems.push(`${where}: bad label "${label}"`);
    if (!WORK_MODELS.has(workModel)) problems.push(`${where}: bad workModel "${workModel}"`);
    const list = countries === "" ? [] : countries.split(",").map((c) => c.trim());
    for (const country of list)
      if (!/^[A-Z]{2}$/.test(country)) problems.push(`${where}: bad country "${country}"`);
    if ((label === "latam_eligible" || label === "worldwide") && workModel !== "remote") {
      problems.push(`${where}: ${label} requires workModel remote`);
    }
    if (label === "country_specific" && list.length === 0 && !/outside|region/i.test(note)) {
      problems.push(
        `${where}: country_specific without countries needs a note saying why (region outside LATAM)`,
      );
    }
    if (evidence.trim() === "") problems.push(`${where}: evidence is required`);
    if (evidence.trim().split(/\s+/).length > 25)
      problems.push(`${where}: evidence longer than 25 words`);
    rows.push({
      id,
      label: label as EligibilityLabel,
      countries: list,
      workModel: workModel as LabelRow["workModel"],
      workModelConflict: conflict === "yes",
      needsOwner: needs === "yes",
      evidence: evidence.trim(),
      note: note.trim(),
      ...(travel.trim() ? { travelRequirement: travel.trim() } : {}),
    });
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return rows;
}

export interface CasesFileLike {
  cases: Record<string, unknown>[];
  testSet: Record<string, unknown>;
}

/** Writes the labels into the pending test cases. Returns how many were applied; refuses unknown or non-pending ids. */
export function applyLabelRows(
  data: CasesFileLike,
  rows: readonly LabelRow[],
  date: string,
): number {
  const byId = new Map(data.cases.map((item) => [item.id as string, item]));
  const problems: string[] = [];
  for (const row of rows) {
    const item = byId.get(row.id);
    if (!item) problems.push(`unknown case ${row.id}`);
    else if (item["split"] !== "test") problems.push(`${row.id} is not a test case`);
    else if (item["labelStatus"] !== "pending" && item["labelSource"] !== "llm-assisted") {
      problems.push(`${row.id} already has a label from another source`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  for (const row of rows) {
    const item = byId.get(row.id) as Record<string, unknown>;
    item["label"] = row.label;
    item["countries"] = row.countries;
    item["workModel"] = row.workModel;
    item["workModelConflict"] = row.workModelConflict;
    item["evidence"] = row.evidence;
    item["labelSource"] = "llm-assisted";
    item["labeledAt"] = date;
    item["bodyChecked"] = true;
    item["labelStatus"] = row.needsOwner ? "needs_owner" : "labeled";
    if (row.note) item["labelNote"] = row.note;
    if (row.travelRequirement) item["travelRequirement"] = row.travelRequirement;
  }
  return rows.length;
}

export interface FreezeSummary {
  total: number;
  pending: number;
  applicableCO: number;
  perCompany: Record<string, { n: number; applicable: number }>;
  status: "frozen" | "provisional" | "incomplete";
  missingForTarget: number;
}

/** Counts the applicable cases for Colombia (ADR 0004 rule) and decides the status: frozen (>= 60), provisional or incomplete. */
export function freezeSummary(data: CasesFileLike, target = 60): FreezeSummary {
  const tests = data.cases.filter((item) => item["split"] === "test");
  const pending = tests.filter((item) => item["labelStatus"] === "pending").length;
  const perCompany: FreezeSummary["perCompany"] = {};
  let applicable = 0;
  for (const item of tests) {
    const board = item["board"] as string;
    const entry = (perCompany[board] ??= { n: 0, applicable: 0 });
    entry.n += 1;
    if (item["labelStatus"] === "pending") continue;
    const yes = isApplicable(
      {
        label: item["label"] as EligibilityLabel,
        workModel: item["workModel"] as LabelRow["workModel"],
        countries: (item["countries"] as string[]) ?? [],
        excludedCountries: [],
      },
      "CO",
    );
    if (yes) {
      entry.applicable += 1;
      applicable += 1;
    }
  }
  return {
    total: tests.length,
    pending,
    applicableCO: applicable,
    perCompany,
    status: pending > 0 ? "incomplete" : applicable >= target ? "frozen" : "provisional",
    missingForTarget: Math.max(0, target - applicable),
  };
}
