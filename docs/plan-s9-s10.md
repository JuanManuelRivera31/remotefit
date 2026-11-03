# Plan S9 + S10: resultados con evidencia citada y filtros (propuesta, 2026-11-03)

Estado: **pendiente de tu aprobación**. No se escribió código de S9/S10. Puede avanzar en paralelo con la evaluación de test-v3.

## Alcance

Una vista de resultados para el usuario 1 (Colombia): lista de ofertas **aplicables desde su país**, cada una con la **cita textual** que la justifica, y filtros por **país, nivel y antigüedad**. Basado en `docs/04-backlog.md` (S9 API, S10 panel) con estos cambios:

- **Sin puntaje de encaje (S8 queda para después).** El orden es por antigüedad (más nueva primero). Cuando exista S8, el puntaje entra como una columna y un orden más, sin rehacer nada.
- **Sin `GET/PUT /api/profile`** por ahora: el país viene en la consulta (`country=CO`, por defecto CO).
- **Sin tracker**, como en el backlog.

## S9 · API (primero el contrato, luego las rutas)

1. **Contrato en `packages/core/src/api/contract.ts`** (Zod, compartido por API y web):
   - `JobsQuery`: `country` (ISO, defecto `CO`), `seniority[]`, `maxAgeDays`, `company`, `q`, `onlyApplicable` (defecto `true`), `limit`/`cursor`.
   - `JobSummary`: `id`, `title`, `company`, `location`, `label`, `workModel`, `countries`, `seniority`, `ageDays`, `stale` (más de 180 días), `evidence[]` (≤ 2 citas de ≤ 160 caracteres), `siblingCount` y `siblingCountries` (una sola tarjeta por grupo de vacantes hermanas), `url` al original.
   - `JobDetail`: lo anterior + `excerpt` (fragmento de ~400 caracteres alrededor de la cita, con la cita marcada), hermanas y la procedencia del resultado (`promptVersion`, `model`, `postprocessVersion`, `status`).
   - `ApiStatus`: versión del clasificador en uso, si está **aceptada** (hoy no), cuántas ofertas faltan por clasificar.
2. **Consulta** (`apps/api/src/jobs/`): une `jobs` con `eligibility_results` por `content_hash` y la versión vigente (prompt, modelo, postprocess); SQL descarta lo claramente no aplicable (`work_model <> 'remote'`, etiquetas `us_only`/`onsite_or_hybrid`/`unclear`) y **`isApplicable(result, country)` en código decide**, la misma función del eval. Agrupa por `sibling_group`; ofertas cerradas (`is_active = false`) ocultas; antigüedad = hoy − (`posted_at` o `first_seen_at`).
3. **Rutas:** `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/status`. Validación con Zod, errores en un formato único.
4. **Pruebas:** funciones puras (agrupar, antigüedad, extracto) con Vitest; rutas con supertest contra la base `remotefit_test`, con datos sembrados (aplicable, híbrida, otro país, hermanas, cerrada, resultado de otra versión).

## S10 · Panel web

1. **Base:** Tailwind + TanStack Query (CLAUDE.md) y `react-router`; tipos y esquemas del contrato de `packages/core`. Sin librería de componentes.
2. **Lista:** barra de filtros (país, nivel, antigüedad máxima, empresa, texto) que viven en la URL; tarjeta con título, empresa, etiqueta con países, nivel, antigüedad (insignia si pasa de 180 días) y **la cita de la evidencia**, nunca solo el veredicto. Estados vacío, cargando y error.
3. **Detalle:** la evidencia **resaltada dentro de su contexto** (extracto, no la oferta completa: ADR 0002), vacantes hermanas con sus países, procedencia del resultado y enlace al original.
4. **Aviso permanente "versión no aceptada":** mientras `ApiStatus.accepted` sea falso, una franja visible dice que el clasificador no cumplió la precisión (90,7 % en test-v2) y que cada resultado debe verificarse con su cita. Es la forma práctica del compromiso del ADR 0005 (evidencia visible al usuario).
5. **Pruebas:** Vitest + Testing Library (filtros a parámetros de URL, resaltado de la cita, aviso, estados), más una pasada manual con la base real.

## Orden de trabajo (sesiones pequeñas)

| Paso | Contenido | Depende de |
|---|---|---|
| S9a | Contrato + funciones puras + pruebas | nada |
| S9b | Rutas + consulta + pruebas supertest | S9a |
| S10a | Tailwind, Query, router, cliente tipado, franja de estado | S9a (solo el contrato) |
| S10b | Lista y filtros | S9b |
| S10c | Detalle con cita resaltada | S9b |

S10a puede empezar en cuanto exista el contrato y avanzar contra datos simulados.

## Decisiones tuyas (recomendación primero)

1. **Orden de sesiones.** *Recomendado:* S9/S10 antes de S8 (el orden es por antigüedad y el puntaje entra después). Alternativa: hacer S8 primero.
2. **Resultados de una versión no aceptada.** *Recomendado:* mostrarlos en local con la franja de aviso y sin desplegar nada; la regla de "no publicar" se cumple porque no hay despliegue. Alternativa: ocultarlos detrás de una bandera hasta tener una versión aceptada.
3. **Filtro de nivel.** *Recomendado:* usar el `seniority` que extrae el clasificador, mostrado como "nivel estimado", con un cubo "sin dato"; no está evaluado y no se promete precisión sobre él. Alternativa: reglas de código sobre el título (más lento, más predecible).

## Fuera de alcance de este plan

Despliegue, autenticación, perfil y puntaje (S8), boletín, y cualquier publicación del texto completo de las ofertas.
