# Cómo trabajar con varios agentes (y no agotar el plan Pro)

Claude Code ofrece tres formas de "multitarea". Cada una sirve para algo distinto y **todas consumen tu límite del plan Pro**, que es compartido con el chat de Claude.

## 1. Subagentes (dentro de una misma sesión)

Un subagente es un Claude especializado que trabaja con **su propio contexto** y le devuelve a tu sesión solo el resultado. Sirven para que tu conversación principal no se llene de ruido.

Este repo trae cuatro, en `.claude/agents/`:

| Subagente | Para qué | Modelo | ¿Edita archivos? |
|---|---|---|---|
| `code-reviewer` | Revisar el diff antes del commit | sonnet | No |
| `test-writer` | Escribir pruebas Vitest de un módulo | sonnet | Sí |
| `llm-evaluator` | Mejorar prompts y analizar el eval | sonnet | No |
| `ats-researcher` | Buscar empresas y documentación de ATS en la web | haiku (más barato) | No |

**Cómo llamarlos:**
- Natural: *"Usa el subagente code-reviewer para revisar mis cambios."*
- Directo: escribe `@agent-code-reviewer revisa el conector de Lever`.
- Con una skill: `/revisar` ya lo hace por ti.
- Para verlos o crear nuevos: `/agents`.

**En paralelo:** puedes pedir *"usa ats-researcher en paralelo para buscar empresas con Greenhouse, con Lever y con Ashby"*. Claude lanza tres subagentes a la vez y junta los resultados. Útil para investigar; caro si abusas.

## 2. Sesiones paralelas con worktrees (varias terminales)

Un *worktree* es una copia de trabajo del repo en otra carpeta y otra rama. Cada terminal trabaja en su worktree, así los cambios no chocan.

```bash
# Terminal 1
claude --worktree lever
# Terminal 2
claude --worktree ashby
```

- Se crean en `.claude/worktrees/<nombre>/` sobre la rama `worktree-<nombre>` (ya está en `.gitignore`).
- `.worktreeinclude` copia tu `.env` a cada worktree automáticamente.
- En cada worktree hay que instalar dependencias (`npm install`) la primera vez.
- Al salir, Claude pregunta si conservar o borrar el worktree. Para unir el trabajo: haz commit en el worktree, vuelve a la carpeta principal y fusiona la rama (`git merge worktree-lever`) o abre un pull request en GitHub.

Aquí es donde Warp (o las pestañas de Windows Terminal) brillan: una pestaña por worktree.

**Cuándo vale la pena:** tareas marcadas 🟢 en el backlog que tocan carpetas distintas (por ejemplo S9 API y S10 web). **Con Pro, máximo 2 a la vez.**

## 3. Skills (recetas repetibles)

Una skill es un procedimiento guardado que invocas con `/nombre`. No es paralelismo, pero ahorra escribir el mismo prompt largo cada vez y hace que Claude siga siempre los mismos pasos.

| Skill | Qué hace |
|---|---|
| `/siguiente-tarea [S3a]` | Toma la siguiente sesión del backlog: plan → aprobación → código → pruebas → revisión |
| `/nueva-fuente-ats lever` | Crea un conector ATS con fixture real y pruebas |
| `/eval-clasificador` | Corre el eval, compara con la vez anterior y propone mejoras |
| `/revisar` | Revisión independiente con `code-reviewer` |
| `/commit` | Verifica y hace commit con buen mensaje |
| `/cierre-de-sesion` | Actualiza backlog y bitácora para retomar después |

Para crear una skill nueva: carpeta `.claude/skills/<nombre>/SKILL.md` con un encabezado `name` y `description`. Puedes pedirle a Claude que la cree por ti.

## Reglas de oro para el plan Pro

1. **Una tarea por conversación.** Al terminar: `/cierre-de-sesion`, `/commit`, y luego `/clear`. Una conversación larga relee todo su historial en cada mensaje y gasta mucho más.
2. **Planea primero** (modo plan con `Shift+Tab`, o pide "planea y espera mi aprobación"). Corregir un plan es barato; corregir 10 archivos no.
3. **Revisa tu uso** con `/status`. Si te queda poco, deja las tareas pesadas (refactors, muchos archivos) para después del reinicio.
4. **Sonnet para el día a día.** Reserva modelos más grandes para decisiones difíciles de arquitectura o depuración compleja (`/model`).
5. **Subagentes con propósito.** Una revisión antes del commit sí; tres subagentes para una tarea de un archivo, no.
6. **Si Claude se enreda**, no insistas 10 veces: `/clear`, explica el problema mejor y empieza de nuevo. `Esc` interrumpe; `Esc` dos veces permite volver a un mensaje anterior.
