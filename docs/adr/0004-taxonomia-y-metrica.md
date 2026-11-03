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
- Si `workModel` es `hybrid` u `onsite`, la etiqueta es `onsite_or_hybrid`. Vale tanto cuando el cuerpo lo dice explícitamente como cuando el cuerpo calla y el metadato del ATS (`workplaceType`) dice `hybrid` u `onsite` (decisión del dueño, 2026-11-03).
- "Americas", "North and South America" o "AMER" cuentan como región (`latam_eligible`) si nada más en el cuerpo restringe el puesto (D5). Una lista de países no es una región: es `country_specific` con esos países.
- Un país nombrado en el **título** manda sobre una lista larga de ubicaciones (suele agrupar vacantes hermanas): `country_specific` con ese país, salvo que el título diga también LATAM, Americas o global. Se aplica con código determinista, no con el prompt (ver sección 7).

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

- **Etiquetas:** originalmente las ponía a mano Juan Manuel. Desde 2026-11-01 son **asistidas por un LLM (Claude)** con reglas aprobadas por él (`labelSource = "llm-assisted"` en `cases.json`): primero con título, ubicación y extracto, y luego, para las 71 ofertas marcadas para verificar, contra el cuerpo completo, con una cita corta de evidencia por fila. La verificación humana se limitó a 9 casos dudosos, que él revisó el 2026-11-01 (`labelStatus = "owner_reviewed"`). Ninguna etiqueta se cambia sin su aprobación. Reglas aplicadas: "Americas", "AMER" o zona horaria de las Américas cuentan como `latam_eligible`; si el título nombra un país, manda sobre la lista de ubicaciones (que suele incluir vacantes hermanas); ante duda real, `unclear`; nunca `aplicable` sin evidencia; `workModel` sale del cuerpo y, si el cuerpo calla, de los metadatos del ATS (`workplaceType`).
- **Primer hito:** 150 casos, sembrados desde `data/seed-career-ops/` e incluyendo la tabla de casos difíciles del docs/07. Se reparten 50 en desarrollo y 100 en prueba.
- **Conjunto de prueba fijo:** se congela al tener **≥ 60 aplicables para Colombia**. Hasta entonces solo se le agregan casos y todo informe sale marcado **"provisional"**.
- **Congelado el 2026-11-02 (`testSet.status = "frozen"` en `cases.json`):** la prueba tenía 59 aplicables y la ingesta de las 13 empresas no aportó candidatos nuevos con Colombia/LATAM. Por decisión del dueño se movieron de desarrollo a prueba 2 casos aplicables sin hermanas (`greenhouse:clara:5257213007` y `lever:caseware:e723f716-7249-4567-8d44-46e273599ee5`; empresas distintas, ninguna pasa de 10 candidatos en prueba; campos `movedFrom`/`movedAt`). Se hizo **antes de cualquier evaluación o ajuste de prompt**, así que ningún resultado sobre desarrollo pudo influir en la elección y la prueba no se contamina. Resultado: **61 aplicables en prueba (112 casos) y 28 en desarrollo (48 casos)**. Desde ahora no se agregan ni se mueven casos en prueba; los informes ya no son "provisionales".
- **Revisión de etiquetas de desarrollo, 2026-11-03 (decisión del dueño, solo el conjunto de desarrollo):** se aplicaron las dos reglas anteriores sobre `workModel` y la D5. Quedaron 6 de 48 casos cambiados, con `relabeledFrom` y `relabelRule` en `cases.json` (`labelStatus = "owner_rules_applied"`): Clara (`5134418007`), Anthropic (`5238637008`), Caseware (`d59a9355…`), ClayLabs (`046cb127…`) y Pigment (`dad6777e…`) pasaron a `onsite_or_hybrid` / `hybrid` (los dos últimos por el metadato del ATS, porque el cuerpo calla). Un sexto caso, SumUp (`7475989002`, "office-first setup" en el cuerpo), se encontró después de la primera corrida de v2 y se corrigió con la misma regla (`onsite_or_hybrid` / `onsite`). **Canals (`195c6203…`) se había pasado a `latam_eligible` por la D5 y el dueño lo revirtió el mismo día** (`relabelRevertedAt` en `cases.json`): "distributed across North and South America" describe al equipo de la empresa, no quién puede postular, y el campo de ubicación lista ciudades de EE. UU.; prima la precisión. Queda `country_specific` / `unknown` [US], y la D5 solo se aplica cuando la región describe la elegibilidad del puesto. **No se tocó el conjunto de prueba congelado.** Su exactitud de 6 clases puede tener el mismo sesgo (ofertas híbridas con `workModel = unknown` y etiqueta `country_specific`); la métrica principal (aplicabilidad para CO) no se afecta, porque `workModel = unknown` ya no cuenta como aplicable y `hybrid` tampoco.
- **Corridas sobre la prueba congelada** (solo con aprobación del dueño, una por versión candidata; los fallos no se usan para ajustar nada):
  - **2026-11-03 · `gemini-3.5-flash-lite` + `eligibility-v3` + `postprocess-v1` — NO aceptada.** 112 casos (61 aplicables para CO): precisión **92,2 %** (59/64; IC 95 % de Wilson 83,0–96,6 %), recall **96,7 %** (59/61; IC 88,8–99,1 %), 5 falsos positivos. La meta de precisión (≥ 95 %) no se cumple; el recall sí. Costo equivalente $0,001011 por oferta. Detalle en `docs/progreso.md`. Esta versión ya vio la prueba: cualquier cambio de prompt o de postproceso necesita una nueva medición sobre desarrollo ampliado antes de una nueva corrida sobre la prueba.
- **Desarrollo frente a prueba:** los prompts se iteran y los fallos se analizan solo sobre desarrollo. El informe sobre prueba se corre únicamente para aceptar una versión candidata de prompt o modelo, y sus fallos no se usan para ajustar nada.
- **Mezcla:** la precisión depende de cuántos negativos haya. Los negativos incluyen casos difíciles, no solo obvios, y el informe declara la composición del conjunto.

El seed no alcanza por sí solo: de las 75 ofertas que pasaron el filtro de career-ops, 43 son de Get on Board, que no es fuente del MVP, y solo 27 vienen de Greenhouse, Lever o Ashby. Tampoco están verificadas como aplicables. Por eso el conjunto sigue creciendo con ofertas de la ingesta.

### 7. Salida corta

La salida del clasificador es un JSON con meta de **menos de 300 tokens**, nunca un informe. El informe de evaluación reporta el promedio y el máximo de tokens de salida.

### 8. Post-proceso determinista (S6, 2026-11-03)

Después del modelo se aplican reglas de código, versionadas con `POSTPROCESS_VERSION` (`postprocess-v1`), porque son más fiables que pedírselas al prompt: (1) un país nombrado en el título manda (sección 3); (2) una cita de más de 160 caracteres se recorta a un fragmento literal del texto en vez de degradar la oferta a `unclear`, y si no hay fragmento literal se descarta; (3) una etiqueta aplicable cuya cita no aparece en la oferta pasa a `unclear`. La clave de un resultado guardado es `content_hash + prompt_version + model + postprocess_version`; la **respuesta cruda** del modelo se cachea solo por `content_hash + prompt_version + model`, así que cambiar una regla recalcula sin gastar cuota. Los informes muestran la precisión y el recall del modelo solo y con el post-proceso.

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
