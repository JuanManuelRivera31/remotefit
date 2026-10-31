---
paths:
  - "packages/core/src/llm/**"
  - "packages/core/src/eligibility/**"
  - "packages/core/src/fit/**"
  - "packages/core/evals/**"
---

# Reglas para código de LLM

- Toda llamada pasa por la interfaz `LLMProvider`; nada de importar el SDK del proveedor fuera de `src/llm/`.
- Solo capa gratuita de la API de Gemini, sin facturación vinculada. Un modelo de pago requiere un nuevo ADR.
- Al LLM solo se envía texto público de ofertas; nunca perfil, CV, correo ni otros datos personales. El encaje (`src/fit/`) no usa LLM.
- Las clasificaciones pasan por la cola con control de ritmo. Los errores de cuota o de red no generan un `unclear`: la oferta sigue pendiente.
- Cada prompt vive en su propio archivo con `*_PROMPT_VERSION`. Cambiar el texto del prompt obliga a subir la versión.
- La salida se valida con el esquema Zod. Si no valida: un reintento incluyendo el error de validación; si vuelve a fallar, devolver `unclear` y registrar el error. Nunca guardar salida sin validar.
- El prompt exige **evidencia textual** citada de la oferta y permite `unclear`. Prohibido inferir país o permisos sin texto que lo respalde.
- La salida del clasificador es corta: meta de menos de 300 tokens, nunca un informe.
- Registrar `inputTokens`, `outputTokens`, `equivalentCostUsd` y `model` en cada llamada.
- La caché usa la clave `content_hash` + `prompt_version` + `model`.
- Las pruebas unitarias usan un `FakeLLMProvider`; nunca llaman a la red. Solo `npm run eval` usa el proveedor real en pruebas de calidad.
- Antes de dar por terminado un cambio de prompt o de modelo, generar el informe de evaluación y comparar con el resultado anterior anotado en `docs/progreso.md`. Se itera sobre desarrollo; el conjunto de prueba solo acepta versiones candidatas y sus fallos no se usan para ajustar nada.
