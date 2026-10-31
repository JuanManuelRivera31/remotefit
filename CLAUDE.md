# RemoteFit — instrucciones para Claude

Copiloto que muestra a desarrolladores de Latinoamérica solo las ofertas remotas de EE. UU. y globales a las que realmente pueden aplicar desde su país, ordenadas por encaje y con evidencia. Visión y alcance del MVP: `docs/01-vision-y-mvp.md` (léelo solo si la tarea lo requiere).

## Cómo trabajar conmigo
- Responde en **español**. Código, nombres de variables, commits y comentarios de código en **inglés**.
- Soy desarrollador junior-intermedio aprendiendo a construir con IA: cuando tomes una decisión técnica no obvia, explícala en 1–2 frases.
- **Planea antes de codificar** en cualquier tarea de más de un archivo: muéstrame el plan y espera mi aprobación.
- Trabaja una sesión del backlog a la vez (`docs/04-backlog.md`). No adelantes trabajo de sesiones futuras.
- Si algo del backlog o de la arquitectura parece equivocado, dímelo antes de desviarte.
- Cuida mi límite de uso (plan Pro): no leas archivos enteros que no necesitas, no repitas búsquedas, usa subagentes solo cuando aporten.

## Arquitectura (resumen)
Monorepo npm workspaces en TypeScript. Detalle: `docs/02-arquitectura.md`, datos: `docs/03-modelo-de-datos.md`, decisiones: `docs/adr/`.
- `packages/core` — lógica de dominio pura: conectores ATS, normalización, reglas, LLM, cola, elegibilidad, encaje (reglas deterministas, sin LLM). **Sin Express ni React aquí.**
- `apps/api` — Express + Drizzle + PostgreSQL; comandos CLI (`ingest`, `classify`, `score`).
- `apps/web` — React + Vite + Tailwind + TanStack Query.

## Comandos (disponibles desde la sesión S1)
- `npm run dev` — API y web en modo desarrollo
- `npm run lint` · `npm run typecheck` · `npm test` — correr los tres antes de cada commit
- `npm test -w packages/core` — pruebas de un solo paquete
- `npm run ingest` · `npm run classify` · `npm run score` — pipeline
- `npm run eval` — evaluación del clasificador (consume cuota diaria de Gemini)
- `npm run db:migrate` — migraciones

## Reglas del código
- TypeScript estricto. Prohibido `any`; usa `unknown` + validación con Zod.
- Toda salida de un LLM se valida con su esquema Zod antes de usarse o guardarse.
- Los prompts viven en archivos propios con una constante de versión (`*_PROMPT_VERSION`). Si cambias un prompt, sube la versión.
- Todo cambio de prompt o modelo se valida con el informe de evaluación (ADR 0004). Se itera sobre el conjunto de desarrollo; el de prueba solo acepta versiones candidatas.
- Las funciones del dominio son puras siempre que se pueda; el I/O (red, base de datos) va en los bordes.
- Pruebas con Vitest junto al código (`*.test.ts`). Los conectores se prueban contra fixtures reales en `packages/core/fixtures/`, nunca contra la red.
- Commits pequeños con Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Lo que nunca debes hacer
- Leer o imprimir `.env` ni claves. La clave del LLM se llama `RF_LLM_API_KEY`; nunca uses ni sugieras `ANTHROPIC_API_KEY` como variable global.
- Hacer scraping de LinkedIn u otros sitios que lo prohíben. Solo APIs públicas de ATS (ADR 0002).
- Enviar aplicaciones a empleos de forma automática.
- Enviar datos personales de usuarios (perfil, CV, correo) a capas gratuitas de LLM. Solo se envía texto público de ofertas.
- Usar un LLM distinto de la capa gratuita de la API de Gemini o vincularle facturación. Pasar a un modelo de pago requiere un nuevo ADR.
- `git push --force`, borrar ramas o reescribir historia sin que yo lo pida.

## Herramientas de este repo
- Subagentes en `.claude/agents/`: `code-reviewer`, `test-writer`, `llm-evaluator`, `ats-researcher`.
- Skills en `.claude/skills/`: `/siguiente-tarea`, `/nueva-fuente-ats`, `/eval-clasificador`, `/revisar`, `/commit`, `/cierre-de-sesion`.
- Un hook formatea con Prettier cada archivo que edites (cuando Prettier esté instalado).
- Estado del proyecto y bitácora: `docs/progreso.md`.

## Política de decisiones

Decide tú y continúa, explicando la decisión en el resumen final, cuando:
- Es técnica y no contradice los ADR ni docs/: estructura, nombres, librerías menores, pruebas, refactors, orden de tareas dentro de una sesión.
- La opción sigue las reglas del proyecto: privacidad, solo capa gratuita, precisión antes que recall, no contaminar el conjunto de prueba.
- Es fácil de revertir con git.

Pregúntame y espera solo cuando:
- Cambia el alcance del MVP, un ADR, la taxonomía o la métrica.
- Implica dinero, facturación o un proveedor de pago.
- Implica términos de uso o temas legales de una fuente nueva.
- Involucra datos personales.
- Se trata de fijar las etiquetas finales del conjunto de evaluación: puedes proponerlas, pero confirmarlas es cosa mía. La selección, composición y división (desarrollo/prueba) de los casos la decides tú.
- Agrega empresas nuevas al directorio.
- Borra datos que no están en git, reescribe historial o hace push forzado.

En general, si tu recomendación es clara y cumple las reglas del proyecto, ejecútala y repórtala en el resumen en lugar de preguntarme.

Cuando preguntes: máximo 3 decisiones, cada una con tu opción recomendada, y sigue avanzando con lo que no dependa de ellas.

Git: trabaja en ramas; al final de cada sesión, si las pruebas pasan, une a main y haz push.
