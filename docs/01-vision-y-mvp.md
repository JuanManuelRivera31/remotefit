# RemoteFit — Visión y MVP

> Nombre en código: **RemoteFit**. Se puede cambiar más adelante sin afectar la arquitectura.

## 1. El problema

Un desarrollador en Latinoamérica que busca trabajo remoto con empresas de EE. UU. o globales pierde la mayor parte de su tiempo en ofertas que **no son para él**:

1. **Ofertas "remotas" que en realidad solo contratan en EE. UU.** El texto lo dice en la mitad de la descripción ("must be located in the US", "US-based only") o no lo dice y te descartan después.
2. **La pregunta de autorización de trabajo** ("Are you legally authorized to work in the United States?") descarta automáticamente a quien responde honestamente "no", antes de que un humano lea el CV.
3. **El nivel:** de las ofertas elegibles evaluadas en la prueba con career-ops, la mayoría pedía 3 o más años de experiencia.

La prueba real lo confirma: 561 de 671 ofertas (84 %) no eran accesibles desde Colombia (ver `docs/07-aprendizajes-career-ops.md`).

Las bolsas de empleo (LinkedIn, Computrabajo) y las herramientas de IA que aplican en masa (AiApply, LazyApply, Jobright) no resuelven el punto 1: no distinguen si **tú, desde tu país**, puedes ser contratado.

## 2. La propuesta de valor

> **"Solo te muestro las ofertas a las que realmente puedes aplicar desde tu país, ordenadas por qué tan bien encajan contigo, con la evidencia de por qué."**

Calidad sobre volumen. La herramienta nunca envía nada sola, y el usuario decide a qué aplica fuera de ella.

## 3. Usuario objetivo

- **Usuario 1 (el más importante):** Juan Manuel, desarrollador full-stack junior en Colombia (React, TypeScript, Node, PostgreSQL), inglés B2, buscando remoto en EE. UU. como contratista.
- **Después:** desarrolladores latinoamericanos junior y semi-senior con el mismo problema.

## 4. Alcance del MVP (versión 0.1)

El MVP responde **una sola pregunta bien**: *"¿qué ofertas puedo aplicar desde mi país y cuáles me convienen más?"*

### Incluido

| # | Funcionalidad | Criterio de aceptación |
|---|---|---|
| F1 | **Ingesta de ofertas** desde las APIs públicas de Greenhouse, Lever y Ashby, para una lista de empresas configurada en `data/companies.json` | `npm run ingest` descarga, normaliza y guarda las ofertas sin duplicarlas; marca como inactivas las que desaparecen; guarda `posted_at` y agrupa las vacantes hermanas |
| F2 | **Prefiltro por reglas** (sin IA, gratis) que detecta señales obvias: "US only", "W-2", "authorized to work in the US", "worldwide", "LATAM", "contractor" | Pruebas unitarias con frases reales y con las 164 ubicaciones reales del seed; las ofertas descartadas por reglas no llegan al LLM |
| F3 | **Clasificador de elegibilidad con LLM** que devuelve un JSON validado con la etiqueta, los atributos y la evidencia textual del ADR 0004 | Salida validada con Zod, con meta de menos de 300 tokens; resultados cacheados por `content_hash + prompt_version + model`; tokens y costo equivalente registrados |
| F4 | **Conjunto de evaluación** (primer hito: 150 ofertas reales etiquetadas a mano) y comando `npm run eval` | Reporta precisión y recall de aplicables, matriz de confusión y costo por oferta. **Meta: precisión ≥ 95 % y recall ≥ 80 %** sobre un conjunto de prueba fijo con ≥ 60 aplicables (ADR 0004) |
| F5 | **Perfil del usuario** (país, CV en texto, habilidades, seniority, años de experiencia, preferencias) | Se edita desde la web o un archivo JSON. Nunca se envía a la capa gratuita de un LLM |
| F6 | **Puntaje de encaje** (0–100) con reglas deterministas, solo para ofertas aplicables y accesibles para el nivel del perfil: habilidades que coinciden, las que faltan y qué sube o baja el puntaje | Función pura con pruebas; sin llamadas al LLM (ADR 0005) |
| F7 | **Panel web** con la lista de ofertas aplicables ordenadas por encaje, filtros por país, nivel y antigüedad, indicador de vacantes de más de 180 días y detalle con la evidencia | Se puede usar a diario en menos de 10 minutos |
| F8 | **Cola con control de ritmo** que respeta los límites de la capa gratuita de Gemini | Reintenta ante 429, pausa al agotar la cuota diaria sin fallar en silencio y registra el uso diario por modelo (ADR 0005) |

### Fuera del MVP (versiones siguientes)

- Seguimiento de postulaciones (tracker). career-ops ya lo cubre; RemoteFit se enfoca en la elegibilidad.
- Boletín semanal: es la primera validación comercial, después de S11 (ADR 0005).
- Generar CV y carta adaptados a cada oferta (v0.2). Usa datos personales, así que no puede correr en una capa gratuita: requiere su propio ADR.
- Simulacros de entrevista en inglés por voz (v0.3).
- Búsqueda semántica con embeddings y pgvector (v0.2), sin enviar el perfil a capas gratuitas.
- Multiusuario y autenticación (v0.4, solo si se valida que otros lo quieren).
- Plan premium para usuarios: solo tras validar uso recurrente (ADR 0005).
- Aplicar automáticamente. **No se hará:** va contra la propuesta de calidad y contra los términos de varias plataformas.

## 5. Métricas de éxito del MVP

- El clasificador alcanza precisión de aplicables ≥ 95 % y recall ≥ 80 % en el conjunto de prueba fijo (ADR 0004). Si ningún modelo gratuito lo logra, se prioriza la precisión y se documenta la brecha (ADR 0005).
- Juan Manuel lo usa al menos 2 semanas seguidas para su búsqueda real.
- Reduce el tiempo para encontrar ofertas aplicables (medido por él: antes vs. después).

Después del MVP, la validación comercial es de ≥ 100 suscriptores al boletín en 8 semanas (ADR 0005).

## 6. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El LLM clasifica mal | Conjunto de evaluación, evidencia textual obligatoria, etiqueta `unclear` cuando no hay señales |
| Límites de la capa gratuita de Gemini | Prefiltro por reglas, caché, salida corta, cola con control de ritmo y pausa al agotar la cuota. Sin facturación vinculada no hay cobros posibles |
| Google cambia o retira la capa gratuita | Interfaz `LLMProvider` intercambiable; límites en configuración; pasar a pago requiere un nuevo ADR |
| Ningún modelo gratuito alcanza la métrica | Priorizar precisión (más `unclear`), mejorar prompt y prefiltro con datos, documentar la brecha |
| Privacidad en la capa gratuita | Solo se envía texto público de ofertas, nunca datos personales de usuarios |
| No alcanzar 60 aplicables en el conjunto de prueba | Informes marcados como provisionales; el conjunto crece con la ingesta hasta congelarse (ADR 0004) |
| Cambios en las APIs de los ATS | Un conector por ATS con pruebas basadas en respuestas reales guardadas (fixtures) |
| Términos de uso | Solo APIs públicas de empleadores; no se hace scraping de LinkedIn ni se redistribuye públicamente el texto de las ofertas (ADR 0002) |
| El límite del plan Pro de Claude | Tareas pequeñas, una sesión principal, subagentes solo cuando aportan (ver `docs/05-flujo-con-agentes.md`) |
