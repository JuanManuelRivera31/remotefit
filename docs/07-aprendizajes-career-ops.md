# Aprendizajes de la prueba con career-ops (29–30 oct 2026)

Fuente: un escaneo real con career-ops para un desarrollador en Colombia, 15 evaluaciones completas y 4 postulaciones enviadas. Este documento convierte esa experiencia en decisiones para RemoteFit. Complementa `docs/06-diseno-v0.1.md`.

## 1. Datos reales que ya tenemos

Copiados en `data/seed-career-ops/` (**fuera de git**: contienen evaluaciones personales y textos de ofertas).

| Archivo | Qué contiene | Para qué sirve |
|---|---|---|
| `scan-history.tsv` | 671 ofertas de 121 empresas: URL, título, empresa, ubicación, fecha, estado | Tabla de pruebas del prefiltro (S5) y casos para el eval (S7) |
| `reports/*.md` | 15 evaluaciones; cada una trae la descripción **textual** de la oferta ("Job Description (archived verbatim)") | Primeros casos completos y difíciles del conjunto de evaluación (S7) |
| `jds/*.md` | 5 descripciones completas | Igual que arriba |
| `discard.log` | 28 descartes del triage con su motivo | Ejemplos de "elegible pero no apto por stack/nivel" |

`data/companies.json` quedó sembrado con 15 empresas cuyos identificadores salen de URLs reales del escaneo (7 activas con vacantes vigentes, 5 nearshore por verificar, 3 desactivadas hasta verificarlas).

## 2. Las cifras que validan el problema

- **84 % descartado por ubicación:** 561 de 671 ofertas no eran accesibles desde Colombia. Solo 75 pasaron (11 %) y 35 estaban vencidas (5 %).
- **164 formas distintas de escribir la ubicación**, entre ellas `""` (40 ofertas sin ubicación), `Remote` (43), `Remote, Global`, `United States & Canada · San Francisco · Remote`, `Hybrid - San Francisco, New York City` y nombres en chino (`新加坡`, `圣何塞`). Un filtro de texto simple no alcanza.
- **El campo de ubicación miente o se queda corto** en casos clave (ver sección 3). Por eso hay que leer también el cuerpo de la oferta.

## 3. Casos difíciles reales (deben estar en el conjunto de evaluación)

| Caso | Qué dice | Etiqueta esperada (taxonomía del 06) |
|---|---|---|
| Sezzle SWE II **(LATAM)** y **(Colombia)** | La misma vacante publicada dos veces, una por región y otra por país | `latam_eligible` y `country_specific[CO]` · **son hermanas**: agrupar |
| Sezzle AI Intern (Colombia) | Ubicación "Bogota, Colombia"; el cuerpo no dice nada; solo la etiqueta `#Li-remote` | `country_specific[CO]` + **modalidad incierta** |
| BC Tecnología Full-Stack (LATAM) | Los metadatos dicen "Fully remote, anywhere"; el cuerpo dice "modalidad híbrida en Las Condes" | `onsite_or_hybrid` · **el cuerpo manda sobre los metadatos** |
| ElevenLabs Full-Stack | Ubicación "Remote"; el cuerpo limita a Europa y la costa este de EE. UU. | `country_specific` · **"Remote" engañoso** |
| Valsnapp Fractional | "Candidates must reside in South America and Central America" | `latam_eligible` (región parcial; incluye CO) · por horas, contratista |
| Amplemarket Frontend | "Remote, EMEA/LATAM"; equipo en Lisboa | `latam_eligible` + zona horaria |
| Addi Frontend | "Remote, Colombia" | `country_specific[CO]` |
| WiTi Back-end | Remoto LATAM incluida Colombia, horario de Chile | `latam_eligible` + zona horaria Chile |
| "San Francisco or Remote", "NYC, Remote" | Remoto sin país | `unclear` (normalmente EE. UU.; nunca asumir) |
| "Remote" en una bolsa regional | Significa solo el país de esa bolsa | `country_specific` |
| "Remote" solo para Venezuela | País de LATAM suelto | `country_specific[VE]` → **no aplica para CO** |

## 4. Lecciones de producto

1. **La elegibilidad es el filtro número 1**: confirma el núcleo de RemoteFit.
2. **El nivel es el filtro número 2.** De las 14 ofertas elegibles evaluadas, la mayoría se descartó por pedir 3 o más años. Para el usuario objetivo (junior), saber si una oferta es **accesible para su nivel** vale casi tanto como saber si es elegible. → Extraer `seniority` y `minYearsExperience` como atributos baratos del clasificador (no forman parte de la etiqueta de elegibilidad).
3. **Las fuentes pesan más que el filtro.** Las empresas de IA de EE. UU. y Europa dieron casi cero resultados aplicables (Palantir: 118 de 118 descartadas; Sierra: 48 de 48). Las empresas con historial en LATAM dieron casi todo lo útil. → El directorio curado es el activo principal.
4. **Vigencia y antigüedad.** 35 ofertas vencidas; todas las encontradas por búsqueda web estaban cerradas. Además, hay vacantes vivas pero muy viejas (Sezzle Intern abierta desde abril de 2025; Amplemarket desde diciembre de 2024), que probablemente son bolsas de talento. → Guardar `postedAt`, mostrar la antigüedad y marcar las de más de 180 días.
5. **Costo: el mayor aprendizaje.** career-ops agotó el límite del plan Pro en unas dos sesiones, generando informes de ~30 KB por oferta. → En RemoteFit, el clasificador devuelve un JSON corto (meta: menos de 300 tokens de salida), nunca informes largos; el encaje solo se calcula para ofertas aplicables y accesibles por nivel; el costo por oferta se mide desde el primer día.
6. **El puntaje debe explicarse y ser ajustable.** career-ops descartó las pasantías de IA solo porque la configuración del perfil no las incluía. → El encaje muestra por qué sube o baja y qué parte del perfil lo determinó.
7. **Vacantes hermanas.** Una empresa puede publicar la misma vacante por país. → Agrupar por `requisition_id` o por título más empresa, y mostrar una sola vacante con su lista de países.
8. **Get on Board es una fuente fuerte para LATAM** (102 ofertas en el escaneo, con API). Candidata a cuarta fuente en v0.2, tras revisar sus términos.

## 5. Cambios propuestos al plan

Para integrarlos junto con `docs/06-diseno-v0.1.md` en una sesión de Claude Code:

- **Contrato del clasificador:** taxonomía del 06 + atributos `countries`, `excludedCountries`, `workModel` y `workModelConflict` (metadatos vs. cuerpo), `seniority`, `minYearsExperience`, `postingLanguage`, `evidence`.
- **Modelo de datos:** `jobs.posted_at` ya existe; añadir `requisition_id` y `sibling_group`; quitar la tabla `applications` del MVP.
- **S5 (prefiltro):** usar las 164 ubicaciones reales como tabla de pruebas.
- **S7 (evaluación):** empezar con los 15 casos completos y la tabla de la sección 3, más ofertas de `scan-history.tsv` hasta llegar a 150. Las etiquetas las pone Juan Manuel.
- **Panel (S10):** filtros de "aplicable desde mi país" y "accesible para mi nivel", más un indicador de antigüedad.
