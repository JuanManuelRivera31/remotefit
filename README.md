# RemoteFit

**AI copilot for Latin American developers hunting remote jobs at US and global companies.**
It reads job postings from public ATS APIs (Greenhouse, Lever, Ashby), uses an LLM to work out where each one actually hires — with quoted evidence — and ranks the ones you can apply to from your country by how well they fit your profile.

> 🚧 In development. Spanish docs in [`docs/`](docs/).

## Why
Most "remote" postings are silently US-only. Job boards and auto-apply tools don't tell you whether *you* can be hired from Colombia. RemoteFit answers that first, so you spend your time on fewer, better-matched roles.

## How it works
1. **Ingest** postings from public ATS endpoints.
2. **Rule pre-filter** catches obvious signals for free ("US only", "W-2", "worldwide").
3. **LLM eligibility classifier** returns short, validated structured output (label, countries, work model, seniority, hiring model, timezone, quoted evidence), cached by content hash, prompt version and model.
4. **Applicability** is computed in code from your country, with no LLM call.
5. **Fit scoring** against your profile uses deterministic rules, so personal data never reaches an LLM.
6. **Dashboard** to review postings and filter by country, level and age.

Evaluated against a hand-labeled dataset (`npm run eval`): precision and recall of applicable postings, confusion matrix and cost per posting. Runs only on the Gemini API free tier, behind a rate-limited queue.

## Stack
TypeScript · Node.js/Express · React + Vite + Tailwind · PostgreSQL + Drizzle · Zod · Vitest · Gemini API free tier behind a swappable provider interface.

## Docs
- [Getting started (ES)](docs/00-guia-inicio.md)
- [Vision & MVP](docs/01-vision-y-mvp.md) · [Architecture](docs/02-arquitectura.md) · [Data model](docs/03-modelo-de-datos.md) · [Backlog](docs/04-backlog.md) · [ADRs](docs/adr/)
