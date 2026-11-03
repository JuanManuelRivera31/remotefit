# Análisis de errores del clasificador (2026-11-03)

Hecho **desde la caché, sin gastar cuota** (`scripts/analyze-errors.ts`), sobre el desarrollo (317 casos: los 160 de antes más los 157 de test-v2 retirada). Las etiquetas son las vigentes tras el control de calidad de evidencias. Un falso positivo (FP) es una oferta que el clasificador da por aplicable para Colombia y la etiqueta dice que no; un falso negativo (FN), al revés. La precisión es la métrica que manda (ADR 0004).

## Qué se midió

| Versión | Casos | TP | FP | FN | Precisión | Recall |
|---|---|---|---|---|---|---|
| v3 + postprocess-v2 | 160 (los de antes) | 88 | 5 | 2 | 94,6 % | 97,8 % |
| v4 + postprocess-v2 | 317 | 165 | 11 | 6 | 93,8 % | 96,5 % |
| v4, solo el modelo (sin postproceso) | 317 | 165 | 15 | 6 | 91,7 % | 96,5 % |
| **v4 + postprocess-v3** | 317 | 165 | **2** | 6 | **98,8 %** | 96,5 % |

Los 160 casos de v3 y v4 son los mismos (v3 nunca corrió sobre test-v2).

## Falsos positivos por patrón y por empresa

| Patrón | Familia | v3 (160) | v4 (317) | Empresas |
|---|---|---|---|---|
| "can be executed globally" frente a una lista de países del ATS | **estructural** (cómo el ATS arma la ubicación) | 1 | 6 | ElevenLabs |
| País de una ubicación compuesta ("Brazil, Remote \| Bogota, Colombia") sin su propio "Remote" | **estructural** | 0 | 3 | Sezzle |
| Metadato `hybrid` ignorado ("Remote work from anywhere" como beneficio) | **estructural** | 1 | 0 (corregido por la regla 8b del prompt v4) | Deuna |
| "Distributed across North and South America" leído como elegibilidad | interpretación del texto | 2 | 0 (corregido por la regla 8c del prompt v4) | Canals |
| Zona horaria que excluye a Colombia (GMT-3 a GMT+2) dentro de "Remote, EMEA/LATAM" | interpretación | 1 | 1 | Amplemarket |
| Título y sección dicen Colombia, pero el cuerpo pide residir en Brasil | interpretación (contradicción) | 0 | 1 | ElevenLabs |

Total, uniendo v3 y v4: 11 estructurales (9 de ElevenLabs/Sezzle que persisten con v4) y 4 de interpretación (2 ya corregidas por el prompt, 2 abiertas).

## Falsos negativos (v4, 6 casos)

Son 5 de interpretación y 1 estructural. Cuestan recall (96,5 %, muy por encima de la meta de 80 %), no precisión:

- **3 de Clara, 1 de Sezzle y 1 de Addi:** el modelo lee "híbrido" donde las etiquetas aplican la regla 6 del ADR (remote-first con viajes periódicos es remoto). La regla 8b del prompt v4 ("el híbrido gana a las frases que suenan remotas") va en sentido contrario a esa regla 6, escrita después. No se cambia el prompt para esto: solo cuesta recall y una iteración cuesta 317 llamadas.
- **1 de Turing:** `United States | Global - Remote` leído como `us_only`.

## Qué se hizo (todo con código, medido gratis desde la caché)

1. `ats_country_list` (ElevenLabs): la lista de países del ATS manda sobre la frase global. Decisión basada en evidencia externa (guía, regla 7 del ADR 0004).
2. `segment_remote` (Sezzle): un país solo cuenta como remoto si su segmento dice Remote, el metadato del ATS es `remote`, o el cuerpo trae `#LI-remote` o una línea `Location: Remote, ...` que lo nombra.
3. Resultado: **11 FP → 2 FP** en desarrollo. Los 2 que quedan son de interpretación (Amplemarket y ElevenLabs `ec04799b`) y no se resuelven con código.

**Cautela:** las dos reglas se diseñaron mirando estos mismos errores. La cifra de desarrollo (98,8 %) no es una medición independiente; la medirá test-v3.
