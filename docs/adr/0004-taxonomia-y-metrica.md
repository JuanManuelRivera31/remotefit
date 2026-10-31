# ADR 0004 — Taxonomía de elegibilidad y métrica de éxito

- **Estado:** Aceptado
- **Fecha:** 2026-10-31
- **Relacionado con:** ADR 0005 (costos y modelo de negocio), docs/06-diseno-v0.1.md, docs/07-aprendizajes-career-ops.md

## Contexto

La pregunta central de RemoteFit es *"¿puedo aplicar a esta oferta desde aquí?"*. Los datos de la prueba con career-ops muestran por qué un sí/no no alcanza:

- El 84 % de 671 ofertas no era accesible desde Colombia, con 164 formas distintas de escribir la ubicación.
- El campo de ubicación miente o se queda corto: "Remote" limitado a Europa, "fully remote" con cuerpo híbrido, "Remote" solo para Venezuela.
- Una oferta para un país de LATAM es aplicable para ese país y no para los demás, así que la respuesta depende de quién pregunta.

Para el usuario, un falso "sí puedes aplicar" es peor que perderse una oferta: pierde tiempo y confianza.

## Decisión

### 1. Etiqueta principal (una por oferta)

| Etiqueta | Significado |
|---|---|
| `latam_eligible` | Abierta a **toda** la región: "LATAM", "Latin America", "Americas". Si la región es parcial o excluye países, se listan en `excludedCountries` |
| `worldwide` | Remoto global sin restricción de país |
| `us_only` | Requiere residencia o autorización de trabajo en EE. UU. |
| `country_specific` | Limitada a países concretos, dentro o fuera de LATAM, listados en `countries` |
| `onsite_or_hybrid` | Requiere presencia física |
| `unclear` | La oferta no da información suficiente |

### 2. Atributos

| Atributo | Valores | Nota |
|---|---|---|
| `countries` | ISO 3166-1 alpha-2 | Solo países nombrados en la oferta. Vacío si la restricción es una región fuera de LATAM sin países concretos |
| `excludedCountries` | ISO 3166-1 alpha-2 | Excepciones a `latam_eligible`, `worldwide` o `country_specific` |
| `workModel` | `remote`, `hybrid`, `onsite`, `unknown` | Lo que dice el cuerpo; si no dice nada, los metadatos |
| `workModelConflict` | booleano | `true` si metadatos y cuerpo se contradicen |
| `seniority` | `intern`, `junior`, `mid`, `senior`, `lead_or_above`, `unknown` | No forma parte de la elegibilidad |
| `minYearsExperience` | entero o `null` | Solo si la oferta lo dice |
| `hiringModel` | `employee`, `contractor`, `eor`, `unknown` | |
| `timezoneRequirement` | texto corto o `null` | Por ejemplo, "Chile hours" |
| `requiresUsWorkAuthorization` | booleano o `null` | `null` si la oferta no lo menciona |
| `postingLanguage` | `en`, `es`, `pt`, `other` | |
| `evidence` | 1 o 2 citas textuales | Del título, la ubicación o el cuerpo; cada una de 160 caracteres o menos |

No hay campo `confidence`: si el modelo duda, la etiqueta es `unclear` (ADR 0005). Tampoco hay `salary` ni `reasoning`, para mantener corta la salida.

### 3. Reglas de interpretación

- El cuerpo manda sobre los metadatos. Si se contradicen, `workModelConflict = true` y la etiqueta sigue al cuerpo.
- Nunca se infiere país o permiso sin texto que lo respalde. "Remote" sin país y "San Francisco or Remote" son `unclear`, aunque normalmente signifiquen EE. UU.
- Toda etiqueta lleva evidencia, incluida `unclear`: en ese caso se cita la ubicación o el texto ambiguo.
- `latam_eligible` y `worldwide` implican `workModel = remote`.

### 4. "Aplicable" se calcula por país del usuario

La calcula código puro, sin LLM, a partir del resultado ya guardado. Así una misma clasificación sirve a usuarios de cualquier país (ADR 0005).

```ts
export function isApplicable(result: Eligibility, userCountry: string): boolean {
  if (result.workModel !== "remote") return false;
  if (result.excludedCountries.includes(userCountry)) return false;
  switch (result.label) {
    case "latam_eligible":
      return LATAM_COUNTRIES.has(userCountry);
    case "worldwide":
      return true;
    case "country_specific":
      return result.countries.includes(userCountry);
    default:
      return false;
  }
}
```

- `workModel = unknown` no cuenta como aplicable: se prioriza la precisión. `onsite_or_hybrid` nunca es aplicable, aunque el país coincida, porque el producto es de empleo remoto.
- `LATAM_COUNTRIES` es una constante de `packages/core`: AR, BO, BR, BZ, CL, CO, CR, CU, DO, EC, GT, GY, HN, HT, MX, NI, PA, PE, PY, SR, SV, UY, VE.

### 5. Métrica

Se mide sobre la cascada completa (reglas + LLM), comparando `isApplicable(predicción)` con `isApplicable(etiqueta manual)`. El país de referencia es **Colombia**, donde está el usuario 1 y de donde vienen los datos.

- **Principal:** precisión de aplicables **≥ 95 %**. Es requisito duro.
- **Secundaria:** recall de aplicables **≥ 80 %**. Si un modelo no alcanza ambas, se prioriza la precisión y se documenta la brecha (ADR 0005).
- **Siempre en el informe:** matriz de confusión de las 6 etiquetas, costo por oferta, modelo, versión del prompt, tamaño del conjunto y cuántos positivos y negativos tiene.
- **Costo por oferta:** en la capa gratuita el gasto real es USD 0, así que se reportan tokens de entrada y salida y el **costo equivalente** a precio de lista.

### 6. Conjunto de evaluación

- **Etiquetas:** las pone a mano Juan Manuel. Nunca se cambian sin su aprobación.
- **Primer hito:** 150 casos, sembrados desde `data/seed-career-ops/` e incluyendo la tabla de casos difíciles del docs/07. Se reparten 50 en desarrollo y 100 en prueba.
- **Conjunto de prueba fijo:** se congela al tener **≥ 60 aplicables para Colombia**. Hasta entonces solo se le agregan casos y todo informe sale marcado **"provisional"**.
- **Desarrollo frente a prueba:** los prompts se iteran y los fallos se analizan solo sobre desarrollo. El informe sobre prueba se corre únicamente para aceptar una versión candidata de prompt o modelo, y sus fallos no se usan para ajustar nada.
- **Mezcla:** la precisión depende de cuántos negativos haya. Los negativos incluyen casos difíciles, no solo obvios, y el informe declara la composición del conjunto.

El seed no alcanza por sí solo: de las 75 ofertas que pasaron el filtro de career-ops, 43 son de Get on Board, que no es fuente del MVP, y solo 27 vienen de Greenhouse, Lever o Ashby. Tampoco están verificadas como aplicables. Por eso el conjunto sigue creciendo con ofertas de la ingesta.

### 7. Salida corta

La salida del clasificador es un JSON con meta de **menos de 300 tokens**, nunca un informe. El informe de evaluación reporta el promedio y el máximo de tokens de salida.

## Casos de referencia

| Caso | Etiqueta | Atributos clave | ¿Aplicable desde CO? |
|---|---|---|---|
| Sezzle SWE II (LATAM) | `latam_eligible` | hermana de la de Colombia | Sí |
| Sezzle SWE II (Colombia) | `country_specific` | `countries: ["CO"]` | Sí |
| Sezzle AI Intern | `country_specific` | `countries: ["CO"]`, `workModel: unknown` | No |
| BC Tecnología Full-Stack | `onsite_or_hybrid` | `workModel: hybrid`, `workModelConflict: true` | No |
| ElevenLabs Full-Stack | `country_specific` | `countries: ["US"]`; el resto es Europa | No |
| Valsnapp Fractional | `latam_eligible` | `excludedCountries: ["MX", "CU", "DO", "HT"]`, `hiringModel: contractor` | Sí |
| Amplemarket Frontend | `latam_eligible` | zona horaria | Sí |
| Addi Frontend | `country_specific` | `countries: ["CO"]` | Sí |
| WiTi Back-end | `latam_eligible` | `timezoneRequirement` de Chile | Sí |
| "San Francisco or Remote" | `unclear` | | No |
| "Remote" solo para Venezuela | `country_specific` | `countries: ["VE"]` | No (sí desde VE) |

## Alternativas consideradas

- **Sí/no por oferta:** no distingue por país ni explica el motivo.
- **Exactitud global como métrica:** con el 84 % de ofertas no accesibles, un clasificador que diga "no" a todo obtendría una exactitud alta sin servir para nada.
- **`latam_eligible` para cualquier país de la región:** obligaría a mostrar a un colombiano una oferta solo para Venezuela.

## Consecuencias

- **Positivas:** la aplicabilidad se recalcula para cualquier país sin gastar cuota; la métrica refleja el daño real al usuario; el informe sirve como evidencia del diferenciador del producto.
- **Negativas:** priorizar precisión deja ofertas buenas como `unclear`; llegar a 60 aplicables exigirá acumular ofertas durante un tiempo; los primeros informes serán provisionales.
- **Seguimiento:** revisar este ADR al congelar el conjunto de prueba o si aparece un patrón que la taxonomía no pueda representar.
