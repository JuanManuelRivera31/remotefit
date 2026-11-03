# Propuesta de empresas nuevas para el directorio (2026-11-03)

Estado: **pendiente de tu aprobación**. No se tocó `data/companies.json`. Fuente: informe del subagente `ats-researcher` (WebSearch/WebFetch), sin verificar por nosotros más allá de lo que se indica. Sirve para la cobertura del producto y para una futura test-v3 (ADR 0004, sección 6).

Criterios pedidos: ATS público (Greenhouse, Lever o Ashby), términos que permitan el uso, evidencia de contratación en LATAM, no repetida en el directorio.

## Candidatas (10)

| # | Empresa | ATS · token | Ofertas vigentes | Técnicas abiertas a LATAM (estimación) | Riesgos |
|---|---|---|---|---|---|
| 1 | Nortal | Greenhouse · `nortal` | 28 | ~10–11 (ubicación "Latin America" / "Latin America - Remote") | Consultora con mucho staffing; algunas dicen "Latin America" sin "Remote": verificar |
| 2 | Praxent | Greenhouse · `praxent` | 12 | 5 (QA y desarrollo "LATAM …", ubicación "Remote - International") | Servicios TI; "Remote - International" es ambiguo; posible contrato |
| 3 | Able | Greenhouse · `able` | 8 | 4 (ingeniería de IA y full-stack, "Remote, LATAM") | Muestra pequeña; identidad de la empresa sin verificar |
| 4 | ThriveCart | Greenhouse · `thrivecart` | 6 | 2 (QA, "Remote - LATAM") | Señal débil |
| 5 | Engine | Greenhouse · `engine` | 76 | 1 (Backend - LATAM) | Señal muy débil; casi todo EE. UU. |
| 6 | Yuno | Lever · `yuno` | ≥ 5 (truncado) | ≥ 3 (Core Payments, Go To Market Engineer, Solutions Engineer) | Fintech de pagos; payload grande |
| 7 | Empirical | Ashby · `empirical` | ≥ 8 (truncado) | 2 claras (AI Engineer LATAM) | Muchos roles freelance o por comisión: riesgo de clasificación de contratista |
| 8 | Puzzle Consulting Services | Ashby · `puzzle-consulting-services` | 3 | 2 (Remote Latam) | Consultora; la búsqueda mostró roles que la API ya no lista |
| 9 | Coderio | Lever · `coderio` | ≥ 5 (truncado) | ≥ 4 | Nearshore; varios roles son híbridos: filtrar por `workplaceType` |
| 10 | Bluelight Consulting | Lever · `bluelightconsulting` | no determinado (5,4 MB) | ≥ 10 | Mismo rol duplicado por país; algunos avisos muy viejos; payload enorme |

En reserva: Outpost (Ashby `outpost`), Wagmo (Ashby `wagmo`), TalentusGlobal (Lever), Jeeves (Lever `tryjeeves`, casi todo ventas). Descartadas: Global Talent Co (LATAM solo en roles no técnicos); GovWorx y Teravision (no verificadas); Vercel, Grafana Labs, Ramp y Linear (sin ofertas abiertas a LATAM en la respuesta); `dlocal`, `zapier` y `sentry` (404 con los tokens probados).

## Términos de uso: qué se verificó y qué no

- **ATS (las 10):** Greenhouse documenta el listado como público y sin autenticación (`docs.greenhouse.io/job-board.html`); Ashby documenta su API pública de postings (`developers.ashbyhq.com/docs/public-job-posting-api`) y su `robots.txt` solo bloquea `/api/`; Lever: `robots.txt` con `Allow: /` y `Crawl-delay: 1`, y el GET del listado no pide clave.
- **No verificado:** los términos de uso del sitio de cada empresa (nosotros solo consumimos el endpoint del ATS, ADR 0002). Hay que hacerlo antes de incorporar cada una.
- **Para que decidas (legal):** el `robots.txt` de Lever declara `Content-Signal: … ai-train=no`. Nuestro uso es clasificar con un modelo, no entrenar, pero implica términos/legal de una fuente: lo marca la Política de decisiones. Recomiendo confirmarlo antes de añadir las 3 empresas de Lever (Yuno, Coderio, Bluelight); Deuna, CI&T, Caseware y Oowlish ya usan Lever.

## Orden sugerido de incorporación (si apruebas)

1. **Ola 1** (payload pequeño y completo, prueba el pipeline): Nortal, Able, Praxent, ThriveCart; Engine solo como señal débil.
2. **Ola 2** (diversidad fintech/IA): Yuno, Empirical, Puzzle.
3. **Ola 3** (nearshore, mucho volumen): Coderio y Bluelight. Deduplicar por título + empresa y filtrar por `workplaceType`/ubicación antes de contar.

Notas: Lever con `mode=json` devuelve 5,4 MB para Bluelight (paginar o usar `skip`/`limit`); un token inexistente responde 404, útil para validar tokens.

## Qué necesito de ti

Aprobar (o recortar) la lista y confirmar el punto de Lever. Con eso agrego las empresas a `data/companies.json`, corro la ingesta y el prefiltro, y quedan disponibles para cobertura y para test-v3.
