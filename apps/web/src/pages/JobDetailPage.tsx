import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiRequestError, fetchJob } from "../api.js";
import { Excerpt } from "../components/Excerpt.js";
import { GroupCountries } from "../components/JobCard.js";
import { SENIORITY_NAMES, ageText, dateText, eligibilityText } from "../format.js";
import { countryName, filtersFromParams, paramsFromFilters } from "../filters.js";

export function JobDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const filters = filtersFromParams(params);
  const jobId = Number(id);
  const back = `/${paramsFromFilters(filters).toString() ? `?${paramsFromFilters(filters).toString()}` : ""}`;

  const job = useQuery({
    queryKey: ["job", jobId, filters.country],
    queryFn: () => fetchJob(jobId, filters.country),
    enabled: Number.isInteger(jobId) && jobId > 0,
  });

  return (
    <div className="space-y-4">
      <Link to={back} className="text-sm text-sky-700 hover:underline">
        ← Volver a la lista
      </Link>

      {job.isPending ? (
        <p className="text-sm text-slate-600">Cargando…</p>
      ) : job.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {job.error instanceof ApiRequestError && job.error.status === 404
            ? `Esta oferta no existe, ya cerró o no aplica desde ${countryName(filters.country)}.`
            : `No se pudo cargar la oferta (${job.error.message}).`}
        </p>
      ) : (
        <article className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <header>
            <div className="flex flex-wrap gap-2 text-xs">
              {job.data.verdict === "unconfirmed" ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                  Sin confirmar
                </span>
              ) : (
                <span className="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900">
                  {eligibilityText(job.data)}
                </span>
              )}
              {job.data.stale && (
                <span className="rounded bg-slate-200 px-2 py-0.5">Más de 180 días</span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">{job.data.title}</h1>
            <p className="text-sm text-slate-700">
              {job.data.company}
              {job.data.location ? ` · ${job.data.location}` : ""} · {ageText(job.data.ageDays)}
            </p>
            <p className="text-xs text-slate-600">
              Nivel estimado:{" "}
              {job.data.seniority ? SENIORITY_NAMES[job.data.seniority] : "sin dato"}
            </p>
          </header>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">Por qué aparece: la evidencia</h2>
            {job.data.excerpt ? (
              <Excerpt excerpt={job.data.excerpt} />
            ) : job.data.evidence.length > 0 ? (
              <blockquote className="border-l-4 border-sky-300 bg-sky-50 px-3 py-2 text-sm">
                {job.data.evidence.map((quote) => (
                  <p key={quote}>“{quote}”</p>
                ))}
                <p className="mt-1 text-xs text-slate-600">
                  (Cita del título o de la ubicación de la oferta.)
                </p>
              </blockquote>
            ) : (
              <p className="text-sm text-slate-600">Sin cita: revisa la oferta original.</p>
            )}
          </section>

          {job.data.siblings.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-900">
                La misma vacante en otras ubicaciones ({job.data.siblings.length})
              </h2>
              <GroupCountries job={job.data} country={filters.country} />
              <details className="mt-1 text-sm">
                <summary className="cursor-pointer text-sky-700">Ver cada publicación</summary>
                <ul className="mt-1 list-disc pl-5">
                  {job.data.siblings.map((s) => (
                    <li key={s.id}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-700 hover:underline"
                      >
                        {s.location ?? "Sin ubicación"} ↗
                      </a>
                      {!s.visible && (
                        <span className="text-xs text-slate-500">
                          {" "}
                          · no aplica desde {countryName(filters.country)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          <a
            href={job.data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
          >
            Ver oferta original ↗
          </a>

          <footer className="border-t border-slate-100 pt-3 text-xs text-slate-600">
            Vista activa en el portal el {dateText(job.data.lastVerifiedAt)} · clasificada
            {job.data.provenance.classifiedAt
              ? ` el ${dateText(job.data.provenance.classifiedAt)}`
              : ""}{" "}
            con {job.data.provenance.model} + {job.data.provenance.promptVersion} +{" "}
            {job.data.provenance.postprocessVersion ?? "sin postproceso"}
          </footer>
        </article>
      )}
    </div>
  );
}
