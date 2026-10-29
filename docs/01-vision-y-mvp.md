# RemoteFit — Visión y MVP

> Nombre en código: **RemoteFit**. Se puede cambiar más adelante sin afectar la arquitectura.

## 1. El problema

Un desarrollador en Latinoamérica que busca trabajo remoto con empresas de EE. UU. pierde la mayor parte de su tiempo en ofertas que **no son para él**:

1. **Ofertas "remotas" que en realidad solo contratan en EE. UU.** El texto lo dice en la mitad de la descripción ("must be located in the US", "US-based only") o no lo dice y te descartan después.
2. **La pregunta de autorización de trabajo** ("Are you legally authorized to work in the United States?") descarta automáticamente a quien responde honestamente "no", antes de que un humano lea el CV.
3. **CVs genéricos** que el reclutador descarta en segundos.

Las bolsas de empleo (LinkedIn, Computrabajo) y las herramientas de IA que aplican en masa (AiApply, LazyApply, Jobright) no resuelven el punto 1: no distinguen si **tú, desde tu país**, puedes ser contratado.

## 2. La propuesta de valor

> **"Solo te muestro las ofertas a las que realmente puedes aplicar desde Latinoamérica, ordenadas por qué tan bien encajan contigo, con la evidencia de por qué."**

Calidad sobre volumen. El usuario aprueba cada aplicación; la herramienta nunca envía nada sola.

## 3. Usuario objetivo

- **Usuario 1 (el más importante):** Juan Manuel, desarrollador full-stack junior en Colombia (React, TypeScript, Node, PostgreSQL), inglés B2, buscando remoto en EE. UU. como contratista.
- **Después:** desarrolladores latinoamericanos junior y semi-senior con el mismo problema.

## 4. Alcance del MVP (versión 0.1)

El MVP responde **una sola pregunta bien**: *"¿qué ofertas nuevas de hoy puedo aplicar y cuáles me convienen más?"*

### Incluido

| # | Funcionalidad | Criterio de aceptación |
|---|---|---|
| F1 | **Ingesta de ofertas** desde las APIs públicas de Greenhouse, Lever y Ashby, para una lista de empresas configurada en `data/companies.json` | `npm run ingest` descarga, normaliza y guarda las ofertas sin duplicarlas; marca como inactivas las que desaparecen |
| F2 | **Prefiltro por reglas** (sin IA, gratis) que detecta señales obvias: "US only", "W-2", "authorized to work in the US", "worldwide", "LATAM", "contractor" | Pruebas unitarias con frases reales; las ofertas descartadas por reglas no llegan al LLM |
| F3 | **Clasificador de elegibilidad con LLM** que devuelve un JSON validado: estado, regiones permitidas, modelo de contratación, zona horaria, salario, evidencia textual y confianza | Salida validada con Zod; resultados cacheados por `content_hash + prompt_version`; costo por llamada registrado |
| F4 | **Conjunto de evaluación** (40+ ofertas reales etiquetadas a mano) y comando `npm run eval` | Reporta exactitud, matriz de confusión y costo. **Meta: ≥ 85 % de exactitud en "elegible / no elegible"** |
| F5 | **Perfil del usuario** (CV en texto, habilidades, seniority, preferencias) | Se edita desde la web o un archivo JSON |
| F6 | **Puntaje de encaje** (0–100) solo para ofertas elegibles: habilidades que coinciden, las que faltan y un resumen | Salida validada con Zod |
| F7 | **Panel web** con la lista de ofertas elegibles ordenadas por encaje, filtros, detalle con la evidencia y estado de la aplicación (guardada, aplicada, entrevista, rechazada) | Se puede usar a diario en menos de 10 minutos |

### Fuera del MVP (versiones siguientes)

- Generar CV y carta adaptados a cada oferta (v0.2).
- Simulacros de entrevista en inglés por voz (v0.3).
- Búsqueda semántica con embeddings y pgvector (v0.2).
- Multiusuario, autenticación y pagos (v0.4, solo si se valida que otros lo quieren).
- Aplicar automáticamente. **No se hará:** va contra la propuesta de calidad y contra los términos de varias plataformas.

## 5. Métricas de éxito del MVP

- El clasificador alcanza ≥ 85 % de exactitud en el conjunto de evaluación.
- Juan Manuel lo usa al menos 2 semanas seguidas para su búsqueda real.
- Reduce el tiempo para encontrar ofertas aplicables (medido por él: antes vs. después).
- Al menos 3 compañeros desarrolladores lo prueban y dicen si pagarían.

## 6. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El LLM clasifica mal | Conjunto de evaluación, evidencia textual obligatoria, estado "unclear" cuando no hay señales |
| Costo de la API del LLM | Prefiltro por reglas, caché por hash, modelo pequeño, registro de costo por llamada, límite de gasto en la consola del proveedor |
| Cambios en las APIs de los ATS | Un conector por ATS con pruebas basadas en respuestas reales guardadas (fixtures) |
| Términos de uso | Solo APIs públicas de empleadores; no se hace scraping de LinkedIn ni se redistribuyen ofertas |
| El límite del plan Pro de Claude | Tareas pequeñas, una sesión principal, subagentes solo cuando aportan (ver `docs/05-flujo-con-agentes.md`) |
