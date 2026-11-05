# Plan S11: publicación a costo cero (propuesta, 2026-11-04)

Estado: **pendiente de tu aprobación**. No se escribió código de S11. Este plan va antes de S8 (puntaje), por tu decisión.

## Restricción

USD 0 y **sin tarjeta ni facturación vinculada en ningún servicio**. Los límites que siguen se verificaron el 2026-11-04 leyendo la documentación oficial de cada proveedor, sin blogs. Las citas son textuales y van en inglés, como en el original. Lo que no se pudo verificar dice "sin verificar".

## Hallazgos verificados

| Servicio | Lo que importa | Fuente oficial |
|---|---|---|
| GitHub Actions (repo público) | Runners estándar gratis en repos públicos; un job puede durar hasta 6 h. **Riesgos:** el cron "can be delayed during periods of high loads", sobre todo al inicio de cada hora, y algunos jobs "may be dropped". Además, "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days". Los logs los ve cualquiera con sesión iniciada. Los secretos se ocultan en los logs y "are not passed to the runner when a workflow is triggered from a forked repository". | docs.github.com: billing/github-actions, actions/reference/limits, events-that-trigger-workflows, use-workflow-run-logs, use-secrets |
| GitHub Actions (términos) | Prohíben usarlo "as part of a serverless application" o para actividades "unrelated to the production, testing, deployment, or publication of the software project". Un pipeline diario que publica los datos del propio proyecto es zona gris. | docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features |
| GitHub Pages | Gratis en repos públicos: sitio ≤ 1 GB, ancho de banda suave de 100 GB/mes, despliegue recomendado con `actions/deploy-pages`. **No permitido** como "free web hosting service to run your online business" ni para SaaS comercial. Un hobby gratuito cabe; el boletín con ingresos no. | docs.github.com/en/pages (limits, publishing source) |
| Neon (Postgres) | "$0/month", "no credit card required"; 1 GB por proyecto; 100 CU-hours/mes por proyecto (si se agotan, el cómputo se suspende hasta el mes siguiente); scale-to-zero a los 5 min; **"doesn't pause Free projects for inactivity"**; "None of these limits delete your data". | neon.com/pricing, neon.com/docs/introduction/plans |
| Supabase (Postgres) | 500 MB por base; **"Free projects are paused after 1 week of inactivity"** (se restauran hasta 1 año después). Sin verificar si pide tarjeta. | supabase.com/pricing, docs/guides/platform/free-project-pausing |
| Prisma Postgres | "$0", "No credit card required", 2 GB, **200k operaciones/mes**: justo para una ingesta diaria con miles de upserts. | prisma.io/pricing |
| Caché y artifacts de Actions | Caché: 10 GB, se borra lo que no se usa en 7 días y es inmutable. Artifacts: duran 90 días como máximo. **Ninguno de los dos sirve como base de datos.** | docs.github.com (dependency-caching, artifact retention) |
| Cloudflare Pages / Netlify / Vercel | Cloudflare: 500 builds/mes y assets estáticos gratis e ilimitados; sin verificar si pide tarjeta. Netlify: 300 créditos/mes y cada despliegue de producción gasta 15, así que **uno diario se pasa del límite** y pausa el sitio. Vercel Hobby: "non-commercial personal use only". | developers.cloudflare.com, netlify.com/pricing, vercel.com/docs/plans/hobby |
| Gemini, capa gratuita | No pide facturación. El RPD se reinicia a medianoche del Pacífico y el límite es por proyecto, no por clave. En la capa gratuita, "Content used to improve our products" y "human reviewers may read ... your API input and output" (por eso solo enviamos texto público de ofertas). "You may use only Paid Services when making API Clients available to users in the European Economic Area": aquí el cliente de la API es nuestro pipeline, no los visitantes, pero lo anoto. EE. UU. y Colombia están en las regiones disponibles. | aistudio.google.com/docs (rate-limits, pricing, terms, available-regions) |

Tamaño real de la base local: **35 MB** (2250 ofertas; la columna `raw` ocupa 11 MB y `description_text` 6,8 MB). Cabe en el plan gratuito de Neon (1 GB).

## Arquitectura propuesta y alternativas

**Propuesta (A): GitHub Actions + Neon + JSON estático + GitHub Pages.** No hay servidor encendido ni arranques en frío.

```
cron diario (09:17 UTC, después de medianoche del Pacífico y lejos de :00)
  └─ job "pipeline" (secretos: DATABASE_URL de Neon, GEMINI_API_KEY)
       ingest → prefilter → classify (cuota de la base) → vigencia → export
       └─ export escribe public/data/jobs.json (solo lo publicable, ver abajo)
  └─ job "deploy": build de apps/web en modo estático + actions/deploy-pages
navegador: descarga jobs.json una vez y filtra con listJobs() de @remotefit/core/api
```

- **La web filtra en el navegador con el mismo código.** `listJobs`, `verdictFor` e `isApplicable` ya son funciones puras y sin Node (`@remotefit/core/api`). El modo estático solo cambia de dónde salen las filas: de un JSON en vez de la API. La API Express se queda para el desarrollo local. Con unas 1800 ofertas, el JSON pesa alrededor de 1 MB sin comprimir.
- **Vigencia.** La ingesta ya cierra las ofertas que desaparecen del tablero, y el export solo incluye las activas. Cada oferta lleva `lastVerifiedAt`.
- **Cuota.** Como el runner es efímero, el contador de cuota pasa a PostgreSQL (`QuotaLedger` sobre la base, ya anotado en el backlog). El eval local y el classify del cron comparten así el mismo contador y la misma reserva de "eval pendiente".
- **El eval no corre en CI.** Sigue siendo local, con tu aprobación.

| Alternativa | Veredicto |
|---|---|
| (B) Estado en caché o artifacts de Actions, sin base | Descartada: la caché se borra a los 7 días sin uso y los artifacts caducan; una semana sin cron significa perder el estado. |
| (C) Estado versionado en el repo (SQLite o JSON con commit diario) | Descartada: versionaría texto de ofertas (ADR 0002) y engordaría el historial. Además, los commits del bot no está claro que cuenten como "actividad". |
| (D) Servidor siempre encendido (Render, Fly, Railway...) | Descartada por tu restricción: hay arranques en frío o piden tarjeta. |
| (E) Supabase en lugar de Neon | Respaldo: se pausa tras 7 días sin actividad; si el cron falla una semana, el sitio sigue (es estático), pero la base queda pausada. |
| (F) Prisma Postgres | Respaldo: sin tarjeta, pero el tope de 200k operaciones al mes puede quedarse corto. |
| (G) Cloudflare Pages en lugar de GitHub Pages | Respaldo si Pages deja de servir (uso comercial). Sin verificar si pide tarjeta. Netlify queda descartada por los créditos. |
| (H) Pipeline en tu PC (Programador de tareas) y solo el despliegue en Pages | Respaldo si el uso de Actions como pipeline de datos se considera fuera de sus términos. |

**Recomendación: A.** Es la única combinación verificada con USD 0, sin tarjeta y sin pausas por inactividad en la base de datos.

## Riesgos y mitigación

1. **El cron se apaga a los 60 días sin actividad** en el repo. Mitigación: el workflow también acepta `workflow_dispatch` (arranque manual), el sitio muestra la fecha de la última actualización y una alerta (issue automático) avisa si el JSON tiene más de 3 días. Sin verificar: si los commits de un bot cuentan como actividad. No propongo commits automáticos para sortearlo.
2. **Logs públicos.** Los comandos del pipeline imprimen solo conteos e ids, nunca texto de ofertas ni prompts; hay que revisarlo una vez antes de publicar. El workflow no usa `pull_request_target`, tiene `permissions` mínimos (`contents: read`, `pages: write`, `id-token: write`) y corre solo en la rama principal.
3. **Gemini.** Una cuenta, un proyecto y 400 RPD (con el margen del 20 %). Lo que no quepa queda pendiente para el día siguiente; esa lógica ya existe.
4. **Términos de Actions y Pages.** Hobby sin ingresos: si llega el boletín con monetización, hay que mudarse (G o H).

## Secretos

`GEMINI_API_KEY` y `DATABASE_URL` van **solo** como *repository secrets* de GitHub (o como *environment secrets* de un entorno `production`), nunca en el código ni en `.env.example`. Los forks no los reciben. Gitleaks se agrega como paso del CI en cada push.

## Preparar el repo para hacerlo público

### 1. Escaneo de secretos (hecho, solo lectura)

- **Gitleaks v8.28.0** (imagen oficial de Docker, con `--redact`) sobre **todas las ramas: 73 commits sin merge, 2,3 MB → "no leaks found"**.
- Barrido propio sobre todo el historial: **0 claves de Google** (`AIza...`), ningún `.env` versionado (solo `.env.example`) y ninguna asignación de `GEMINI_API_KEY` con un valor real.
- Las URLs de Postgres del historial son las credenciales locales de Docker (`remotefit:remotefit@localhost`), que no son secretos.
- **Privacidad:** los 94 commits llevan como autor tu correo personal de Gmail. Si el repo se hace público, queda visible. Ocultarlo exige reescribir el autor en todo el historial (va junto con el punto 2).

### 2. Texto de ofertas versionado (hallazgo)

- **4 fixtures de conectores** (`packages/core/fixtures/{greenhouse/sezzle,greenhouse/sezzle-siblings,ashby/addi,lever/deuna}.json`) son respuestas reales de los ATS con **las descripciones completas de 27 ofertas**, y están en el historial desde S3. El ADR 0002 dice "no redistribuir públicamente el texto de las ofertas": un repo público las redistribuiría.
- **Riesgo menor:**
  - `cases.json` solo tiene ids, etiquetas y citas de ≤ 25 palabras (la cadena más larga es una nota de 269 caracteres).
  - `titles.json` y `locations.json` tienen títulos y ubicaciones.
  - Los docs (ADR, bitácora, auditorías) y las capturas de `docs/capturas/` muestran títulos y citas cortas.
  - Eso es lo mismo que publicaría el sitio, así que lo cubre la revisión de términos del punto 3.
- **Corrección propuesta:** reemplazar las descripciones de los 4 fixtures por texto sintético con la misma estructura (las pruebas usan campos y forma, no el contenido literal; las que comparan hashes se regeneran). Para el historial, una de dos (decisión 1).

### 3. Qué publica el sitio (ADR 0002 y 0005)

Publicar título, empresa, etiqueta y enlace "se permite solo tras revisar los términos de cada ATS".

- **Ya revisado:** el README de la API de postings de Lever dice que los puestos son públicos y "may be scraped by third parties".
- **Pendiente:** revisar Greenhouse y Ashby antes del primer despliegue.
- **Propuesta mínima para el JSON público:** título, empresa, ubicación, etiqueta, países, nivel estimado, antigüedad, `lastVerifiedAt`, **la cita (≤ 160 caracteres)** y el enlace. **Sin** el extracto de unos 400 caracteres del detalle, que en local sigue funcionando.

### 4. README en inglés (después de tu aprobación)

- El problema.
- La arquitectura (diagrama y por qué cada pieza).
- El proceso de evaluación, con cifras e intervalos de Wilson:
  - **test-v1** (v3, 92,2 % [83,0–96,6], no aceptada);
  - **test-v2** (v4 + postprocess-v2, 90,7 % [82,7–95,2], no aceptada, retirada);
  - **test-v3** (v4 + postprocess-v3, **97,8 % [92,3–99,4] / recall 95,7 % [89,3–98,3], aceptada**).
  - También: por qué se retira una prueba ya vista, que las etiquetas son **asistidas por LLM (Claude leyendo el cuerpo completo, con cita literal verificada por código) y solo una muestra la revisó el dueño**, y que la precisión solo está medida para Colombia.
- Las capturas.
- Cómo correrlo: Docker, `.env`, migraciones, ingest, prefilter, classify, `npm run dev` y las pruebas.

## Sesiones

| Paso | Contenido | Hecho cuando |
|---|---|---|
| S11a | Limpieza para publicar: fixtures sintéticos, historial según la decisión 1, Gitleaks en CI, README en inglés | Gitleaks limpio, ningún texto de oferta completo en `git log --all`, README revisado por ti |
| S11b | `QuotaLedger` sobre PostgreSQL (migración) y `npm run export` (JSON público validado con un esquema Zod del contrato) | Pruebas contra `remotefit_test`; el JSON no contiene descripciones |
| S11c | Modo estático de la web (fuente JSON + `listJobs` en el navegador), con el mismo aspecto y las mismas pruebas | `npm run build` produce un sitio que funciona servido desde una carpeta, sin la API |
| S11d | Workflow diario + Neon + Pages: tú creas la cuenta de Neon (sin tarjeta) y cargas los secretos; yo dejo el workflow con `workflow_dispatch` | Una corrida manual completa: la base se actualiza, el JSON se publica y el sitio muestra la fecha |
| S11e | Revisión de términos de Greenhouse y Ashby para publicar título, cita y enlace | Veredicto documentado en el ADR 0002 antes del primer despliegue público |

## Decisiones tuyas (la recomendación primero)

1. **Historial con los fixtures y tu correo.**
   - *Recomendado:* reescribir el historial con `git filter-repo`: fixtures sintéticos en todos los commits y autor con tu correo `noreply` de GitHub. Después, push forzado a `main` y borrado de las ramas remotas viejas. Requiere tu autorización explícita, porque reescribe la historia.
   - Alternativa: crear un repo público nuevo desde un único commit limpio y dejar este privado con su historia.
2. **Contenido público.**
   - *Recomendado:* la cita corta, sin el extracto de unos 400 caracteres, y la revisión de términos de Greenhouse y Ashby (S11e) antes del primer despliegue.
   - Alternativa: publicar también el extracto.
3. **Base de datos.**
   - *Recomendado:* Neon Free, con Supabase como respaldo.
   - Alternativa: Prisma Postgres.
