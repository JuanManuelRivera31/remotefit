import { STALE_DATA_AFTER_DAYS, dataAgeDays, type ApiStatus } from "@remotefit/core/api";
import { Link } from "react-router";
import { dateText } from "../format.js";
import { REMOVAL_ISSUE_URL } from "../site.js";

/** Warns when the published data is old: the daily job may have stopped (GitHub disables idle cron jobs). */
export function StaleDataNotice({ status, now }: { status: ApiStatus | undefined; now: Date }) {
  if (!status?.dataGeneratedAt) return null;
  const days = dataAgeDays(status.dataGeneratedAt, now);
  if (days <= STALE_DATA_AFTER_DAYS) return null;
  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <strong>Datos desactualizados:</strong> la última actualización fue hace {days} días. Algunas
      ofertas pueden haber cerrado; verifica en la oferta original.
    </div>
  );
}

export function SiteFooter({ status }: { status: ApiStatus | undefined }) {
  return (
    <footer className="mx-auto max-w-3xl px-4 pb-8 text-xs text-slate-600">
      <p>
        {status?.dataGeneratedAt
          ? `Datos actualizados el ${dateText(status.dataGeneratedAt)}. `
          : ""}
        Verifica siempre en la oferta original antes de postular.
      </p>
      <p className="mt-1 flex flex-wrap gap-x-3">
        <Link to="/metodo" className="text-sky-700 hover:underline">
          Método
        </Link>
        <a
          href={REMOVAL_ISSUE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-700 hover:underline"
        >
          Pedir que se retire una oferta
        </a>
      </p>
    </footer>
  );
}
