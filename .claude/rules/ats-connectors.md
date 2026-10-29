---
paths:
  - "packages/core/src/ats/**"
  - "packages/core/fixtures/**"
---

# Reglas para conectores ATS

- Un archivo por ATS (`greenhouse.ts`, `lever.ts`, `ashby.ts`) que exporta `fetchJobs(boardToken)` y `toNormalizedJob(raw, company)`.
- Los tipos de la respuesta se escriben a partir de un **fixture real** guardado en `packages/core/fixtures/<ats>/`, no de memoria.
- Las pruebas leen el fixture; ninguna prueba llama a la red.
- `fetch` con timeout, `User-Agent` identificable (`RemoteFit/0.1 (+github)`) y pausa entre empresas. Manejar 404 (tablero inexistente) sin romper la ingesta completa.
- Convertir el HTML de las descripciones a texto plano en `normalize/`, no en el conector.
- Ashby: descartar `isListed: false`. Lever: paginar con `skip`/`limit`.
