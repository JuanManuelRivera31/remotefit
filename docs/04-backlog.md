# Backlog del MVP por sesiones

Cada sesión es **una tarea pequeña y cerrada** que cabe en una conversación de Claude Code. Al terminar cada una: pruebas en verde, commit, y marcar la casilla aquí (la skill `/cierre-de-sesion` lo hace por ti).

**Leyenda:** 🟢 se puede hacer en paralelo con otra sesión (en otro worktree) · 🔴 depende de la anterior · 👤 requiere trabajo tuyo, no solo de Claude.

> Con el plan Pro, **no más de 2 sesiones en paralelo**. Lo normal será ir en orden.

---

## Fase 0 — Preparación (sin código)

- [ ] **S0 · Entorno listo** 👤 — Seguir `docs/00-guia-inicio.md` hasta tener `claude` funcionando dentro de esta carpeta, el repositorio en GitHub y una base de datos PostgreSQL disponible.

## Fase 1 — Cimientos

- [x] **S1 · Esqueleto del monorepo** 🔴
  npm workspaces (`apps/api`, `apps/web`, `packages/core`), `tsconfig` base, ESLint + Prettier, Vitest, scripts raíz: `dev`, `build`, `lint`, `typecheck`, `test`, `ingest`, `eval`. Una prueba trivial por paquete.
  *Hecho cuando:* `npm run lint && npm run typecheck && npm test` pasan.
  *Prompt sugerido:* `Lee docs/02-arquitectura.md y haz la sesión S1 del backlog. Planea primero y espera mi aprobación.`

- [x] **S2 · Base de datos** 🔴
  Drizzle + esquema de `docs/03-modelo-de-datos.md`, migraciones, conexión con `DATABASE_URL`, script `db:migrate`.
  *Hecho cuando:* las migraciones corren contra tu base y hay una prueba de humo de conexión.

## Fase 2 — Ingesta

- [ ] **S3a · Conector Greenhouse** 🟢
- [ ] **S3b · Conector Lever** 🟢
- [ ] **S3c · Conector Ashby** 🟢
  Cada uno: descargar una respuesta real y guardarla en `packages/core/fixtures/<ats>/`, tipos de la respuesta, función `fetchJobs(boardToken)` y `toNormalizedJob()`, pruebas contra el fixture. Mapea `postedAt` y `requisitionId` cuando el ATS los exponga. Usa la skill `/nueva-fuente-ats <ats>`.
  *Paralelo posible:* tres worktrees (`claude -w greenhouse`, `claude -w lever`, `claude -w ashby`), pero en Pro conviene hacer uno y reutilizar el patrón para los otros dos.

- [ ] **S4 · Comando de ingesta + lista de empresas** 🔴 👤
  `npm run ingest`: recorre `data/companies.json`, llama al conector, hace upsert, asigna `sibling_group`, re-verifica la vigencia (ADR 0002), imprime un resumen. Las ofertas con 404 o ausentes de un board que respondió bien se marcan cerradas con `closed_at` y no se borran; un error del board no cierra nada y sale en el resumen; una oferta que reaparece se reabre. Pausa entre peticiones.
  👤 `data/companies.json` ya trae 15 empresas sembradas. Verifica las marcadas como pendientes y amplíala a 20–30 con el subagente `ats-researcher`, priorizando empresas con historial de contratar en LATAM: las fuentes pesan más que el filtro. **Verifica tú cada una** abriendo su página de empleo.
  *Hecho cuando:* las vacantes hermanas reales de Sezzle quedan agrupadas y no se unen vacantes distintas con el mismo título; con fixtures, una oferta ausente se cierra sin borrarse y un fallo del board no cierra ninguna.

## Fase 3 — La parte de IA (el corazón del proyecto)

- [ ] **S5 · Prefiltro por reglas** 🟢
  `packages/core/src/rules/`: lista de patrones con su efecto (`us_only`, `onsite_or_hybrid`, `positive_signal`) y función pura `applyRules(job)`. Las reglas solo descartan casos seguros; nunca marcan una oferta como aplicable. Si la ubicación y el cuerpo se contradicen, pasa al LLM.
  Pruebas con frases reales de los fixtures y con las **164 ubicaciones reales** de `data/seed-career-ops/scan-history.tsv` como tabla de pruebas. Como el seed está fuera de git, copia solo las cadenas de ubicación, sin duplicados, a `packages/core/fixtures/locations/`. El `status` de career-ops es una pista, no la verdad: dejó pasar errores.

- [ ] **S6 · Proveedor LLM + clasificador de elegibilidad** 🟢 👤
  Interfaz `LLMProvider` y contrato de la sección 5 de la arquitectura (ADR 0004 y 0005), `GeminiProvider`, `FakeLLMProvider`, `pricing.ts` para el costo equivalente, esquema Zod, `isApplicable`, `LATAM_COUNTRIES`, prompt `v1`, caché por `(content_hash, prompt_version, model)`, reintento si el JSON no valida. Salida con meta de menos de 300 tokens. Comando `npm run classify`, por ahora con un límite manual de ofertas por ejecución.
  👤 Crea la clave en Google AI Studio **sin cuenta de facturación vinculada** y anota los límites del modelo. Claude nunca la lee.
  Usa el subagente `llm-evaluator` para revisar el prompt.

- [ ] **S6b · Cola con control de ritmo** 🔴
  `packages/core/src/queue/` y tabla `llm_usage_daily`: respeta RPM, TPM y RPD de la capa gratuita leídos de `data/llm-limits.json`; reintentos con espera exponencial ante 429; pausa al agotar la cuota diaria y retoma en la siguiente ejecución; orden de nuevas a cambiadas; aviso al superar el 80 % del RPD. Pruebas con reloj y proveedor falsos, sin red.
  *Hecho cuando:* con un `FakeLLMProvider` que devuelve 429 y luego cuota agotada, `npm run classify` termina sin perder ofertas e informa cuántas quedan pendientes.

- [ ] **S7 · Conjunto de evaluación** 🔴 👤
  Depende de S3–S4 y S6b. Primer hito: **150 casos** en `packages/core/evals/eligibility/`, sembrados desde `data/seed-career-ops/`: los 15 reportes, los 5 `jds`, la tabla de casos difíciles de `docs/07-aprendizajes-career-ops.md` (sección 3) y ofertas de `scan-history.tsv`.
  - Ese archivo no trae el cuerpo de las ofertas. 397 de las 411 de Greenhouse, Lever y Ashby ya están rescatadas en `data/seed-career-ops/bodies/`, con `raw` sin normalizar; `rescue-report.tsv` da el estado de cada URL.
  - De los reportes se toma **solo** el texto verbatim de la oferta, nunca tu evaluación personal: lo que va al LLM es capa gratuita.
  - El texto de las ofertas queda fuera de git (ADR 0002); en git van los identificadores y las etiquetas.
  - 👤 **La etiqueta correcta la decides tú.** Claude prepara el formato y una herramienta para facilitar el etiquetado.
  - Reparto inicial de 50 en desarrollo y 100 en prueba. El conjunto de prueba se congela al tener ≥ 60 aplicables para Colombia; hasta entonces los informes salen como "provisionales" y se le suman ofertas de la ingesta.
  - **Estado (2026-10-31, decisión D2):** el conjunto inicial quedó en **160 casos** (50 en desarrollo, 110 en prueba; ninguna empresa con más de 10 candidatos) en `packages/core/evals/eligibility/cases.json`, con etiquetas `pending` hasta que 👤 las confirme. Con las sugerencias heurísticas hay ~54 posibles aplicables en prueba, por debajo de los 60 del ADR 0004. No se amplía el directorio ni se sube el límite por empresa.
  - [ ] **Tarea explícita, tras S4 (ingesta diaria):** agregar candidatos nuevos de la ingesta **solo al split de prueba** (nunca a desarrollo; las vacantes hermanas van juntas), hasta tener ≥ 60 aplicables para Colombia **según las etiquetas confirmadas de 👤**; entonces **congelar** el conjunto de prueba (ADR 0004). Mientras no esté congelado, todo informe se marca **"provisional"**.

  Runner `npm run eval -- --split dev|test`: precisión y recall de aplicables, matriz de confusión, ejemplos fallidos solo de desarrollo, tokens y costo equivalente por oferta. Incluye la línea base de solo reglas contra reglas + LLM. Usa la skill `/eval-clasificador` para iterar.
  *Meta:* precisión ≥ 95 % y recall ≥ 80 % (ADR 0004).

- [ ] **S7b · Comparar modelos gratuitos** 🔴 👤
  Correr el informe de evaluación con cada modelo gratuito de Gemini (Flash y Flash-Lite disponibles) y la misma versión de prompt. Tabla comparativa de precisión, recall, tokens, costo equivalente y límites. La corrida pasa por la cola y puede tomar varios días de cuota.
  👤 Elige el modelo por defecto con esa tabla y documenta la elección en `docs/progreso.md`. Si el informe es provisional, la elección también lo es y se repite al congelar el conjunto. Si ninguno cumple la métrica, aplica lo definido en el ADR 0005.

- [ ] **S8 · Perfil + puntaje de encaje** 🔴
  Tablas `profiles` y `fit_results`, carga desde `data/profile.json` (gitignored; plantilla en `data/profile.example.json`, a la que se agrega `country`), función pura de encaje con **reglas deterministas y sin LLM** (ADR 0005), `SCORING_VERSION`, desglose de qué sube o baja el puntaje, comando `npm run score`. Solo para ofertas aplicables y accesibles para el nivel del perfil.

## Fase 4 — Producto usable

- [ ] **S9 · API REST** 🟢
  `GET /api/jobs` (filtros: país, nivel, antigüedad máxima, puntaje mínimo, empresa, texto), `GET /api/jobs/:id` (con evidencia y vacantes hermanas), `GET/PUT /api/profile`. El filtro por país usa `isApplicable`. Validación con Zod. Pruebas con supertest. **Sin tracker:** no hay rutas de postulaciones.
  Define primero el contrato de tipos en `packages/core` para poder hacer S10 en paralelo.

- [ ] **S10 · Panel web** 🟢
  Lista ordenada por encaje, filtros "aplicable desde mi país", "accesible para mi nivel" y antigüedad, indicador de vacantes de más de 180 días, una sola tarjeta por grupo de hermanas con su lista de países, detalle con la evidencia resaltada y el desglose del encaje, página de perfil. **Sin tracker:** no hay estados de postulación.

- [ ] **S11 · Uso real + pulido** 👤
  Correr la ingesta a diario durante 2 semanas, anotar errores en `docs/notas-de-uso.md`, corregir los más graves. Cada semana, revisar las empresas candidatas que proponga el scan y aprobar las que entren a `data/companies.json` (ADR 0002). Sumar al conjunto de prueba hasta llegar a 60 aplicables. README de portafolio con capturas, diagrama y resultados del eval.

## Después del MVP (no empezar hasta cerrar S11)

- Validación: boletín semanal de ofertas verificadas, con meta de ≥ 100 suscriptores en 8 semanas (ADR 0005). Antes, revisar términos de los ATS y definir cómo se tratan los correos.
- v0.2: Get on Board como cuarta fuente, tras revisar sus términos · embeddings con pgvector, sin enviar el perfil a capas gratuitas · ingesta programada · CV y carta adaptados, con su propio ADR porque usan datos personales.
- v0.3: simulacro de entrevista en inglés por voz.
- v0.4: multiusuario, autenticación, despliegue, prueba con compañeros.
- Sin fecha: clasificador destilado entrenado en Google Colab para resolver casos fáciles sin LLM (ADR 0005).
