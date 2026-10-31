# RemoteFit — Documento de diseño (v0.1)

> Contexto para el asistente: este documento resume decisiones y aprendizajes para construir RemoteFit. Úsalo como fuente de verdad del alcance y las prioridades. Las secciones marcadas **[DECIDIR]** están abiertas y deben resolverse antes de implementar lo que dependa de ellas.

> **Estado (2026-10-31):** las secciones 4.1, 4.2 y 4.3 quedaron decididas en el ADR 0004, y los costos en el ADR 0005; donde difieran, prevalecen los ADR. Las secciones 4.5 y 4.6 siguen abiertas.

## 1. Qué es RemoteFit

Copiloto de IA que muestra a desarrolladores latinoamericanos **solo las ofertas remotas de empresas de EE. UU. (y globales) a las que realmente pueden aplicar desde su país**, con evidencia citada de la oferta.

**Propuesta de valor:** una sola pregunta respondida de forma confiable y medida: *"¿Puedo aplicar a esta oferta desde aquí?"*. Todo lo demás (CV, cartas, seguimiento) queda fuera del MVP.

**Componentes actuales (en desarrollo):**
- Pipeline de ingesta desde APIs públicas de ATS (Greenhouse, Lever, Ashby) con normalización, deduplicación por hash de contenido y prefiltro por reglas que reduce el costo del LLM.
- Clasificador con LLM y salida estructurada validada con Zod que cita evidencia de la oferta; puntaje de encaje con el perfil; prompts versionados, caché y registro de costo por llamada.
- Sistema de evaluación con un conjunto etiquetado a mano (exactitud, matriz de confusión, costo por oferta).
- Desarrollo con agentes en Claude Code: subagentes de revisión y pruebas, skills, hooks y sesiones en paralelo con git worktrees.

**Stack:** TypeScript · Node.js/Express · React · PostgreSQL · Drizzle · Zod · APIs de LLM · Vitest.

## 2. Referente: career-ops (lo que hace y lo que aprendimos usándolo)

career-ops es un sistema open source de búsqueda de empleo que corre dentro de un CLI de IA (Claude Code). No tiene backend propio: el agente es el motor. Flujo:

1. **Perfil:** CV en markdown, perfil (roles, ubicación, salario) y reglas de puntuación por tipo de rol.
2. **Fuentes:** lista de empresas con su ATS (Greenhouse, Lever, Ashby, Workable, SmartRecruiters…), bolsas de empleo (p. ej. Get on Board) y búsquedas web.
3. **Scan:** consulta APIs públicas, normaliza, deduplica y filtra por título y ubicación.
4. **Pipeline en dos etapas:** triage barato (sí/no) → evaluación completa con informe y puntaje 1–5, incluido chequeo de legitimidad.
5. **Salidas:** CV adaptado en PDF, cartas, tracker de postulaciones, preparación de entrevistas, seguimiento. Nunca envía postulaciones.

**Aprendizajes de una ejecución real (perfil: desarrollador en Colombia):**
- **La elegibilidad por ubicación es el filtro más grande y el más difícil.** Primer scan: 384 ofertas, casi todas inaccesibles desde Colombia. Segundo scan: el filtro descartó 470. Aun así se colaron casos ambiguos: "San Francisco or Remote", "NYC, Remote", "Remote" que en una bolsa regional significa solo un país, y un "Remote" que era solo para Venezuela. → **Valida el problema central de RemoteFit.**
- **Las fuentes pesan más que el filtro.** Con una lista genérica de empresas de IA de EE. UU./Europa salió casi nada; al cambiar a empresas que contratan en LATAM salieron decenas de ofertas relevantes. → **El directorio de empresas es un activo del producto.**
- **Las ofertas se vencen.** Las 35 ofertas encontradas por búsqueda web estaban cerradas (las APIs de ATS devolvían 404). → **Verificar vigencia es obligatorio.**
- **Filtrar en cascada ahorra costo:** reglas → triage barato → evaluación completa. Mismo principio que el prefiltro de RemoteFit.
- **career-ops no mide su propia exactitud.** Clasifica, pero no sabe cuánto se equivoca. → **Diferenciador de RemoteFit: evaluación con datos etiquetados.**

## 3. Diferenciación frente a career-ops

| | career-ops | RemoteFit |
|---|---|---|
| Usuario | Una persona técnica en su terminal | Desarrolladores LATAM, como producto |
| Foco | Toda la búsqueda (CV, cartas, entrevistas, tracker) | Elegibilidad confiable: ¿puedo aplicar desde aquí? |
| Elegibilidad | Reglas + criterio del LLM, sin medir | Clasificador con evidencia citada y exactitud medida |
| Fuentes | Lista genérica que arma cada usuario | Directorio curado de empresas que contratan en LATAM |
| Costo | Lo paga el plan de cada usuario | Controlado: caché, prefiltro, costo por oferta |

## 4. Decisiones abiertas

### 4.1 Taxonomía de elegibilidad [DECIDIR]
No basta con sí/no. Propuesta inicial de etiqueta principal (una por oferta):
- `latam_eligible`: menciona LATAM, Colombia u otros países de la región.
- `worldwide`: remoto global sin restricción de país.
- `us_only`: requiere residencia o autorización de trabajo en EE. UU.
- `country_specific`: limitada a uno o varios países fuera de LATAM (p. ej. Canadá, UE, un país puntual).
- `onsite_or_hybrid`: requiere presencia física.
- `unclear`: la oferta no da información suficiente.

Atributos secundarios a evaluar: solapamiento de zona horaria exigido, tipo de vínculo (empleado, contratista, EOR), requisito de visa o autorización de trabajo, idioma de la oferta.

Cada etiqueta debe incluir la **cita textual** de la oferta que la justifica.

### 4.2 Métrica principal [DECIDIR]
Para el usuario, un falso "sí puedes aplicar" es peor que perderse una oferta (pierde tiempo y confianza). Propuesta:
- Métrica principal: **precisión de `latam_eligible` + `worldwide`** (de lo que marcamos como aplicable, cuánto realmente lo es).
- Métrica secundaria: recall de esas mismas etiquetas.
- Siempre reportar: matriz de confusión completa y costo por oferta.
- Objetivo inicial [DECIDIR]: p. ej. precisión ≥ 95 % con recall ≥ 80 %.

### 4.3 Conjunto de evaluación
- Base: ofertas reales procesadas (incluidas las que career-ops dejó pasar por error), etiquetadas **a mano**.
- Incluir a propósito casos difíciles: "City or Remote", "Remote" sin país, "Americas", "EMEA/LATAM", restricciones al final del texto, ofertas en español.
- Separar un conjunto de prueba fijo que nunca se use para ajustar prompts.
- Tamaño inicial sugerido [DECIDIR]: 150–300 ofertas.

### 4.4 Alcance del MVP
Dentro: ingesta, prefiltro, clasificación con evidencia, puntaje de encaje, vista de resultados, evaluación.
Fuera (por ahora): CV adaptado, cartas, tracker de postulaciones, preparación de entrevistas, envío de postulaciones.

### 4.5 Fuentes y vigencia [DECIDIR]
- Solo APIs públicas de ATS; sin scraping de LinkedIn ni sitios que lo prohíban.
- Directorio inicial de empresas con historial de contratar en LATAM (ejemplos verificados en la prueba: Sezzle, Clara, Addi, Wizeline, Deuna, Amplemarket, Supabase, ElevenLabs, CI&T, Koombea, Nearsure, 10Pearls).
- Definir cómo crece el directorio (descubrimiento automático, aportes de usuarios).
- Definir frecuencia de re-verificación de vigencia y qué hacer con ofertas cerradas (marcar, ocultar, borrar).

### 4.6 Forma de entrega [DECIDIR]
Opciones: aplicación web, resumen semanal por correo, extensión de navegador, API. Define la arquitectura (autenticación, perfiles, jobs programados) y es una diferencia clara frente a una herramienta de terminal.

## 5. Próximos pasos sugeridos
1. Cerrar la taxonomía (4.1) y la métrica principal (4.2).
2. Etiquetar el primer lote del conjunto de evaluación con casos difíciles.
3. Medir la línea base: solo reglas vs. reglas + LLM.
4. Iterar prompts con datos, registrando versión, exactitud y costo.
5. Decidir la forma de entrega del MVP.
