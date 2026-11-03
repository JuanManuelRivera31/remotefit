# ADR 0006 — Lever en pausa: `ai-train=no` frente a la capa gratuita de Gemini

- **Estado:** Aceptado (pausa; revisable)
- **Fecha:** 2026-11-03
- **Decisión de:** el dueño
- **Relacionado con:** ADR 0002 (fuentes), ADR 0003/0005 (solo capa gratuita de Gemini)

## Contexto

RemoteFit clasifica el texto público de las ofertas con la capa gratuita de la API de Gemini, cuyos términos permiten usar el contenido enviado para mejorar los modelos (es decir, para entrenar). Verificado con `curl` el 2026-11-03:

- `https://jobs.lever.co/robots.txt` (páginas públicas de empleo de Lever) declara `Content-Signal: search=yes,ai-train=no,use=reference`.
- `https://api.lever.co/robots.txt` (la API de postings que consumimos) dice solo `User-agent: *` / `Allow: /`, sin `Content-Signal`. El README de la API de Lever dice que los puestos "may be scraped by third parties".
- Greenhouse (`boards-api.greenhouse.io`: solo `Disallow: /embed/`) y Ashby (`jobs.ashbyhq.com`: solo `/meeting/`, `/b/`, `/api/`; `api.ashbyhq.com/robots.txt` responde 401) no declaran `ai-train`.

El `Content-Signal` es una preferencia, no un contrato, y la API de Lever no lo repite. Aun así, enviar a una capa que puede entrenar con el contenido ofertas cuyo operador pidió `ai-train=no` va contra el espíritu de esa señal.

## Decisión

1. **No se incorporan empresas nuevas que publiquen en Lever** mientras el clasificador dependa de la capa gratuita de Gemini. Quedan en pausa las candidatas Yuno, Coderio y Bluelight Consulting (y las de reserva TalentusGlobal y Jeeves).
2. **No se quitan todavía** las empresas de Lever que ya están en `data/companies.json` ni sus casos del conjunto de evaluación: es una decisión pendiente del dueño (ver "Seguimiento").
3. Se revisa si cambia alguna de estas condiciones: (a) el clasificador pasa a un proveedor que no entrene con el contenido (requiere otro ADR, porque hoy está prohibido salir de la capa gratuita de Gemini); (b) Lever declara permiso explícito en la API; (c) el dueño decide que la señal de `jobs.lever.co` no aplica a la API.

## Consecuencias

- **Positivas:** coherencia entre lo que declaran los operadores y lo que hacemos con su texto; sin riesgo de reputación en un repo público.
- **Negativas:** se pierde cobertura de empresas nearshore que usan Lever.
- **Seguimiento (existente):** hoy el directorio activo tiene 4 empresas de Lever: Deuna, CI&T, Oowlish y Caseware (Koombea, inactiva, también figura como Lever). Sus ofertas ya se enviaron a Gemini en las evaluaciones: el conjunto de evaluación tiene **68 casos de Lever de 317** (42 en desarrollo, 26 en test-v2: CI&T 19, Caseware 4, Deuna 3), incluidos Pigment y Palantir. Quitarlas del directorio y del eval cambiaría las métricas y es decisión del dueño.
