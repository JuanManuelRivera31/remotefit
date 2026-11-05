# ADR 0002 — Fuentes de ofertas: APIs públicas de ATS

- **Estado:** aceptada
- **Fecha:** 2026-10-29

## Contexto
Necesitamos ofertas actualizadas de empresas de EE. UU. LinkedIn prohíbe la automatización y el scraping. Muchas empresas publican sus vacantes a través de sistemas de contratación (ATS) que ofrecen endpoints públicos sin autenticación.

## Decisión
Empezar con tres ATS mediante sus endpoints públicos de tableros de empleo:

| ATS | Endpoint | Notas |
|---|---|---|
| Greenhouse | `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true` | `content=true` incluye la descripción (HTML escapado) |
| Lever | `GET https://api.lever.co/v0/postings/{site}?mode=json` | Paginación con `skip` y `limit`; tableros europeos usan `api.eu.lever.co`; `salaryRange` opcional |
| Ashby | `GET https://api.ashbyhq.com/posting-api/job-board/{job_board_name}?includeCompensation=true` | Excluir `isListed: false`; expone tipo de lugar de trabajo y compensación cuando la empresa la publica |

La lista de empresas a seguir vive en `data/companies.json` y se mantiene a mano (con ayuda del subagente `ats-researcher`).

## Verificación pendiente (sesión S3)
Los nombres exactos de los campos deben confirmarse con respuestas reales. En S3 se descarga una respuesta de cada ATS, se guarda en `packages/core/fixtures/` y las pruebas se escriben contra esos archivos.

## Consecuencias
- Datos legales y estables, sin navegador automatizado.
- Cobertura limitada a empresas que usan estos ATS (muchas startups de EE. UU. lo hacen). Workable y Recruitee también tienen endpoints públicos y pueden añadirse con la skill `/nueva-fuente-ats`.
- Respetar límites: pausa entre peticiones, `User-Agent` identificable, no redistribuir públicamente el texto de las ofertas. Publicar título, empresa, etiqueta y enlace al original se permite solo tras revisar los términos de cada ATS (ADR 0005).

## Actualización 2026-10-31: vigencia y crecimiento del directorio

Cierra la sección 4.5 de `docs/06-diseno-v0.1.md`.

### Vigencia
- Las ofertas abiertas se re-verifican **a diario** con una petición HTTP al ATS, sin LLM. Al descargar el board completo basta una petición por empresa, no una por oferta.
- Si la oferta responde 404 o desaparece de un board que respondió bien, se marca como cerrada y se oculta. **No se borra:** conserva su historial y su clasificación.
- Un error temporal (5xx, timeout) o un fallo del board completo, incluido un 404 del board, no cierra ninguna oferta: se avisa en el resumen y se reintenta al día siguiente. Un 404 del board suele indicar que la empresa cambió de identificador o de ATS, no que todas sus vacantes cerraron.
- Si una oferta cerrada reaparece, se reabre.

### Directorio
- `data/companies.json` crece por **curación manual**.
- Cada semana, el scan propone empresas candidatas. Juan Manuel las aprueba antes de agregarlas: nada entra al directorio de forma automática.

## Actualización 2026-11-04: revisión de términos para publicar (S11)

Se revisaron los términos de los tres ATS antes de publicar el sitio, según la regla de arriba. Solo se leyeron páginas oficiales, el 2026-11-04. Qué se publica: título, empresa, ubicación, etiqueta, una **cita de hasta 160 caracteres** y el **enlace a la oferta original**. Nunca la descripción completa ni el extracto de unos 400 caracteres de la vista local.

| ATS | Veredicto | Evidencia |
|---|---|---|
| Greenhouse | Sin prohibición; la documentación lo permite | Docs del Job Board API: "Job Board data is publicly available, so authentication is not required for any GET endpoints". El Master Subscription Agreement obliga al cliente ("Customer will not...") y aclara que "There are no third-party beneficiaries". Ningún `robots.txt` bloquea la API (`boards-api` solo bloquea `/embed/`). |
| Lever | Sin prohibición; la documentación lo permite | README de la API de postings: "This API is designed to help you create a job site" y "These jobs may be scraped by third parties". `api.lever.co/robots.txt`: `Allow: /`. `jobs.lever.co/robots.txt` declara `search=yes`, y la definición de "search" incluye devolver "hyperlinks and short excerpts". |
| Ashby | Sin prohibición, pero tampoco permiso explícito | La documentación de la API pública de postings solo habla de clientes que arman su propia página de empleo. Los términos obligan al cliente. No se pudo leer `api.ashbyhq.com/robots.txt` (devolvió HTTP 401). Es la fuente más débil de las tres. |

En los tres casos, los términos encontrados vinculan a la empresa cliente, no a quien lee la API pública. Salvaguardas que se mantienen: atribuir la empresa y enlazar el original, no republicar descripciones, respetar el `Crawl-delay: 1` de Lever, ocultar las ofertas cerradas y **retirar cualquier oferta o empresa que lo pida** (issue de GitHub "Retirar o corregir una oferta"). Si un ATS cambia sus términos, se revisa este veredicto.
