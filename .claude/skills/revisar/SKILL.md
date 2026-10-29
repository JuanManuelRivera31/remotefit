---
name: revisar
description: Revisión independiente de los cambios sin commit, hecha por el subagente code-reviewer en un contexto aparte.
disable-model-invocation: true
context: fork
agent: code-reviewer
---

Revisa todos los cambios sin commit de este repositorio (`git diff HEAD` y archivos nuevos en `git status`), siguiendo tu proceso habitual. Enfócate en lo que cambió; no revises el repositorio completo. Entrega bloqueantes, mejoras y lo que está bien hecho, en español.
