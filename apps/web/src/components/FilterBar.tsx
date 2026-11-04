import { COUNTRY_OPTIONS, SENIORITY_FILTERS, type SeniorityFilter } from "@remotefit/core/api";
import { useEffect, useState } from "react";
import { AGE_OPTIONS, SENIORITY_NAMES } from "../format.js";
import { isMeasured, type Filters } from "../filters.js";

interface Props {
  filters: Filters;
  companies: readonly string[];
  unconfirmedCount: number | undefined;
  onChange: (next: Filters) => void;
}

const field = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

/** Every change resets to page 1 and is written to the URL by the page (shareable, no stored personal data). */
export function FilterBar({ filters, companies, unconfirmedCount, onChange }: Props) {
  const update = (patch: Partial<Filters>) => onChange({ ...filters, ...patch, page: 1 });
  // The text box applies on submit, not on every keystroke.
  const [text, setText] = useState(filters.q);
  useEffect(() => setText(filters.q), [filters.q]);

  const toggleLevel = (level: SeniorityFilter) =>
    update({
      seniority: filters.seniority.includes(level)
        ? filters.seniority.filter((l) => l !== level)
        : [...filters.seniority, level],
    });

  return (
    <form
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        update({ q: text.trim() });
      }}
    >
      <label className="text-sm text-slate-700">
        País desde donde postulas
        <select
          className={field}
          value={filters.country}
          onChange={(e) => update({ country: e.target.value })}
        >
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
              {isMeasured(c.code) ? "" : " (sin medir)"}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm text-slate-700">
        Antigüedad
        <select
          className={field}
          value={filters.maxAgeDays ?? ""}
          onChange={(e) => update({ maxAgeDays: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Cualquiera</option>
          {AGE_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm text-slate-700">
        Empresa
        <select
          className={field}
          value={filters.company}
          onChange={(e) => update({ company: e.target.value })}
        >
          <option value="">Todas</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm text-slate-700">
        Buscar en título o empresa
        <div className="flex gap-2">
          <input
            className={field}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="p. ej. backend, react"
          />
          <button type="submit" className="rounded bg-slate-800 px-3 text-sm text-white">
            Buscar
          </button>
        </div>
      </label>

      <fieldset className="text-sm text-slate-700 sm:col-span-2">
        <legend>Nivel estimado (no evaluado)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {SENIORITY_FILTERS.map((level) => (
            <label key={level} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={filters.seniority.includes(level)}
                onChange={() => toggleLevel(level)}
              />
              {SENIORITY_NAMES[level]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="inline-flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
        <input
          type="checkbox"
          checked={filters.showUnconfirmed}
          onChange={(e) => update({ showUnconfirmed: e.target.checked })}
        />
        Ver sin confirmar{unconfirmedCount !== undefined ? ` (${unconfirmedCount})` : ""}: ofertas
        que el clasificador no pudo confirmar
      </label>
    </form>
  );
}
