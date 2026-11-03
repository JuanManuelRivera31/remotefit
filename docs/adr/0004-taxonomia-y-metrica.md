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
| `travelRequirement` | texto corto o `null` | Viajes o semanas presenciales periódicas de un puesto remoto (regla 6). Solo etiquetas manuales por ahora |
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

#### Guía de etiquetado (2026-11-03, decisión del dueño; vale para desarrollo y prueba)

Patrones que provocaron errores de etiqueta o de predicción. Quien etiquete (persona o Claude; nunca un modelo que luego se mida contra esas etiquetas) los aplica así:

1. **La distribución del equipo no es elegibilidad.** Frases como "distributed across North and South America" o "talent equally distributed across the globe" describen a la empresa. Manda la ubicación o la restricción explícita del puesto; la D5 ("Americas" = `latam_eligible`) solo aplica cuando la región dice quién puede postular.
2. **"Remote work from anywhere" como beneficio temporal no cambia un `workModel` híbrido.** Si el puesto es híbrido (cuerpo o metadato), la etiqueta es `onsite_or_hybrid` aunque la lista de beneficios mencione trabajo remoto.
3. **Una ubicación compuesta que une varias vacantes** (p. ej. Sezzle: "Mexico, Remote | Latin America [Remote]") se lee así: si el cuerpo o la cabecera (título, restricción explícita) restringen a un país, manda ese país; si no, la región.
4. **Un título en el idioma o alfabeto de otro país** (p. ej. japonés) indica ese país, salvo que la oferta diga lo contrario.

Las reglas de la sección 3 sobre `workModel` siguen vigentes: hybrid/onsite explícito en el cuerpo, o cuerpo callado y metadato del ATS hybrid/onsite, dan `onsite_or_hybrid`.

5. **Regla general de duda (2026-11-03, decisión del dueño): ante duda o contradicción, gana la etiqueta conservadora, la que no es aplicable.** Si dos lecturas razonables del texto dan una etiqueta aplicable y otra que no lo es, se elige la no aplicable (`unclear`, `onsite_or_hybrid`, `country_specific` con el país restringido o `us_only`, según lo que el texto sostenga). Desempata; no autoriza a ignorar evidencia clara de elegibilidad. Dos precisiones de la misma decisión:
   - Una **zona horaria sola** ("Central time zone") no restringe a un país: cuenta como región (D5). Solo restringe si el cuerpo o la cabecera nombran el país como requisito.
   - Una oferta "remote-first" que dice estar "comprometida con el trabajo híbrido" es `onsite_or_hybrid` si el rol tiene ciudad u oficina asignada, y `unclear` si no. Nunca aplicable.

6. **Viajes frente a híbrido (2026-11-03, decisión del dueño).** Un puesto "remote-first" con viajes o semanas presenciales periódicas (ramp-up, reuniones de equipo, eventos, visitas a clientes, "presencial cuando se requiera") **cuenta como remoto**, y el requisito de viaje se guarda como atributo (`travelRequirement`, texto corto; hoy solo en las etiquetas manuales de `cases.json`, el clasificador aún no lo emite). **Híbrido significa presencia regular semanal** (días fijos por semana, o el puesto se declara híbrido): "Hybrid" en el título del puesto, "This is a hybrid role", "3 days per week in office", o el metadato del ATS `hybrid` cuando el cuerpo calla. Una frase de la empresa ("comprometida con el trabajo híbrido") junto a un rol "remote-first" sin días fijos no vuelve híbrido el puesto. Esta regla sustituye la lectura sobre Clara de la regla 5 (rol "remote-first" con ciudad asignada).

**Reaplicación a los 160 casos de desarrollo (2026-11-03).** Detección determinista de cada patrón, lectura del caso y decisión; 14 cambios, todos con `relabeledFrom`, `relabelRule` y `relabeledAt` en `cases.json`: 13 ofertas pasaron a `onsite_or_hybrid` (Decagon, LangChain, Legora, Lovable, Perplexity, Sierra, Wayve, Celonis, Glean, Speechmatics, Palantir ×2 y Turing `6115695004`, esta última por el patrón 2 porque su cuerpo dice "In-office · Hybrid" aunque la ubicación diga "India - Remote"), y Sezzle `7984978003` pasó de `country_specific` [MX] a `latam_eligible` por el patrón 3 (ni el título ni el cuerpo restringen a México). Patrón 1: sin cambios (el único caso, Canals, ya estaba revertido). Patrón 4: sin cambios (Canonical, título en japonés, ya es `country_specific` [JP]). Casos que la guía no resuelve y quedan para tu criterio: ver `docs/progreso.md`.

**Decisión del dueño sobre los 9 casos dudosos de desarrollo (2026-11-03).** Se aplicó la regla 5 y quedaron 7 casos cambiados (`relabelRule` en `cases.json`; `devLabelRevision.revisions`): Sezzle `7984978003` se queda `latam_eligible` (patrón 3, aceptado como regla general: se aplicará igual en test-v2); Sezzle `8010090003` pasa a `latam_eligible` (la zona horaria "Central" sola no restringe a México y ni el título ni el cuerpo lo nombran); Sezzle `7906563003` pasa a `country_specific` [PE, CO] (ni cuerpo ni título restringen a Perú; dos países en la ubicación son una lista, no una región); Pinecone `edf2a2a5` queda `us_only` con `workModelConflict = true`; Clara `5204916007`, `5204918007` y `5257213007` pasan a `onsite_or_hybrid` (el rol tiene ciudades asignadas y la empresa dice estar "comprometida con el trabajo híbrido"); CI&T `a75a23c9` pasa a `workModel = remote` por el metadato (la presencia obligatoria en Campinas es solo para residentes de esa zona). Wizeline `7264950` (`unclear`), Celonis `8002490003` y Perplexity `be94e89b` (`onsite_or_hybrid`) se mantienen. **Efecto en la métrica, para que no pase desapercibido:** con v3 sobre los 160 casos y sin tocar el modelo ni el prompt, la precisión sube de 93,6 % (88/94) a 94,7 % (89/94) y el recall de 97,8 % a 100 % (Sezzle `7984978003` ya había pasado de falso positivo a acierto con la guía; hoy lo hacen Sezzle `8010090003` y `7906563003`, que el modelo ya acertaba; los dos Clara de la regla 5 dejan de ser falsos negativos, y Clara `5257213007` pasa de acierto a falso positivo). Son cambios de etiqueta por regla del dueño, no de comportamiento del clasificador.

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
- **Conjunto de prueba fijo (test-v2, congelado el 2026-11-03):** se arma con ofertas de la base que nunca estuvieron en el eval y que pasan el prefiltro, **máximo 25 casos por empresa** (aplicables y negativos), **máximo 3 ofertas por grupo de vacantes hermanas** (con países distintos cuando se pueda) y sin hermanas repartidas entre desarrollo y prueba: el resto de cada grupo queda fuera del eval (`excludedFromEval` en `cases.json`). Se etiqueta con Claude leyendo el cuerpo completo y la guía de la sección 3, nunca con Gemini. Se congela al tener **≥ 60 aplicables para Colombia**; si no se llega, se congela como **"provisional"** (D2) y se informa cuántos faltan. El informe de aceptación reporta precisión y recall **por empresa y el total sin Sezzle**, para ver si la cifra depende de una sola empresa.
  - **Estado:** 157 casos etiquetados por Claude con 12 subagentes en paralelo (cuerpo completo, guía y regla conservadora; nunca Gemini), con una revisión posterior de los casos que apoyaban su etiqueta en texto no visible para el subagente (3 de Clara) o en "can be executed globally" frente a una lista de países (5 de ElevenLabs, regla 5). **77 aplicables para Colombia** al congelar (meta ≥ 60: congelada, no provisional); **81** tras los cambios previos a la corrida del 2026-11-03 (ver abajo). Etiquetas: latam_eligible 31, worldwide 23, country_specific 58, onsite_or_hybrid 27, unclear 10, us_only 8. Aplicables por empresa: Canonical 23/25, Sezzle 19/25, Supabase 17/21, CI&T 8/19, Addi 7/11, Clara 3/25, y 0 en ElevenLabs, Turing, Deuna, Caseware, Amplemarket y Canals: **Canonical, Sezzle y Supabase suman 59 de los 77**, por eso el informe de aceptación debe leerse por empresa y sin Sezzle. Desde ahora no se agregan ni se mueven casos en test-v2.
  - **Cambios previos a la corrida (2026-11-03, decisión del dueño; hechos ANTES de correr cualquier modelo sobre test-v2, con `relabeledFrom` en `cases.json` y la lista en `testSet.preRunChanges`):** Addi `9438857e` pasa a `country_specific` [CO], remoto, con `travelRequirement` (semanas presenciales en Bogotá); Supabase `66bab062` pasa a `latam_eligible` (D5; además Colombia está en la franja horaria de la costa este); Turing `6225409004` pasa a `worldwide` (el cuerpo no exige residencia ni autorización de trabajo en EE. UU.); Sezzle `8012023003` se queda `unclear` (confirmado). La regla 6 de la guía (viajes periódicos = remoto; híbrido = presencia regular semanal) cambió además Sezzle `7504352003` ("able to work both remotely and onsite when required") a `country_specific` [CO] remoto. Se corrigió la evidencia de 3 casos de Clara cuyo título estaba abreviado con "...". Control de calidad de evidencias de todo el eval (script `scripts/check-evidence.ts`, sin LLM): ver `docs/progreso.md`.
  - **Criterio de aceptación de test-v2 (fijado el 2026-11-03, antes de correr):** se acepta una versión si, en el **valor puntual** sobre el total de test-v2, la precisión de aplicables para Colombia es **≥ 95 %** y el recall **≥ 80 %**. El informe incluye siempre el IC 95 % de Wilson, el desglose por empresa, el total sin Sezzle, sin Canonical y sin Lever, y los falsos positivos y negativos con su evidencia (`packages/core/evals/acceptance.ts`). **Si no cumple, no se ajusta nada usando test-v2**: se detiene el trabajo y se informa al dueño. Una versión aceptada deja `--allow-fallback` desactivado por defecto: `gemini-3.1-flash-lite` no tiene una medición aceptada.
  - **Resultado de la corrida única sobre test-v2 (2026-11-03): `gemini-3.5-flash-lite` + `eligibility-v4` + `postprocess-v2` NO CUMPLE.** 157 casos (81 aplicables para CO), 157 llamadas sin reintentos ni salidas degradadas: precisión **90,7 %** (78/86; IC 95 % de Wilson 82,7–95,2 %) frente a la meta de 95 %; recall **96,3 %** (78/81; 89,7–98,7 %). TP/FP/FN/TN = 78/8/3/68. Sin Sezzle: 92,2 % / 96,7 %; sin Canonical: 87,3 % / 94,8 %; sin Lever: 89,7 % / 95,9 %. Los 8 falsos positivos: 5 de ElevenLabs (el modelo toma "This role is remote and can be executed globally" como `worldwide`; la etiqueta, por la regla 5, es `country_specific` con la lista de países del ATS sin Colombia) y 3 de Sezzle (el modelo suma Colombia a la lista cuando solo el otro país lleva "Remote" o cuando no hay modalidad). Los 3 falsos negativos: Sezzle `7504352003` y Addi `9438857e` (el modelo los lee como híbridos; las etiquetas aplican la regla 6) y Turing `6225409004` (el modelo dice `us_only`; la etiqueta es `worldwide`). Informe completo en `packages/core/evals/reports/2026-11-03-eligibility-v4-gemini-3.5-flash-lite-test.md` (no versionado). **No se ajustó nada con estos resultados.** La versión **no figura como aceptada**, `--allow-fallback` sigue desactivado y no se corrió `npm run classify`. Pendiente de decisión del dueño: el conjunto ya vio una versión y la regla general de la sección 6 lo retiraría (sus 157 casos pasarían a desarrollo y haría falta una test-v3 que nadie haya visto).
- **(Historia: test-v1) Congelado el 2026-11-02 (`testSet.status = "frozen"` en `cases.json`):** la prueba tenía 59 aplicables y la ingesta de las 13 empresas no aportó candidatos nuevos con Colombia/LATAM. Por decisión del dueño se movieron de desarrollo a prueba 2 casos aplicables sin hermanas (`greenhouse:clara:5257213007` y `lever:caseware:e723f716-7249-4567-8d44-46e273599ee5`; empresas distintas, ninguna pasa de 10 candidatos en prueba; campos `movedFrom`/`movedAt`). Se hizo **antes de cualquier evaluación o ajuste de prompt**, así que ningún resultado sobre desarrollo pudo influir en la elección y la prueba no se contamina. Resultado: **61 aplicables en prueba (112 casos) y 28 en desarrollo (48 casos)**. Desde ahora no se agregan ni se mueven casos en prueba; los informes ya no son "provisionales".
- **Revisión de etiquetas de desarrollo, 2026-11-03 (decisión del dueño, solo el conjunto de desarrollo):** se aplicaron las dos reglas anteriores sobre `workModel` y la D5. Quedaron 6 de 48 casos cambiados, con `relabeledFrom` y `relabelRule` en `cases.json` (`labelStatus = "owner_rules_applied"`): Clara (`5134418007`), Anthropic (`5238637008`), Caseware (`d59a9355…`), ClayLabs (`046cb127…`) y Pigment (`dad6777e…`) pasaron a `onsite_or_hybrid` / `hybrid` (los dos últimos por el metadato del ATS, porque el cuerpo calla). Un sexto caso, SumUp (`7475989002`, "office-first setup" en el cuerpo), se encontró después de la primera corrida de v2 y se corrigió con la misma regla (`onsite_or_hybrid` / `onsite`). **Canals (`195c6203…`) se había pasado a `latam_eligible` por la D5 y el dueño lo revirtió el mismo día** (`relabelRevertedAt` en `cases.json`): "distributed across North and South America" describe al equipo de la empresa, no quién puede postular, y el campo de ubicación lista ciudades de EE. UU.; prima la precisión. Queda `country_specific` / `unknown` [US], y la D5 solo se aplica cuando la región describe la elegibilidad del puesto. **No se tocó el conjunto de prueba congelado.** Su exactitud de 6 clases puede tener el mismo sesgo (ofertas híbridas con `workModel = unknown` y etiqueta `country_specific`); la métrica principal (aplicabilidad para CO) no se afecta, porque `workModel = unknown` ya no cuenta como aplicable y `hybrid` tampoco.
- **Retiro de test-v1, 2026-11-03 (decisión del dueño):** la prueba congelada se corrió una sola vez, con aprobación, contra `gemini-3.5-flash-lite` + `eligibility-v3` + `postprocess-v1`. Resultado, **no aceptada**: 112 casos (61 aplicables para CO), precisión **92,2 %** (59/64; IC 95 % de Wilson 83,0–96,6 %), recall **96,7 %** (59/61; IC 88,8–99,1 %), 5 falsos positivos, costo equivalente $0,001011 por oferta. **Por qué se retira:** una prueba que ya vio una versión no puede aceptar a v4 sin sesgo (se conocen sus falsos positivos y cualquier ajuste posterior los tendría en cuenta, aunque sea sin querer). Sus 112 casos pasaron al conjunto de desarrollo, que queda en **160 casos**, con `retiredFrom = "test-v1"`; el registro vive en `retiredTestSets` de `cases.json`. Regla general: una prueba que acepta o rechaza una versión se retira al usarse; la siguiente versión candidata necesita una prueba que nadie haya visto.
  - Cifras del informe de test-v1 en `docs/progreso.md` (matriz de confusión, falsos positivos con su evidencia). La versión **no** figura como aceptada.
- **Desarrollo frente a prueba:** los prompts se iteran y los fallos se analizan solo sobre desarrollo. El informe sobre prueba se corre únicamente para aceptar una versión candidata de prompt o modelo, y sus fallos no se usan para ajustar nada.
- **Mezcla:** la precisión depende de cuántos negativos haya. Los negativos incluyen casos difíciles, no solo obvios, y el informe declara la composición del conjunto.

El seed no alcanza por sí solo: de las 75 ofertas que pasaron el filtro de career-ops, 43 son de Get on Board, que no es fuente del MVP, y solo 27 vienen de Greenhouse, Lever o Ashby. Tampoco están verificadas como aplicables. Por eso el conjunto sigue creciendo con ofertas de la ingesta.

### 7. Salida corta

La salida del clasificador es un JSON con meta de **menos de 300 tokens**, nunca un informe. El informe de evaluación reporta el promedio y el máximo de tokens de salida.

### 8. Post-proceso determinista (S6, 2026-11-03)

Después del modelo se aplican reglas de código, versionadas con `POSTPROCESS_VERSION` (`postprocess-v1`), porque son más fiables que pedírselas al prompt: (1) un país nombrado en el título manda (sección 3); (2) una cita de más de 160 caracteres se recorta a un fragmento literal del texto en vez de degradar la oferta a `unclear`, y si no hay fragmento literal se descarta; (3) una etiqueta aplicable cuya cita no aparece en la oferta pasa a `unclear`. **postprocess-v2 (2026-11-03):** un título escrito en kana o hangul que no nombra ningún país apunta a Japón o Corea del Sur (patrón 4 de la guía); el kanji solo no cuenta, porque también es chino. La clave de un resultado guardado es `content_hash + prompt_version + model + postprocess_version`; la **respuesta cruda** del modelo se cachea solo por `content_hash + prompt_version + model`, así que cambiar una regla recalcula sin gastar cuota. Los informes muestran la precisión y el recall del modelo solo y con el post-proceso.

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
