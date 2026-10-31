# Bitácora del proyecto

La entrada más reciente va arriba. La skill `/cierre-de-sesion` la actualiza al final de cada sesión.

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
