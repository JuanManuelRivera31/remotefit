import { ELIGIBILITY_LABELS } from "../src/index.js";
import { applicableFor, type EvalRow, type Metrics, type TokenStats } from "./metrics.js";

export interface ReportContext {
  date: string;
  split: "dev" | "test";
  model: string;
  promptVersion: string;
  thinkingLevel: string;
  /** Limits actually respected (after the safety margin). */
  limits: { rpm: number; rpd: number; verifiedAt: string | null };
  callsMade: number;
  fromCache: number;
  /** Only the development split shows case-by-case failures (ADR 0004). */
  showCases: boolean;
}

const pct = (value: number | null): string =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
const num = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const usd = (value: number): string => `$${value.toFixed(6)}`;
const tokenRow = (name: string, stats: TokenStats): string =>
  `| ${name} | ${num(stats.average)} | ${stats.max} | ${stats.total} |`;
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const SHORT: Record<string, string> = {
  latam_eligible: "latam",
  worldwide: "world",
  us_only: "us_only",
  country_specific: "country",
  onsite_or_hybrid: "onsite",
  unclear: "unclear",
};

function describe(value: {
  label: string;
  workModel: string;
  countries: string[];
  excludedCountries?: string[];
}): string {
  const countries = value.countries.length > 0 ? ` [${value.countries.join(",")}]` : "";
  const excluded =
    value.excludedCountries && value.excludedCountries.length > 0
      ? ` excl ${value.excludedCountries.join(",")}`
      : "";
  return `${value.label} / ${value.workModel}${countries}${excluded}`;
}

export function formatMarkdownReport(
  metrics: Metrics,
  rows: readonly EvalRow[],
  context: ReportContext,
): string {
  const a = metrics.applicable;
  const lines: string[] = [];
  lines.push(`# Informe de evaluación del clasificador — ${context.split}`, "");
  lines.push(
    `- **Fecha:** ${context.date}`,
    `- **Modelo:** ${context.model} (thinking: ${context.thinkingLevel})`,
    `- **Versión del prompt:** ${context.promptVersion}`,
    `- **Conjunto:** ${context.split} (${metrics.n} casos; ${a.positives} aplicables y ${a.negatives} no aplicables para ${metrics.country})`,
    `- **Llamadas:** ${context.callsMade} nuevas + ${context.fromCache} casos desde la caché · ${metrics.attempts} intentos en total (los reintentos cuentan)`,
    `- **Límites respetados:** ${context.limits.rpm} RPM, ${context.limits.rpd} RPD (con margen; verificados ${context.limits.verifiedAt ?? "nunca"})`,
    context.split === "dev"
      ? "- **Uso:** conjunto de desarrollo, para iterar; no es una aceptación de versión (ADR 0004)."
      : "- **Uso:** conjunto de prueba, solo para aceptar una versión candidata; sus fallos no se usan para ajustar nada.",
    "",
  );

  lines.push(`## Aplicables para ${metrics.country} (cascada de elegibilidad, ADR 0004)`, "");
  lines.push("| Métrica | Valor | Meta ADR 0004 |", "|---|---|---|");
  lines.push(`| Precisión | ${pct(a.precision)} (${a.tp}/${a.tp + a.fp}) | ≥ 95 % |`);
  lines.push(`| Recall | ${pct(a.recall)} (${a.tp}/${a.tp + a.fn}) | ≥ 80 % |`);
  lines.push("", "| | Predicho aplicable | Predicho no aplicable |", "|---|---|---|");
  lines.push(`| **Aplicable (etiqueta)** | TP ${a.tp} | FN ${a.fn} |`);
  lines.push(`| **No aplicable (etiqueta)** | FP ${a.fp} | TN ${a.tn} |`, "");
  lines.push(
    `Exactitud de la etiqueta de 6 clases: ${pct(metrics.labelAccuracy)} · exactitud de workModel: ${pct(metrics.workModelAccuracy)}`,
    `Resultados degradados: ${metrics.statusCounts.evidence_unverified} por evidencia no verificable · ${metrics.statusCounts.fallback_unclear} por salida inválida tras el reintento`,
    "",
  );

  lines.push("## Matriz de confusión (filas = etiqueta esperada, columnas = predicción)", "");
  lines.push(
    `| esperada \\ predicha | ${ELIGIBILITY_LABELS.map((l) => SHORT[l]).join(" | ")} | total |`,
  );
  lines.push(`|---|${ELIGIBILITY_LABELS.map(() => "---").join("|")}|---|`);
  for (const expected of ELIGIBILITY_LABELS) {
    const row = metrics.confusion[expected];
    const total = ELIGIBILITY_LABELS.reduce((sum, predicted) => sum + row[predicted], 0);
    lines.push(
      `| **${SHORT[expected]}** | ${ELIGIBILITY_LABELS.map((p) => row[p]).join(" | ")} | ${total} |`,
    );
  }
  lines.push("");

  lines.push("## Tokens por oferta (suma de todos los intentos)", "");
  lines.push("| | Promedio | Máximo | Total |", "|---|---|---|---|");
  lines.push(tokenRow("Entrada", metrics.inputTokens));
  lines.push(tokenRow("Salida visible (meta < 300)", metrics.outputTokens));
  lines.push(tokenRow("Thinking", metrics.thinkingTokens));
  lines.push(
    "",
    `## Costo equivalente (precio de lista; el gasto real en capa gratuita es USD 0)`,
    "",
    `- Total: ${usd(metrics.costUsd.total)} · por oferta: ${usd(metrics.costUsd.perOffer)}`,
    "",
  );

  if (!context.showCases) {
    lines.push("## Errores", "", "Conjunto de prueba: no se listan casos (ADR 0004).", "");
    return lines.join("\n");
  }

  const wrong = rows.filter(
    (row) =>
      row.expected.label !== row.predicted.label ||
      applicableFor(row.expected, metrics.country) !==
        applicableFor(row.predicted, metrics.country),
  );
  lines.push(`## Errores (${wrong.length} de ${metrics.n})`, "");
  if (wrong.length === 0) lines.push("Sin errores.", "");
  for (const row of wrong) {
    const exp = applicableFor(row.expected, metrics.country);
    const pred = applicableFor(row.predicted, metrics.country);
    const kind =
      exp === pred
        ? "etiqueta distinta, misma aplicabilidad"
        : pred
          ? "FALSO POSITIVO (aplicable por error)"
          : "FALSO NEGATIVO (aplicable perdido)";
    lines.push(
      `### ${row.id} — ${cell(row.title)}`,
      `- **Tipo:** ${kind}${row.status === "ok" ? "" : ` · estado: ${row.status}`}`,
      `- **Esperado:** ${describe(row.expected)}`,
      `- **Predicho:** ${describe(row.predicted)}`,
      `- **Evidencia del modelo:** ${row.predicted.evidence.map((quote) => `"${cell(quote)}"`).join(" · ")}`,
      `- **Evidencia de la etiqueta:** ${cell(row.expectedEvidence)}`,
      "",
    );
  }
  return lines.join("\n");
}
