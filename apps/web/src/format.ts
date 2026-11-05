// Spanish wording for the values the API returns.
import type { JobSummary, SeniorityFilter } from "@remotefit/core/api";

export const SENIORITY_NAMES: Record<SeniorityFilter, string> = {
  intern: "Practicante",
  junior: "Junior",
  mid: "Semi-senior",
  senior: "Senior",
  lead_or_above: "Líder o superior",
  unknown: "Sin dato",
};

/** Who can apply, in words (only labels that can reach the list). */
export function eligibilityText(job: Pick<JobSummary, "label" | "countries">): string {
  switch (job.label) {
    case "latam_eligible":
      return "Remoto desde Latinoamérica";
    case "worldwide":
      return "Remoto desde cualquier país";
    case "country_specific":
      return `Remoto desde: ${job.countries.join(", ")}`;
    default:
      return "Elegibilidad sin confirmar";
  }
}

export function ageText(days: number): string {
  if (days === 0) return "publicada hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

/** "4 de nov de 2026" in Bogotá time. */
export function dateText(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
}

export const AGE_OPTIONS: readonly { days: number; label: string }[] = [
  { days: 7, label: "Última semana" },
  { days: 30, label: "Último mes" },
  { days: 90, label: "Últimos 3 meses" },
  { days: 180, label: "Últimos 6 meses" },
];
