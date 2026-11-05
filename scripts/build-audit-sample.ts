// Builds the blind audit sample of the current test set (cases.json testSet.name) for the owner: 15 random labelled
// cases with location, label and quote, WITHOUT the classifier's result. Deterministic (seed). Public text is limited to
// title, location and the short quote.
// Usage: npx tsx scripts/build-audit-sample.ts [seed=20261104] [count=15]
import { readFileSync, writeFileSync } from "node:fs";
import { loadJob } from "../packages/core/evals/loader.js";
import type { EvalCase } from "../packages/core/evals/loader.js";

type Row = EvalCase & { labelStatus: string; evidence?: string | null; url?: string; travelRequirement?: string };
const seed = Number(process.argv[2] ?? 20261104);
const count = Number(process.argv[3] ?? 15);
const all = JSON.parse(readFileSync("packages/core/evals/eligibility/cases.json", "utf8")) as {
  cases: Row[];
  testSet: { name: string };
};
const setName = all.testSet.name;
const pool = all.cases.filter((c) => c.split === "test" && c.labelStatus !== "pending");

// mulberry32: small seeded PRNG, so the same seed gives the same sample.
let state = seed >>> 0;
const rand = (): number => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = [...pool];
for (let i = shuffled.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j] as Row, shuffled[i] as Row];
}
const sample = shuffled.slice(0, count);

const cell = (t: string): string => t.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const lines = [
  `# Auditoría ciega de ${setName}`,
  "",
  `Muestra de ${count} casos de ${setName} elegidos al azar (semilla ${seed}, de ${pool.length} casos etiquetados). **No incluye el resultado de ningún modelo**: solo lo que dice la etiqueta, para que la revises sin sesgo. Las etiquetas son asistidas por LLM: las puso Claude leyendo el cuerpo completo, con la guía del ADR 0004 y la cita literal verificada por código. La revisión no bloquea nada. Si no estás de acuerdo con una etiqueta, dímelo por id y la corrijo dejando registro del cambio. El ADR 0004 prohíbe usar los fallos de ${setName} para ajustar el clasificador, pero una etiqueta mal puesta sí se corrige; si alguna cambia, la métrica de la aceptación se recalcula desde la caché (0 llamadas) y la cifra corregida se anota en el ADR.`,
  "",
  "Para cada caso: abre el enlace, lee la oferta y responde si estás de acuerdo con la etiqueta, los países y el modelo de trabajo. Recuerda las reglas: **aplicable para Colombia** = remoto y (`latam_eligible`, `worldwide` o `country_specific` que incluya CO); la regla 5 (ante duda gana la etiqueta no aplicable) y la regla 6 (viajes periódicos = remoto; híbrido = presencia regular semanal).",
  "",
  "| # | Empresa | Título | Ubicación (ATS) | Etiqueta | Países | Modelo de trabajo | Cita de la etiqueta | Viaje | Enlace |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
sample.forEach((c, i) => {
  const job = loadJob(c);
  lines.push(
    `| ${i + 1} | ${c.board} | ${cell(job.title)} | ${cell(job.locationRaw)} | \`${c.label}\` | ${(c.countries ?? []).join(", ") || "—"} | ${c.workModel} | ${cell(c.evidence ?? "")} | ${cell(c.travelRequirement ?? "—")} | [oferta](${c.url ?? ""}) |`,
  );
});
lines.push("", "ids (para responder): " + sample.map((c) => `\`${c.id}\``).join(", "), "");
const out = `docs/auditoria-${setName}.md`;
writeFileSync(out, lines.join("\n"));
console.log(`wrote ${out} with ${sample.length} cases`);
