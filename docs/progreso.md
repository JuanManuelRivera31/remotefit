# Bitácora del proyecto

La entrada más reciente va arriba. La skill `/cierre-de-sesion` la actualiza al final de cada sesión.

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
