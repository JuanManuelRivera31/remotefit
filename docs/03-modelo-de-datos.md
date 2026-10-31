# Modelo de datos (PostgreSQL + Drizzle)

Borrador para la sesión S2. Los nombres de columnas van en `snake_case` en la base y en `camelCase` en TypeScript (Drizzle lo mapea).

```mermaid
erDiagram
    companies ||--o{ jobs : publica
    jobs }o--o{ eligibility_results : "comparten content_hash"
    jobs ||--o{ fit_results : "se puntúa en"
    profiles ||--o{ fit_results : "versión usada"

    companies {
        serial id PK
        text name
        text ats "greenhouse | lever | ashby"
        text board_token "identificador del tablero"
        boolean active
        timestamptz created_at
    }
    jobs {
        serial id PK
        int company_id FK
        text source "greenhouse | lever | ashby"
        text external_id
        text requisition_id "del ATS, si lo expone"
        text sibling_group "agrupa la misma vacante por país"
        text title
        text location_raw
        text workplace_type "remote | hybrid | onsite | null"
        text url
        text description_text
        jsonb raw "respuesta original"
        text content_hash
        timestamptz posted_at
        timestamptz first_seen_at
        timestamptz last_seen_at
        boolean is_active
    }
    eligibility_results {
        serial id PK
        text content_hash
        text prompt_version "RULES_VERSION si decidió el prefiltro"
        text model "'rules' si decidió el prefiltro"
        text decided_by "rules | llm"
        text label
        jsonb countries
        jsonb excluded_countries
        text work_model
        boolean work_model_conflict
        text seniority
        int min_years_experience
        text hiring_model
        text timezone_requirement
        boolean requires_us_work_authorization
        text posting_language
        jsonb evidence
        int tokens_in
        int tokens_out
        numeric equivalent_cost_usd
        timestamptz created_at
    }
    profiles {
        serial id PK
        int version
        text country "ISO alpha-2"
        text cv_text "nunca se envía a un LLM"
        jsonb skills
        text seniority
        int years_experience
        jsonb preferences
        timestamptz created_at
    }
    fit_results {
        serial id PK
        int job_id FK
        int profile_id FK
        text scoring_version
        int score "0-100"
        jsonb matched_skills
        jsonb missing_skills
        jsonb breakdown "qué sube o baja el puntaje"
        timestamptz created_at
    }
    llm_usage_daily {
        date usage_date PK "día de cuota del proveedor"
        text provider PK
        text model PK
        int requests
        int rate_limited "respuestas 429"
        int tokens_in
        int tokens_out
        numeric equivalent_cost_usd
    }
```

## Índices y restricciones

- `jobs`: único `(source, external_id)`; índice en `is_active`, `last_seen_at`, `content_hash`, `sibling_group`.
- `eligibility_results`: único `(content_hash, prompt_version, model)` → es la caché. No lleva `job_id`, para que ofertas con contenido idéntico compartan un solo resultado; la relación con `jobs` es por `content_hash`. `model` nunca es nulo, porque en PostgreSQL los nulos no chocan en un índice único.
- `fit_results`: único `(job_id, profile_id, scoring_version)`.
- `llm_usage_daily`: clave primaria `(usage_date, provider, model)`. Se incrementa en cada llamada, incluidos los reintentos. Va por modelo porque el RPD es por modelo; el costo diario por proveedor se obtiene sumando.

## Notas

- **`sibling_group`:** se calcula en la ingesta con `company_id + requisition_id`, o con `company_id + título normalizado` sin sufijos de región como "(LATAM)" o "(Colombia)" si no hay `requisition_id`. Solo 144 de las 671 ofertas del seed lo traen. El respaldo por título puede unir vacantes distintas con el mismo nombre: verificarlo con datos reales en S4.
- **`llm_usage_daily.usage_date`:** usa el día de cuota del proveedor, no el día local. Según recuerdo, Gemini lo renueva a medianoche hora del Pacífico; confirmarlo en S6b.
- **Cola:** no tiene tabla propia. Lo pendiente son las ofertas activas sin resultado para la clave actual, ordenadas por `first_seen_at` descendente: las nuevas quedan primero.
- **`applications`:** no existe en el MVP. El seguimiento de postulaciones está fuera de alcance (docs/06, sección 4.4).

## Consulta principal del panel

"Ofertas activas con su resultado de elegibilidad vigente y su último puntaje de encaje para el perfil actual, ordenadas por puntaje descendente."

Se implementa en dos pasos. Primero, una consulta Drizzle con `DISTINCT ON (content_hash)` trae las ofertas activas con su resultado, filtrando por nivel y antigüedad. Después, `isApplicable(result, profile.country)` filtra en código, en la API: esa regla es dominio puro y no debe duplicarse en SQL. El volumen del MVP, cientos de ofertas, lo permite.
