# Modelo de datos (PostgreSQL + Drizzle)

Borrador para la sesión S2. Los nombres de columnas van en `snake_case` en la base y en `camelCase` en TypeScript (Drizzle lo mapea).

```mermaid
erDiagram
    companies ||--o{ jobs : publica
    jobs ||--o{ eligibility_results : "se clasifica en"
    jobs ||--o{ fit_results : "se puntúa en"
    jobs ||--o| applications : "se sigue en"
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
        int job_id FK
        text content_hash
        text prompt_version
        text decided_by "rules | llm"
        text model
        text status
        jsonb allowed_regions
        text hiring_model
        boolean requires_us_work_authorization
        text timezone_requirement
        jsonb salary
        jsonb evidence
        text reasoning
        real confidence
        int tokens_in
        int tokens_out
        numeric cost_usd
        timestamptz created_at
    }
    profiles {
        serial id PK
        int version
        text cv_text
        jsonb skills
        text seniority
        jsonb preferences
        timestamptz created_at
    }
    fit_results {
        serial id PK
        int job_id FK
        int profile_id FK
        int score "0-100"
        jsonb matched_skills
        jsonb missing_skills
        text summary
        text prompt_version
        text model
        int tokens_in
        int tokens_out
        numeric cost_usd
        timestamptz created_at
    }
    applications {
        serial id PK
        int job_id FK "único"
        text status "saved | applied | interview | offer | rejected | discarded"
        text notes
        timestamptz updated_at
    }
```

## Índices y restricciones

- `jobs`: único `(source, external_id)`; índice en `is_active`, `last_seen_at`.
- `eligibility_results`: único `(job_id, content_hash, prompt_version)` → es la caché.
- `fit_results`: único `(job_id, profile_id, prompt_version)`.
- `applications`: único `job_id`.

## Consulta principal del panel

"Ofertas activas, con el último resultado de elegibilidad `eligible` o `likely_eligible`, con su último puntaje de encaje para el perfil actual, ordenadas por puntaje descendente."
Conviene implementarla como una vista o una consulta Drizzle con `DISTINCT ON (job_id)`.
