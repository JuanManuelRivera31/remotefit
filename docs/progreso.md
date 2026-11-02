# Bitácora del proyecto

La entrada más reciente va arriba. La skill `/cierre-de-sesion` la actualiza al final de cada sesión.

## 2026-11-01 · Revisión del dueño de los 9 casos dudosos (S7 sigue abierta)
- Hecho: Juan Manuel revisó los 9 casos. Aceptó 1, 2, 3, 4, 5, 8 y 9 tal cual. En el 8 (Clara Security Engineer) se registra `workModelConflict = true` por la etapa presencial inicial. En 6 y 7 (Clara Fullstack) se mantiene `workModel = remote` porque el cuerpo lo dice explícitamente ("This is a remote-first role: you'll work from home day to day"). Los 9 quedan con `labelStatus = "owner_reviewed"`. Se acepta usar los metadatos del ATS cuando el cuerpo no diga la modalidad.
- Métricas: con la regla completa del ADR 0004 (`isApplicable`: `workModel = remote` y etiqueta válida para CO) quedan **30 aplicables en desarrollo y 59 en prueba**, igual que con el conteo anterior porque ningún caso con etiqueta válida tenía `workModel` distinto de `remote`. La prueba sigue bajo 60: informes "provisionales".
- Siguiente paso: 1 aplicable más en prueba para congelarla; después, el ejecutor de `npm run eval` (S7).

## 2026-11-01 · Etiquetas asistidas por LLM para los 160 casos (S7 sigue abierta)
- Hecho: `scripts/apply-eval-labels.mjs` importa a `packages/core/evals/eligibility/cases.json` las etiquetas de Claude (`labelSource = "llm-assisted"`, `labeledAt = 2026-11-01`, con `countries`, `workModel` y `evidence`). Las 71 filas con `verificar_cuerpo = si` se contrastaron con el cuerpo completo (solo local, ADR 0002); las 89 restantes no se tocaron. 64 de las 71 cambiaron algo (casi todo `workModel`: de `unknown` a `remote`/`hybrid`/`onsite`) y 11 cambiaron de etiqueta o países.
- Etiquetas asistidas por LLM (Claude) con reglas aprobadas por Juan Manuel. La verificación humana se limitó a 9 casos, ya revisados (ver entrada siguiente). Queda anotado en el ADR 0004 (sección 6).
- Métricas: aplicables para Colombia con estas etiquetas: **30 en desarrollo y 59 en prueba**. La prueba queda por debajo de 60, así que los informes siguen **"provisionales"** (D2).
- Decisión técnica: cuando el cuerpo no dice la modalidad, `workModel` toma los metadatos del ATS (`workplaceType` de Ashby y Lever), como indica el ADR 0004; si tampoco hay metadatos, queda `unknown`.
- Pendiente / problemas: faltan 1 o más aplicables en prueba para congelarla; revisar los 9 casos `needs_review`.
- Siguiente paso: revisión humana de esos 9 casos y luego el ejecutor de `npm run eval` (S7).

## 2026-10-31 · S2 casi lista, falta correr contra la base (rama `feat/s2-database`, sin unir a main)
- Hecho: Drizzle ORM + `pg` en `apps/api`; esquema de las 6 tablas de `docs/03` en `apps/api/src/db/schema.ts` con sus índices únicos y la clave compuesta de `llm_usage_daily`; migración `0000_init.sql` generada; `createDb` con `DATABASE_URL`; `npm run db:generate` y `npm run db:migrate` (el migrador es propio y carga `.env` con `process.loadEnvFile`); prueba de humo que se salta si no hay `DATABASE_URL`. Lint y typecheck pasan.
- Pendiente / problemas: **la migración no se ha aplicado ni probado contra PostgreSQL**. Docker Desktop está apagado (puerto 5432 rechaza la conexión) y el sistema me negó arrancarlo, así que la prueba de humo falla (2 pruebas) y no uní la rama a main. Para cerrar S2: `docker compose up -d db`, luego `npm run db:migrate` y `npm test`.
- Siguiente paso: levantar la base, correr esos dos comandos y, si pasan, marcar S2 y unir a main.

## 2026-10-31 · Decisión D2: el conjunto queda en 160 casos (S7 sigue abierta)
- Decisión: sin ronda del `ats-researcher` y sin subir el límite por empresa. El conjunto queda en 160 casos y los informes salen "provisionales" mientras la prueba tenga menos de 60 aplicables según tus etiquetas. Cuando S4 tenga ingesta diaria se agregan candidatos nuevos solo al split de prueba hasta llegar a 60, y se congela. La tarea quedó explícita en `docs/04-backlog.md`, dentro de S7.
- Siguiente paso: S2 mientras etiquetas.

## 2026-10-31 · Más candidatos en prueba (S7 sigue abierta)
- Hecho: `scripts/build-eval-set.mjs` agrega 10 candidatos estrictos solo al split de prueba (desarrollo no cambia: 50). El conjunto queda en 160 casos (50 dev + 110 prueba, 90 candidatos). Ninguna empresa pasa de 10 candidatos, y las vacantes hermanas solo entran si todas sus hermanas ya están en prueba.
- Métricas: con las sugerencias heurísticas, la prueba tiene **54 posibles aplicables** (antes 44), no los 75 pedidos. El techo se alcanzó: con las 13 empresas actuales y el límite de 10, ya no quedan candidatos estrictos sin usar.
- Pendiente / problemas: para llegar a ≥ 75 en prueba hacen falta unas 21 candidatas más de empresas nuevas (ronda dirigida del `ats-researcher`) o subir el límite por empresa. Aun con el límite de 10, 54 no garantiza el ≥ 60 del ADR 0004 tras tus correcciones.
- Siguiente paso: decidir cómo ampliar (ronda del `ats-researcher` o límite por empresa); después, etiquetar con la hoja.

## 2026-10-31 · S1 hecha y primer conjunto de 150 casos para S7 (S7 sigue abierta)
- Hecho S1: monorepo con npm workspaces (`apps/api`, `apps/web`, `packages/core`), `tsconfig.base.json` estricto, ESLint (con `no-explicit-any`) y Prettier, Vitest y una prueba por paquete. `npm run lint && npm run typecheck && npm test` pasan, y `npm run build` también. `ingest` y `eval` son stubs que fallan a propósito hasta S4 y S7. `core` se consume como TypeScript directo, sin paso de build. Express 5, React 19 y Vite.
- Hecho S7 (solo el conjunto): `scripts/build-eval-set.mjs` (temporal, determinista, semilla 7) genera `packages/core/evals/eligibility/cases.json` y `data/seed-career-ops/eval-labeling-sheet.tsv` (títulos, ubicaciones y extractos, fuera de git). En git van solo identificadores, división y procedencia, sin texto de ofertas.
- Composición (150): 80 candidatos (74 con Colombia/LATAM en el campo de ubicación, sin híbrido ni marca de EE. UU., más 6 de ubicación "Worldwide/Americas" de Canonical y otros; ninguna empresa con más de 10 y Sezzle con 10) + 50 negativos difíciles (12 `us_only`, 12 de un solo país fuera de Colombia, 8 "Worldwide" con restricción en el cuerpo, 8 híbridos, 10 coincidencias falsas por texto de la empresa) + 20 descartes de career-ops por ubicación. División: 50 en desarrollo y 100 en prueba, repartidos por grupo y empresa; las vacantes hermanas (misma vacante por país) quedan juntas en la misma división.
- Etiquetas: todas `pending`. `proposedLabel` es una sugerencia heurística, no una decisión. Con esas sugerencias saldrían unos 67 posibles aplicables para Colombia (23 en desarrollo y 44 en prueba), pero `workModel` está en `unknown` en casi todos y por el ADR 0004 eso no cuenta como aplicable; el número real sale de tus etiquetas.
- Pendiente / problemas: faltan tus etiquetas finales. No entran al conjunto los casos del docs/07 que vienen de Get on Board (BC Tecnología, Valsnapp, WiTi) ni "Sezzle AI Intern", que ya no está en el board. Quedan fuera de S7 el runner, `FakeLLMProvider` y lo que depende de S3–S6b. El script de armado es temporal, como el de rescate.
- Siguiente paso: etiquetar los 150 casos con la hoja `eval-labeling-sheet.tsv`; después S2.

## 2026-10-31 · Conteo de candidatos a aplicables (fuera del backlog)
- Hecho: agregadas Canals, Caseware, Turing y Canonical a `data/companies.json` y descargadas (417 ofertas nuevas; 1618 archivos en total, contando el seed). GitLab y Elastic no se agregan: ningún campo de ubicación de sus 238 y 407 ofertas menciona Colombia o LATAM. Remedy no se agrega. Nearsure, 10Pearls y Koombea quedaron `active=false`: Nearsure redirige a Nortal, 10Pearls no enlaza a ningún ATS permitido y Koombea usa BambooHR (fuera del ADR 0002).
- Métricas (sin LLM, regex sobre ubicación y cuerpo; script en el scratchpad, no versionado): criterio amplio = 542 candidatos (383 títulos distintos). Criterio estricto (término de Colombia/LATAM en el campo de ubicación, sin marca "solo EE. UU.", sin híbrido/presencial) = 356 (203 títulos distintos por empresa; Sezzle aporta 100 por publicar la misma vacante por país). "Worldwide/Americas" en ubicación: 209, casi todo Canonical. Solo 11 ofertas con marca de EE. UU. entre las candidatas.
- Pendiente / problemas: la precisión del criterio amplio es baja (muestra de 10: ~4 correctas; el ruido viene de descripciones de empresa como "líder en Latin America" y de ofertas híbridas o de otros países). Son candidatos, no aplicables: falta clasificar y etiquetar.
- Siguiente paso: S1; los 150 casos de S7 salen de estos candidatos (usar el criterio estricto).

## 2026-10-31 · Get on Board descartado y rescate de boards del directorio (fuera del backlog)
- Hecho: revisados los términos (`/about/tos`, `/about/privacy`), `robots.txt` y `/api-doc.html` de Get on Board. Veredicto: **ambiguo**. Ninguna cláusula permite a terceros guardar el texto; la sección 7 prohíbe la descarga automática y el uso para entrenar modelos (escrita para clientes), y `robots.txt` declara `ai-train=no` con reserva de derechos de la UE. La documentación de la API no se pudo leer (se renderiza con JavaScript). Por tu regla, **Get on Board queda fuera** y sus 43 ofertas no se rescatan.
- Hecho: `scripts/rescue-seed-offers.mjs --source=companies` descarga todas las ofertas vigentes de los boards activos de `data/companies.json` (sin los 3 inactivos). Corrida real: 866 ofertas leídas de 12 boards, 804 nuevas y 62 ya guardadas. Fallaron 3 boards: nearsure y 10pearls (`fetch failed`) y koombea (404). Informe en `data/seed-career-ops/bodies/rescue-report-companies.tsv`. Los 21 MB siguen fuera de git.
- Hecho: sección "Política de decisiones" añadida a `CLAUDE.md`.
- Pendiente / problemas: las 804 ofertas nuevas incluyen mucho que no es LATAM (Sezzle 273, Clara 155, ElevenLabs 144, CI&T 151); hay que clasificarlas antes de contar aplicables. El `ats-researcher` solo verificó 7 empresas (Canals, Caseware, Turing, Canonical, GitLab, Elastic, Remedy), no las 15–25 pedidas; falta tu aprobación para agregarlas a `companies.json`.
- Siguiente paso: aprobar o ajustar la lista de empresas candidatas; reintentar nearsure y 10pearls y buscar el token correcto de koombea.

## 2026-10-31 · Rescate del texto de las ofertas del seed (fuera del backlog)
- Hecho: script temporal `scripts/rescue-seed-offers.mjs`, sin dependencias, y corrida completa sobre las 411 ofertas de Greenhouse, Lever y Ashby de `scan-history.tsv`. El texto quedó en `data/seed-career-ops/bodies/`, fuera de git, con el detalle por URL en `rescue-report.tsv`.
- Decisiones: se guarda `raw` sin normalizar, porque eso es de S3; el script nunca sobrescribe y se puede volver a correr. Get on Board queda fuera hasta revisar sus términos. No hace falta un ADR nuevo.
- Métricas: 42 boards, sin LLM. Por estado: `saved` 397 (Ashby 148, Greenhouse 133, Lever 116), `not_on_board` 10 (Greenhouse 5, Lever 4, Ashby 1), `unresolved_board` 4 (Trade Republic), `board_error` 0. Se salvaron las 27 aceptadas por career-ops; las 370 restantes guardadas son descartes por ubicación, útiles como negativos. Verificado: 397 archivos, todos con texto (mínimo 1056 caracteres), 6,3 MB.
- Pendiente / problemas: los candidatos a aplicables siguen siendo pocos para ≥ 60: 27 rescatados, sin verificar. Otros 43 están en Get on Board, sin rescatar, y se pueden vencer. Las 4 ofertas de Trade Republic no se resolvieron: su board no es el nombre de la empresa. Borrar el script cuando S3–S4 lo reemplacen. Sigue pendiente definir la fuente de candidatas del scan semanal.
- Siguiente paso: **revisar los términos de uso de Get on Board** para decidir si se rescatan sus 43 ofertas — `Revisa los términos de uso y de la API de Get on Board y dime si podemos usar sus ofertas para el conjunto de evaluación. No descargues nada todavía.` Después, S1.

## 2026-10-31 · Integración del diseño v0.1 (fuera del backlog)
- Hecho: ADR 0004 creado; ADR 0005 integrado y ADR 0003 marcado como sustituido; ADR 0002 precisado; `docs/00`–`04`, `CLAUDE.md`, `README.md`, `.env.example` y `.claude/` (reglas, skill de evaluación, subagente `llm-evaluator`) actualizados con los docs 06 y 07; sesiones nuevas S6b (cola) y S7b (comparar modelos gratuitos).
- Decisiones: taxonomía de 6 etiquetas con "aplicable" calculado por país; precisión ≥ 95 % y recall ≥ 80 %; solo capa gratuita de Gemini; encaje con reglas deterministas, sin LLM ni embeddings en el MVP; sin tracker; boletín después de S11; prompts iterados solo sobre desarrollo. Todo queda en los ADR 0004 y 0005. Vigencia diaria sin LLM, ofertas cerradas ocultas y sin borrar, y directorio por curación manual con candidatas semanales: queda en el ADR 0002 y cierra la sección 4.5 del docs/06. No hace falta un ADR nuevo.
- Métricas: sin eval todavía. El seed tiene 671 ofertas: 75 pasaron el filtro de career-ops, de las cuales 27 son de Greenhouse, Lever o Ashby y 43 de Get on Board.
- Pendiente / problemas: el seed no alcanza para ≥ 60 aplicables en el conjunto de prueba, y los informes serán provisionales hasta llegar ahí. `scan-history.tsv` no trae el cuerpo de las ofertas y las que cierren se pierden para S7. La sección 4.6 del docs/06 sigue abierta. Falta definir de dónde salen las empresas candidatas del scan semanal: la ingesta solo lee empresas que ya están en el directorio. Confirmar en S6b la hora de renovación de la cuota de Gemini. Revisar en GitHub la lista de colaboradores. Se reescribió `main` para quitar la coautoría de Claude en dos commits.
- Siguiente paso: S0 si falta la base de datos; si no, S1 — `Lee docs/02-arquitectura.md y haz la sesión S1 del backlog. Planea primero y espera mi aprobación.`

## 2026-10-29 · Preparación
- Hecho: visión y MVP, arquitectura, modelo de datos, ADRs 0001–0003, backlog por sesiones, configuración de Claude Code (CLAUDE.md, reglas, subagentes, skills, hook de formato, permisos).
- Decisiones: TypeScript de punta a punta; APIs públicas de Greenhouse, Lever y Ashby; LLM detrás de una interfaz con control de costos.
- Métricas: —
- Pendiente: S0 (entorno en Windows, repositorio en GitHub, base de datos).
- Siguiente paso: S1 — `/siguiente-tarea S1`
