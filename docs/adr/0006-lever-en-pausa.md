# ADR 0006 — Lever: pausa y levantamiento (2026-11-03)

- **Estado:** Aceptado. La pausa se **levantó** el 2026-11-03; se revisa si Lever cambia sus términos o su API (ver "Condiciones de revisión").
- **Fecha:** 2026-11-03 (pausa y levantamiento, el mismo día)
- **Decisión de:** el dueño
- **Relacionado con:** ADR 0002 (fuentes), ADR 0003/0005 (solo capa gratuita de Gemini)

## Contexto

RemoteFit clasifica el texto público de las ofertas con la capa gratuita de la API de Gemini, cuyos términos permiten usar el contenido enviado para mejorar los modelos. Verificado con `curl` el 2026-11-03:

- `https://jobs.lever.co/robots.txt` (las páginas públicas de empleo de Lever) declara `Content-Signal: search=yes,ai-train=no,use=reference`.
- `https://api.lever.co/robots.txt` (la API de postings que consumimos) dice solo `User-agent: *` / `Allow: /`, sin `Content-Signal`.
- Greenhouse (`boards-api.greenhouse.io`: solo `Disallow: /embed/`) y Ashby (`jobs.ashbyhq.com`: solo `/meeting/`, `/b/`, `/api/`; `api.ashbyhq.com/robots.txt` responde 401) no declaran `ai-train`.

El 2026-11-03 el dueño pausó las empresas de Lever por prudencia: el `Content-Signal` de `jobs.lever.co` pide no entrenar, y la capa gratuita de Gemini puede usar el contenido para entrenar.

## Decisión (2026-11-03): se levanta la pausa

Razones del dueño, verificadas:

1. **Usamos `api.lever.co`, que no declara `ai-train=no`.** La señal está en el sitio de empleo (`jobs.lever.co`), no en la API que consumimos.
2. **Solo clasificamos; no entrenamos.** El `Content-Signal` regula el entrenamiento de modelos (`ai-train`); el uso para inferencia no está declarado como restringido.
3. **Son ofertas públicas.** La documentación de la API de postings de Lever (README de `github.com/lever/postings-api`, revisado el 2026-11-03) dice: "all job postings in the `published` state are publicly viewable. These jobs may be scraped by third parties". **No restringe el uso por terceros**; su único límite concreto es el de 2 solicitudes POST por segundo para *crear postulaciones*, que no usamos (solo hacemos GET, con pausa de 1 s entre boards y `Crawl-delay: 1` respetado). No hay archivo de licencia en ese repositorio.

Consecuencias de la decisión:

- Las empresas de Lever vuelven a tratarse como cualquier otra fuente: Deuna, CI&T, Oowlish y Caseware siguen activas, y los **26 casos de Lever se quedan en test-v2** (CI&T 19, Caseware 4, Deuna 3). Las candidatas Yuno, Coderio y Bluelight Consulting (y TalentusGlobal y Jeeves, en reserva) vuelven a la cola de revisión de términos de `docs/propuesta-empresas-2026-11.md`; no se agregan al directorio sin esa revisión.
- Se sigue enviando al LLM **solo texto público de la oferta**, nunca datos personales (regla del proyecto).

## Condiciones de revisión

Este ADR se reabre si ocurre cualquiera de estas:

- Lever cambia sus términos de uso, la documentación de la API de postings o su `robots.txt` (por ejemplo, un `Content-Signal` o un `Disallow` en `api.lever.co`, o una cláusula contra el uso por terceros).
- Lever, o una empresa cliente, pide que se deje de usar su contenido.
- El clasificador cambia de proveedor o de capa (hoy está prohibido salir de la capa gratuita de Gemini sin otro ADR).

Revisión periódica: al incorporar una empresa nueva de Lever y, como mínimo, cada trimestre, volver a leer el `robots.txt` de `api.lever.co` y el README de la API.

## Consecuencias

- **Positivas:** se conserva la cobertura de empresas nearshore que publican en Lever y no cambian las métricas del eval.
- **Negativas:** persiste el riesgo, asumido por el dueño, de que alguna empresa de Lever prefiera que su texto no pase por una capa que puede entrenar; se mitiga con la condición de revisión de arriba.
