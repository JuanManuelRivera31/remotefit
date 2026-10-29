---
name: siguiente-tarea
description: Toma la siguiente sesión pendiente del backlog (o la indicada) y la lleva de plan a código probado. Úsala al empezar a trabajar.
argument-hint: "[id de sesión, p. ej. S3a]"
disable-model-invocation: true
---

# Siguiente tarea del backlog

Sesión pedida: $ARGUMENTS (si está vacío, toma la primera casilla sin marcar de `docs/04-backlog.md`).

1. **Contexto mínimo.** Lee la sesión en `docs/04-backlog.md`, la última entrada de `docs/progreso.md` y solo las secciones de `docs/02-arquitectura.md` / `docs/03-modelo-de-datos.md` / `docs/adr/` que la sesión necesite. No explores el repo completo.
2. **Verifica dependencias.** Si la sesión depende de otra sin terminar (🔴), dímelo y propón la correcta.
3. **Plan.** Presenta en español: objetivo, archivos a crear o modificar, decisiones técnicas con su porqué en una frase, pruebas que escribirás y cómo sabremos que está terminada. **Espera mi aprobación** antes de escribir código.
4. **Implementa en pasos pequeños.** Después de cada paso relevante corre la prueba del paquete afectado. Si la sesión marca 👤, detente en esa parte y explícame qué necesito hacer yo.
5. **Verifica.** `npm run lint`, `npm run typecheck` y `npm test` deben pasar (desde S1 en adelante).
6. **Revisión.** Delega al subagente `code-reviewer`. Corrige los bloqueantes; muéstrame las mejoras y pregunta si las aplicamos.
7. **Cierre.** Resume en 3–5 líneas qué se hizo y qué aprendí, y sugiere ejecutar `/commit` y luego `/cierre-de-sesion`.
