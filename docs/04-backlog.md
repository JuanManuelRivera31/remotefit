# Backlog del MVP por sesiones

Cada sesión es **una tarea pequeña y cerrada** que cabe en una conversación de Claude Code. Al terminar cada una: pruebas en verde, commit, y marcar la casilla aquí (la skill `/cierre-de-sesion` lo hace por ti).

**Leyenda:** 🟢 se puede hacer en paralelo con otra sesión (en otro worktree) · 🔴 depende de la anterior · 👤 requiere trabajo tuyo, no solo de Claude.

> Con el plan Pro, **no más de 2 sesiones en paralelo**. Lo normal será ir en orden.

---

## Fase 0 — Preparación (sin código)

- [ ] **S0 · Entorno listo** 👤 — Seguir `docs/00-guia-inicio.md` hasta tener `claude` funcionando dentro de esta carpeta, el repositorio en GitHub y una base de datos PostgreSQL disponible.

## Fase 1 — Cimientos

- [ ] **S1 · Esqueleto del monorepo** 🔴
  npm workspaces (`apps/api`, `apps/web`, `packages/core`), `tsconfig` base, ESLint + Prettier, Vitest, scripts raíz: `dev`, `build`, `lint`, `typecheck`, `test`, `ingest`, `eval`. Una prueba trivial por paquete.
  *Hecho cuando:* `npm run lint && npm run typecheck && npm test` pasan.
  *Prompt sugerido:* `Lee docs/02-arquitectura.md y haz la sesión S1 del backlog. Planea primero y espera mi aprobación.`

- [ ] **S2 · Base de datos** 🔴
  Drizzle + esquema de `docs/03-modelo-de-datos.md`, migraciones, conexión con `DATABASE_URL`, script `db:migrate`.
  *Hecho cuando:* las migraciones corren contra tu base y hay una prueba de humo de conexión.

## Fase 2 — Ingesta

- [ ] **S3a · Conector Greenhouse** 🟢
- [ ] **S3b · Conector Lever** 🟢
- [ ] **S3c · Conector Ashby** 🟢
  Cada uno: descargar una respuesta real y guardarla en `packages/core/fixtures/<ats>/`, tipos de la respuesta, función `fetchJobs(boardToken)` y `toNormalizedJob()`, pruebas contra el fixture. Usa la skill `/nueva-fuente-ats <ats>`.
  *Paralelo posible:* tres worktrees (`claude -w greenhouse`, `claude -w lever`, `claude -w ashby`), pero en Pro conviene hacer uno y reutilizar el patrón para los otros dos.

- [ ] **S4 · Comando de ingesta + lista de empresas** 🔴 👤
  `npm run ingest`: recorre `data/companies.json`, llama al conector, hace upsert, marca inactivas, imprime un resumen. Pausa entre peticiones.
  👤 Con el subagente `ats-researcher`, arma una lista inicial de 20–30 empresas que contraten remoto en las Américas o en todo el mundo y usen estos ATS. **Verifica tú cada una** abriendo su página de empleo.

## Fase 3 — La parte de IA (el corazón del proyecto)

- [ ] **S5 · Prefiltro por reglas** 🟢
  `packages/core/src/rules/`: lista de patrones con su efecto (`not_eligible`, `positive_signal`), función pura `applyRules(job)`, pruebas con frases reales sacadas de los fixtures.

- [ ] **S6 · Proveedor LLM + clasificador de elegibilidad** 🟢
  Interfaz `LLMProvider` (ADR 0003), implementación Anthropic, `pricing.ts`, esquema Zod (sección 5 de la arquitectura), prompt `v1`, caché por `(content_hash, prompt_version)`, reintento si el JSON no valida. Comando `npm run classify`.
  Usa el subagente `llm-evaluator` para revisar el prompt.

- [ ] **S7 · Conjunto de evaluación** 🟢 👤
  👤 Etiquetar a mano 40+ ofertas reales (al menos 10 de cada estado) en `packages/core/evals/eligibility/cases.jsonl`. Claude prepara el formato y una herramienta para facilitar el etiquetado, pero **la etiqueta correcta la decides tú**.
  Runner `npm run eval`: exactitud, matriz de confusión, ejemplos fallidos, costo total. Usa la skill `/eval-clasificador` para iterar.
  *Meta:* ≥ 85 % en elegible vs. no elegible.

- [ ] **S8 · Perfil + puntaje de encaje** 🔴
  Tabla `profiles`, carga desde `data/profile.json` (gitignored; plantilla en `data/profile.example.json`), esquema Zod del encaje, prompt `v1`, comando `npm run score`.

## Fase 4 — Producto usable

- [ ] **S9 · API REST** 🟢
  `GET /api/jobs` (filtros: estado, puntaje mínimo, empresa, texto), `GET /api/jobs/:id` (con evidencia), `PUT /api/applications/:jobId`, `GET/PUT /api/profile`. Validación con Zod. Pruebas con supertest.
  Define primero el contrato de tipos en `packages/core` para poder hacer S10 en paralelo.

- [ ] **S10 · Panel web** 🟢
  Lista ordenada por encaje, filtros, detalle con la evidencia resaltada, cambio de estado de la aplicación, página de perfil.

- [ ] **S11 · Uso real + pulido** 👤
  Correr la ingesta a diario durante 2 semanas, anotar errores en `docs/notas-de-uso.md`, corregir los más graves. README de portafolio con capturas, diagrama y resultados del eval.

## Después del MVP (no empezar hasta cerrar S11)

- v0.2: CV y carta adaptados por oferta · embeddings con pgvector · ingesta programada.
- v0.3: simulacro de entrevista en inglés por voz.
- v0.4: multiusuario, autenticación, despliegue, prueba con compañeros, pagos si se valida.
