import type { ApiStatus } from "@remotefit/core/api";

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1).replace(".", ",")} %`;

/**
 * Warns while the classifier in use has no accepted measurement. It disappears by itself when the API reports an
 * accepted version (CLASSIFIER_DECISIONS in packages/core), with no UI change.
 */
export function StatusBanner({ status }: { status: ApiStatus | undefined }) {
  if (!status) return null;
  const { acceptance } = status;
  if (acceptance.state === "not_accepted") {
    return (
      <div
        role="alert"
        className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <strong>Versión del clasificador no aceptada.</strong> Todavía no cumple la meta de
        precisión en la evaluación. Revisa la cita y la oferta original antes de postular.
      </div>
    );
  }
  if (acceptance.state === "accepted_with_gap") {
    return (
      <div
        role="status"
        className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700"
      >
        Precisión medida en Colombia: {pct(acceptance.precision)} (meta 95 %). Revisa la cita antes
        de postular.
      </div>
    );
  }
  return null;
}
