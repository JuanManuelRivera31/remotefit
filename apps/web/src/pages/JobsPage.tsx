import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { fetchJobs } from "../api.js";
import { FilterBar } from "../components/FilterBar.js";
import { JobCard } from "../components/JobCard.js";
import {
  countryName,
  filtersFromParams,
  isMeasured,
  paramsFromFilters,
  type Filters,
} from "../filters.js";

export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const setFilters = (next: Filters) => setParams(paramsFromFilters(next));

  const jobs = useQuery({
    queryKey: ["jobs", filters],
    queryFn: () => fetchJobs(filters),
    placeholderData: keepPreviousData,
  });
  const data = jobs.data;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // Keep the filters on the detail link so "volver" returns to the same list.
  const detailHref = (id: number) => {
    const query = paramsFromFilters(filters).toString();
    return `/ofertas/${id}${query ? `?${query}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        companies={data?.companies ?? []}
        unconfirmedCount={data?.counts.unconfirmed}
        onChange={setFilters}
      />

      {!isMeasured(filters.country) && (
        <p
          role="note"
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Sin medir: la precisión del clasificador solo está medida para Colombia. Para{" "}
          {countryName(filters.country)} los resultados pueden tener más errores; revisa la cita de
          cada oferta.
        </p>
      )}

      {jobs.isPending ? (
        <p className="text-sm text-slate-600">Cargando ofertas…</p>
      ) : jobs.isError ? (
        <p role="alert" className="text-sm text-red-700">
          No se pudieron cargar las ofertas. ¿Está corriendo la API? ({jobs.error.message})
        </p>
      ) : data && data.items.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-700">
          No hay ofertas con estos filtros.
          {!filters.showUnconfirmed && data.counts.unconfirmed > 0
            ? ` Hay ${data.counts.unconfirmed} sin confirmar: actívalas en "Ver sin confirmar".`
            : ""}
        </p>
      ) : data ? (
        <>
          <p className="text-sm text-slate-700">
            {data.total} {data.total === 1 ? "vacante" : "vacantes"} para{" "}
            {countryName(filters.country)}
            {filters.showUnconfirmed ? " (incluye sin confirmar)" : ""}
          </p>
          <ul className="space-y-3">
            {data.items.map((job) => (
              <li key={job.id}>
                <JobCard job={job} detailHref={detailHref(job.id)} />
              </li>
            ))}
          </ul>
          {lastPage > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Páginas">
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
                disabled={filters.page <= 1}
                onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              >
                Anterior
              </button>
              <span>
                Página {filters.page} de {lastPage}
              </span>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
                disabled={filters.page >= lastPage}
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              >
                Siguiente
              </button>
            </nav>
          )}
        </>
      ) : null}
    </div>
  );
}
