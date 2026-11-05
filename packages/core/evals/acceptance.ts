import { applicableFor, computeMetrics, type EvalRow } from "./metrics.js";

/** Acceptance criterion of ADR 0004 section 5, fixed BEFORE the run on the frozen test split. */
export const ACCEPTANCE_CRITERION = { minPrecision: 0.95, minRecall: 0.8 } as const;

const pct = (value: number | null): string =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
const ci = (interval: [number, number] | null): string =>
  interval === null ? "" : ` (${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)})`;
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export interface AcceptanceVerdict {
  accepted: boolean;
  precision: number | null;
  recall: number | null;
}

/** Point-value verdict (not the interval): precision >= 95 % and recall >= 80 %. */
export function acceptanceVerdict(rows: readonly EvalRow[], country = "CO"): AcceptanceVerdict {
  const a = computeMetrics(rows, country).applicable;
  const accepted =
    a.precision !== null &&
    a.recall !== null &&
    a.precision >= ACCEPTANCE_CRITERION.minPrecision &&
    a.recall >= ACCEPTANCE_CRITERION.minRecall;
  return { accepted, precision: a.precision, recall: a.recall };
}

function metricsRow(name: string, rows: readonly EvalRow[], country: string): string {
  if (rows.length === 0) return `| ${name} | 0 | | | | |`;
  const a = computeMetrics(rows, country).applicable;
  return (
    `| ${name} | ${rows.length} | ${a.tp}/${a.fp}/${a.fn}/${a.tn} | ` +
    `${pct(a.precision)}${ci(a.precisionCi)} | ${pct(a.recall)}${ci(a.recallCi)} | ${a.positives} |`
  );
}

const header = [
  "| Alcance | Casos | TP/FP/FN/TN | Precisión (IC 95 % Wilson) | Recall (IC 95 % Wilson) | Aplicables |",
  "|---|---|---|---|---|---|",
];

function describe(value: { label: string; workModel: string; countries: string[] }): string {
  const countries = value.countries.length > 0 ? ` [${value.countries.join(",")}]` : "";
  return `${value.label} / ${value.workModel}${countries}`;
}

/**
 * Markdown sections of the acceptance run: verdict against the fixed criterion, breakdown by company, totals without
 * Sezzle / Canonical / Lever, and every false positive and false negative with the evidence of the label and the model.
 * Nothing here is used to tune the classifier (ADR 0004): if the criterion fails, the work stops.
 */
export function formatAcceptanceSections(rows: readonly EvalRow[], country = "CO"): string[] {
  const verdict = acceptanceVerdict(rows, country);
  const lines: string[] = [
    "## Criterio de aceptación (fijado antes de correr, ADR 0004 sección 6)",
    "",
    `Valor puntual: precisión ≥ ${ACCEPTANCE_CRITERION.minPrecision * 100} % y recall ≥ ${ACCEPTANCE_CRITERION.minRecall * 100} % sobre el total del conjunto de prueba.`,
    "",
    `**Resultado: ${verdict.accepted ? "ACEPTADA" : "NO ACEPTADA"}** — precisión ${pct(verdict.precision)}, recall ${pct(verdict.recall)}.`,
    "",
    "## Desglose",
    "",
    ...header,
    metricsRow("Total", rows, country),
    metricsRow(
      "Sin Sezzle",
      rows.filter((r) => r.board !== "sezzle"),
      country,
    ),
    metricsRow(
      "Sin Canonical",
      rows.filter((r) => r.board !== "canonical"),
      country,
    ),
    metricsRow(
      "Sin Nortal",
      rows.filter((r) => r.board !== "nortal"),
      country,
    ),
    metricsRow(
      "Sin Lever",
      rows.filter((r) => r.ats !== "lever"),
      country,
    ),
    // The concentrated sources removed together: what is left is the long tail of companies.
    metricsRow(
      "Sin Canonical, Nortal, Sezzle ni Lever",
      rows.filter(
        (r) => !["canonical", "nortal", "sezzle"].includes(r.board ?? "") && r.ats !== "lever",
      ),
      country,
    ),
  ];
  const boards = [...new Set(rows.map((r) => r.board ?? "?"))].sort();
  for (const board of boards) {
    lines.push(
      metricsRow(
        `Empresa: ${board}`,
        rows.filter((r) => (r.board ?? "?") === board),
        country,
      ),
    );
  }
  lines.push("");

  const errors = [
    { title: "Falsos positivos", pick: (e: boolean, p: boolean) => p && !e },
    { title: "Falsos negativos", pick: (e: boolean, p: boolean) => e && !p },
  ];
  for (const { title, pick } of errors) {
    const list = rows.filter((r) =>
      pick(applicableFor(r.expected, country), applicableFor(r.predicted, country)),
    );
    lines.push(`## ${title} (${list.length})`, "");
    if (list.length === 0) lines.push("Ninguno.", "");
    for (const row of list) {
      lines.push(
        `### ${row.id} — ${cell(row.title)}`,
        `- **Etiqueta esperada:** ${describe(row.expected)}`,
        `- **Evidencia de la etiqueta:** ${cell(row.expectedEvidence)}`,
        `- **Predicho:** ${describe(row.predicted)}${row.status === "ok" ? "" : ` · estado: ${row.status}`}`,
        `- **Evidencia del modelo:** ${row.predicted.evidence.map((quote) => `"${cell(quote)}"`).join(" · ")}`,
        "",
      );
    }
  }
  return lines;
}
