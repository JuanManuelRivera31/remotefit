---
name: nueva-fuente-ats
description: Añade un conector para un ATS (Greenhouse, Lever, Ashby, Workable, Recruitee...) siguiendo el patrón del proyecto, con fixture real y pruebas. Úsala en las sesiones S3 o para sumar una fuente nueva.
argument-hint: "[nombre-del-ats]"
disable-model-invocation: true
---

# Nuevo conector ATS: $ARGUMENTS

Sigue `.claude/rules/ats-connectors.md` y `docs/adr/0002-fuentes-de-ofertas.md`.

1. **Endpoint.** Si el ATS no está en el ADR 0002, pide al subagente `ats-researcher` el endpoint público oficial, sus parámetros y la URL de la documentación. Añádelo al ADR.
2. **Fixture real.** Pídeme un identificador de tablero real de una empresa que use este ATS (o propón uno que `ats-researcher` haya verificado). Descarga la respuesta con `curl` y guárdala recortada a 3–5 ofertas en `packages/core/fixtures/$ARGUMENTS/<empresa>.json`. Si la descarga falla, detente y dime el error.
3. **Tipos.** Escribe los tipos de la respuesta en `packages/core/src/ats/$ARGUMENTS.ts` a partir del fixture (no de memoria). Campos que no usemos pueden quedar como `unknown`.
4. **Conector.** `fetchJobs(boardToken)` con timeout, `User-Agent`, paginación si aplica y manejo de 404. `toNormalizedJob(raw, company)` que devuelve el tipo `NormalizedJob` común.
5. **Registro.** Añade el ATS al tipo unión y al mapa de conectores en `packages/core/src/ats/index.ts`.
6. **Pruebas.** Con el fixture: conversión correcta de cada campo, ofertas ocultas descartadas, paginación, tablero vacío. Puedes delegar al subagente `test-writer`.
7. **Verifica** con `npm test -w packages/core` y muéstrame una oferta normalizada de ejemplo.
