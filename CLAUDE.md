# RemoteFit — instrucciones para Claude

Copiloto que muestra a desarrolladores de Latinoamérica solo las ofertas remotas de EE. UU. a las que realmente pueden aplicar, ordenadas por encaje y con evidencia. Visión y alcance del MVP: `docs/01-vision-y-mvp.md` (léelo solo si la tarea lo requiere).

## Cómo trabajar conmigo
- Responde en **español**. Código, nombres de variables, commits y comentarios de código en **inglés**.
- Soy desarrollador junior-intermedio aprendiendo a construir con IA: cuando tomes una decisión técnica no obvia, explícala en 1–2 frases.
- **Planea antes de codificar** en cualquier tarea de más de un archivo: muéstrame el plan y espera mi aprobación.
- Trabaja una sesión del backlog a la vez (`docs/04-backlog.md`). No adelantes trabajo de sesiones futuras.
- Si algo del backlog o de la arquitectura parece equivocado, dímelo antes de desviarte.
- Cuida mi límite de uso (plan Pro): no leas archivos enteros que no necesitas, no repitas búsquedas, usa subagentes solo cuando aporten.

## Arquitectura (resumen)
Monorepo npm workspaces en TypeScript. Detalle: `docs/02-arquitectura.md`, datos: `docs/03-modelo-de-datos.md`, decisiones: `docs/adr/`.
- `packages/core` — lógica de dominio pura: conectores ATS, normalización, reglas, LLM, elegibilidad, encaje. **Sin Express ni React aquí.**
- `apps/api` — Express + Drizzle + PostgreSQL; comandos CLI (`ingest`, `classify`, `score`).
- `apps/web` — React + Vite + Tailwind + TanStack Query.

## Comandos (disponibles desde la sesión S1)
- `npm run dev` — API y web en modo desarrollo
- `npm run lint` · `npm run typecheck` · `npm test` — correr los tres antes de cada commit
- `npm test -w packages/core` — pruebas de un solo paquete
- `npm run ingest` · `npm run classify` · `npm run score` — pipeline
- `npm run eval` — evaluación del clasificador
- `npm run db:migrate` — migraciones

## Reglas del código
- TypeScript estricto. Prohibido `any`; usa `unknown` + validación con Zod.
- Toda salida de un LLM se valida con su esquema Zod antes de usarse o guardarse.
- Los prompts viven en archivos propios con una constante de versión (`*_PROMPT_VERSION`). Si cambias un prompt, sube la versión.
- Las funciones del dominio son puras siempre que se pueda; el I/O (red, base de datos) va en los bordes.
- Pruebas con Vitest junto al código (`*.test.ts`). Los conectores se prueban contra fixtures reales en `packages/core/fixtures/`, nunca contra la red.
- Commits pequeños con Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Lo que nunca debes hacer
- Leer o imprimir `.env` ni claves. La clave del LLM se llama `RF_LLM_API_KEY`; nunca uses ni sugieras `ANTHROPIC_API_KEY` como variable global.
- Hacer scraping de LinkedIn u otros sitios que lo prohíben. Solo APIs públicas de ATS (ADR 0002).
- Enviar aplicaciones a empleos de forma automática.
- `git push --force`, borrar ramas o reescribir historia sin que yo lo pida.

## Herramientas de este repo
- Subagentes en `.claude/agents/`: `code-reviewer`, `test-writer`, `llm-evaluator`, `ats-researcher`.
- Skills en `.claude/skills/`: `/siguiente-tarea`, `/nueva-fuente-ats`, `/eval-clasificador`, `/revisar`, `/commit`, `/cierre-de-sesion`.
- Un hook formatea con Prettier cada archivo que edites (cuando Prettier esté instalado).
- Estado del proyecto y bitácora: `docs/progreso.md`.
