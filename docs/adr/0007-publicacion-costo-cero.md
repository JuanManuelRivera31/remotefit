# ADR 0007 — Publicación a costo cero: GitHub Actions + Neon + JSON estático + GitHub Pages

- **Estado:** Aceptado
- **Fecha:** 2026-11-04
- **Decisión de:** el dueño (plan S11 aprobado con las 3 recomendaciones de `docs/plan-s11.md`)
- **Relacionado con:** ADR 0002 (fuentes y qué se publica), ADR 0004 (versión aceptada), ADR 0005 (solo capa gratuita)

## Contexto

El MVP corría solo en local. Para publicarlo hay una restricción dura: **USD 0 y ningún servicio con tarjeta o facturación vinculada**. Los límites de cada proveedor se verificaron el 2026-11-04 en su documentación oficial (`docs/plan-s11.md`, tabla "Hallazgos verificados").

## Decisión

1. **Una tarea diaria programada** (`.github/workflows/daily.yml`, 09:17 UTC) corre `npm run pipeline` (ingest → prefilter → classify → export) contra una **PostgreSQL gratuita en Neon** y publica un **JSON estático** que la web filtra en el navegador con las mismas funciones puras de `@remotefit/core/api`. El sitio se sirve en **GitHub Pages**. No hay servidor encendido ni arranques en frío.
2. **Qué se publica** (ADR 0002): título, empresa, ubicación, etiqueta, países, nivel estimado, fechas y la **cita corta** (≤ 160 caracteres), con enlace al original. `PublicDataSchema` es estricto: un campo de más (por ejemplo, la descripción) hace fallar el export en vez de publicarse. Solo entran las vacantes que algún país de LATAM puede ver.
3. **Secretos:** `DATABASE_URL` y `GEMINI_API_KEY` solo como *repository secrets* de GitHub. Los forks no los reciben y el workflow no usa `pull_request_target`.
4. **Logs públicos:** el pipeline imprime solo conteos, ids, versiones y nombres de empresas del directorio. Cada línea pasa por `redactSecrets`, que tacha los valores de los secretos. Ante un error, solo se registra la clase, nunca el mensaje. Lo verifica `apps/api/src/pipeline/run.db.test.ts`, con texto de oferta y secretos marcados, incluido un error cuyo mensaje trae texto de la oferta.
5. **Cuota compartida:** el contador de solicitudes de Gemini vive en la base (`llm_usage_daily` + `llm_eval_reservation`, `SqlQuotaLedger`). Un eval local con `QUOTA_DATABASE_URL` apuntando a Neon y el classify del cron cuentan contra la misma cuota, y la reserva del eval tiene prioridad.
6. **Base de datos:** Neon Free (sin tarjeta; 1 GB por proyecto; no pausa ni borra por inactividad). **Respaldo documentado: Supabase Free.** Pausa el proyecto tras 7 días sin actividad (se restaura hasta 1 año después) y tiene un límite de 500 MB. Para cambiar basta con mover `DATABASE_URL`, porque las migraciones son PostgreSQL estándar. Pasos en `docs/despliegue.md`.

## El cron de 60 días

GitHub desactiva los workflows programados de un repo público tras 60 días sin actividad. Se verificó en la documentación oficial (2026-11-04) que **no está documentado** si un commit hecho por el propio workflow cuenta como actividad. Por eso, como decidió el dueño, **no hay commits diarios automáticos**. En su lugar:

- Se puede arrancar a mano (`workflow_dispatch`).
- Si los datos tienen más de 3 días, el sitio muestra el aviso "Datos desactualizados".
- El workflow llama al endpoint documentado `PUT /repos/{owner}/{repo}/actions/workflows/{id}/enable` (`actions: write`). Es barato, pero no está garantizado que reinicie el plazo.
- GitHub tampoco documenta que avise por correo al desactivarlo.

## Plan B: el pipeline en el PC del dueño

Los términos de Actions excluyen usarlo "as part of a serverless application" o para actividades "unrelated to the production, testing, deployment, or publication of the software project". Un pipeline diario que publica los datos del propio proyecto es zona gris. Si GitHub lo objeta:

1. El pipeline corre en el PC con el Programador de tareas de Windows (`npm run pipeline`, contra Neon), a las 03:30 de Colombia (después del reinicio de la cuota).
2. La variable del repo `PIPELINE_MODE` pasa a `publish-only`. Desde ese momento, GitHub solo exporta lo que ya está en la base y publica el sitio, sin llamar a Gemini ni a los ATS. Eso es exactamente "publication of the software project".
3. Si también hubiera que dejar GitHub Pages, el sitio es estático y sirve en Cloudflare Pages tal cual (sin verificar si pide tarjeta).

Pasos exactos en `docs/despliegue.md`.

## Consecuencias

- **Costo:** USD 0 mientras el repo sea público (Pages y los runners estándar son gratis en repos públicos) y el uso quepa en Neon Free y en la capa gratuita de Gemini (400 solicitudes al día con el margen del 20 %).
- **Retraso de los datos:** hasta un día. El cron puede retrasarse en horas de carga.
- **Si el sitio llega a monetizarse**, por ejemplo con el boletín con ingresos, hay que salir de GitHub Pages: sus términos excluyen "online business" y SaaS comercial.
- El historial de git se reescribió el 2026-11-04 antes de hacer público el repo. Se cambiaron los fixtures por texto sintético y el autor quedó con el correo `noreply` de GitHub. El respaldo completo previo está fuera del repo, en `C:\remotefit-respaldo-20261104\`.
