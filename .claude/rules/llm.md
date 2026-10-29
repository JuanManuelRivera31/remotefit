---
paths:
  - "packages/core/src/llm/**"
  - "packages/core/src/eligibility/**"
  - "packages/core/src/fit/**"
  - "packages/core/evals/**"
---

# Reglas para código de LLM

- Toda llamada pasa por la interfaz `LLMProvider`; nada de importar el SDK del proveedor fuera de `src/llm/`.
- Cada prompt vive en su propio archivo con `*_PROMPT_VERSION`. Cambiar el texto del prompt obliga a subir la versión.
- La salida se valida con el esquema Zod. Si no valida: un reintento incluyendo el error de validación; si vuelve a fallar, devolver `unclear` y registrar el error. Nunca guardar salida sin validar.
- El prompt exige **evidencia textual** citada de la oferta y permite `unclear`. Prohibido inferir país o permisos sin texto que lo respalde.
- Registrar `inputTokens`, `outputTokens`, `costUsd` y `model` en cada llamada.
- Las pruebas unitarias usan un `FakeLLMProvider`; nunca llaman a la red. Solo `npm run eval` usa el proveedor real.
- Antes de dar por terminado un cambio de prompt, correr `npm run eval` y comparar con el resultado anterior anotado en `docs/progreso.md`.
