---
name: eval-clasificador
description: Ejecuta la evaluación del clasificador de elegibilidad, compara con la corrida anterior y propone mejoras. Úsala después de cambiar el prompt, las reglas o el modelo.
argument-hint: "[nota opcional sobre qué cambió]"
disable-model-invocation: true
---

# Evaluar el clasificador

Cambio a evaluar: $ARGUMENTS

1. Recuérdame que esto usa la API del LLM (cuesta dinero) y cuántos casos hay en `packages/core/evals/eligibility/cases.jsonl`. Espera mi confirmación.
2. Ejecuta `npm run eval` y guarda el reporte en `packages/core/evals/reports/<fecha>-<prompt_version>.md`.
3. Compara con el último resultado anotado en `docs/progreso.md`: exactitud global, exactitud elegible vs. no elegible, matriz de confusión, costo total y costo por oferta.
4. Delega al subagente `llm-evaluator` el análisis de los casos fallidos.
5. Preséntame en español: tabla antes/después, los 3 cambios con más impacto esperado y cualquier etiqueta del conjunto que parezca equivocada. **Nunca cambies una etiqueta sin mi aprobación.**
6. Anota el resultado en `docs/progreso.md` (fecha, versión del prompt, modelo, exactitud, costo).
