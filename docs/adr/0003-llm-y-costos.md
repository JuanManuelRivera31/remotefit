# ADR 0003 — LLM detrás de una interfaz, con control de costos

- **Estado:** sustituida por el ADR 0005 (2026-10-31)
- **Fecha:** 2026-10-29

> Se conserva como historial. La interfaz de proveedores vigente está en `docs/02-arquitectura.md`, sección 5; la decisión de proveedor y costos, en el ADR 0005. Ya no aplican: Anthropic como implementación inicial, el pago por uso, el límite de gasto en la consola del proveedor ni la clave de caché sin modelo.

## Contexto
La clasificación de elegibilidad y el puntaje de encaje necesitan un LLM. La API se paga por uso y es independiente del plan Pro de Claude. El presupuesto es pequeño.

## Decisión
1. Interfaz `LLMProvider` en `packages/core/src/llm/`:
   ```ts
   interface LLMProvider {
     generateStructured<T>(args: {
       system: string;
       user: string;
       schema: z.ZodType<T>;
       schemaName: string;
       maxTokens?: number;
     }): Promise<{ data: T; usage: { inputTokens: number; outputTokens: number; costUsd: number }; model: string }>;
   }
   ```
2. Implementación inicial con el SDK de Anthropic usando un modelo pequeño y salida estructurada (herramienta con `input_schema` derivado del esquema Zod). La clave se lee de `RF_LLM_API_KEY` y se pasa explícitamente.
3. Prompts versionados (`ELIGIBILITY_PROMPT_VERSION = "v1"`); cambiar el prompt sube la versión e invalida la caché.
4. Frenos de costo: prefiltro por reglas, caché por `(content_hash, prompt_version)`, solo ofertas nuevas, límite de gasto en la consola del proveedor, registro de costo por llamada.
5. Precios por modelo en un único archivo (`llm/pricing.ts`) para calcular `costUsd`; se actualizan a mano consultando la página oficial de precios.

## Alternativas
- Un proveedor con nivel gratuito o un modelo local (Ollama) pueden implementarse como otro `LLMProvider` sin tocar el resto.

## Consecuencias
- Cambiar de proveedor o de modelo es un cambio de configuración.
- El conjunto de evaluación permite comparar modelos y prompts con datos (exactitud vs. costo).
