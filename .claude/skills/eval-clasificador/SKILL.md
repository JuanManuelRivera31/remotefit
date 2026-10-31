---
name: eval-clasificador
description: Ejecuta la evaluación del clasificador de elegibilidad, compara con la corrida anterior y propone mejoras. Úsala después de cambiar el prompt, las reglas o el modelo.
argument-hint: "[nota opcional sobre qué cambió]"
disable-model-invocation: true
---

# Evaluar el clasificador

Cambio a evaluar: $ARGUMENTS

1. Recuérdame que esto consume la cuota diaria gratuita de Gemini (no dinero), cuántos casos hay en `packages/core/evals/eligibility/` por conjunto y si la cuota de hoy alcanza. Pregúntame si la corrida es sobre `dev` (iterar) o `test` (aceptar una versión candidata). Espera mi confirmación.
2. Ejecuta `npm run eval -- --split <dev|test>` y guarda el reporte en `packages/core/evals/reports/<fecha>-<prompt_version>-<modelo>-<split>.md`.
3. Compara con el último resultado anotado en `docs/progreso.md`: precisión y recall de aplicables para Colombia, matriz de confusión, tokens y costo equivalente por oferta. Indica si el informe es "provisional" (menos de 60 aplicables en prueba).
4. Solo en `dev`: delega al subagente `llm-evaluator` el análisis de los casos fallidos. **Los fallos de `test` no se analizan ni se usan para ajustar nada.**
5. Preséntame en español: tabla antes/después y, si fue `dev`, los 3 cambios con más impacto esperado y cualquier etiqueta del conjunto que parezca equivocada. **Nunca cambies una etiqueta sin mi aprobación.**
6. Anota el resultado en `docs/progreso.md` (fecha, conjunto, versión del prompt, modelo, precisión, recall, costo equivalente, provisional o no).
