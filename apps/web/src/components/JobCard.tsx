import type { JobSummary } from "@remotefit/core/api";
import { Link } from "react-router";
import { countryName } from "../filters.js";
import { SENIORITY_NAMES, ageText, dateText, eligibilityText } from "../format.js";

/** The countries of the whole vacancy; the user's country is highlighted when the vacancy applies from it. */
export function GroupCountries({ job, country }: { job: JobSummary; country: string }) {
  if (job.groupCountries.length === 0) return null;
  const highlight = job.verdict === "applicable";
  const names = [...job.groupCountries].sort((a, b) =>
    countryName(a).localeCompare(countryName(b), "es"),
  );
  return (
    <p className="mt-2 text-xs text-slate-600">
      <span className="sr-only">Países de la vacante: </span>
      <span aria-hidden="true">Países: </span>
      {names.map((code, index) => (
        <span key={code}>
          {index > 0 && " · "}
          {highlight && code === country ? (
            <strong className="rounded bg-emerald-100 px-1 font-semibold text-emerald-900">
              {countryName(code)}
            </strong>
          ) : (
            countryName(code)
          )}
        </span>
      ))}
    </p>
  );
}

/** One card per vacancy: verdict, the quote that justifies it, the original link and when it was last verified. */
export function JobCard({
  job,
  detailHref,
  country,
}: {
  job: JobSummary;
  detailHref: string;
  country: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {job.verdict === "unconfirmed" ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
            Sin confirmar
          </span>
        ) : (
          <span className="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900">
            {eligibilityText(job)}
          </span>
        )}
        <span className="text-slate-600">{ageText(job.ageDays)}</span>
        {job.stale && (
          <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-800">Más de 180 días</span>
        )}
      </div>

      <h2 className="mt-2 text-base font-semibold leading-snug text-slate-900">
        <Link to={detailHref} className="hover:underline">
          {job.title}
        </Link>
      </h2>
      <p className="text-sm text-slate-700">
        {job.company}
        {job.location ? ` · ${job.location}` : ""}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Nivel estimado: {job.seniority ? SENIORITY_NAMES[job.seniority] : "sin dato"}
        {job.siblingCount > 0 && ` · ${job.siblingCount + 1} publicaciones de la misma vacante`}
      </p>
      <GroupCountries job={job} country={country} />

      {job.evidence.length > 0 ? (
        <blockquote className="mt-3 border-l-4 border-sky-300 bg-sky-50 px-3 py-2 text-sm text-slate-800">
          {job.evidence.map((quote) => (
            <p key={quote}>“{quote}”</p>
          ))}
        </blockquote>
      ) : (
        <p className="mt-3 text-sm text-slate-600">Sin cita: revisa la oferta original.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>Vista activa el {dateText(job.lastVerifiedAt)}</span>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-sky-700 hover:underline"
        >
          Ver oferta original ↗
        </a>
      </div>
    </article>
  );
}
