# RemoteFit

**AI copilot for Latin American developers hunting remote jobs at US companies.**
It reads job postings from public ATS APIs (Greenhouse, Lever, Ashby), uses an LLM to decide whether each one is actually open to candidates outside the US — with quoted evidence — and ranks the eligible ones by how well they fit your profile.

> 🚧 In development. Spanish docs in [`docs/`](docs/).

## Why
Most "remote" postings are silently US-only. Job boards and auto-apply tools don't tell you whether *you* can be hired from Colombia. RemoteFit filters for that first, then helps you apply to fewer, better-matched roles.

## How it works
1. **Ingest** postings from public ATS endpoints.
2. **Rule pre-filter** catches obvious signals for free ("US only", "W-2", "worldwide").
3. **LLM eligibility classifier** returns validated structured output (status, allowed regions, hiring model, timezone, salary, evidence, confidence), cached by content hash and prompt version.
4. **Fit scoring** against your profile.
5. **Dashboard** to review, filter and track applications.

Evaluated against a hand-labeled dataset (`npm run eval`): accuracy, confusion matrix and cost per posting.

## Stack
TypeScript · Node.js/Express · React + Vite + Tailwind · PostgreSQL + Drizzle · Zod · Vitest · LLM behind a provider interface.

## Docs
- [Getting started (ES)](docs/00-guia-inicio.md)
- [Vision & MVP](docs/01-vision-y-mvp.md) · [Architecture](docs/02-arquitectura.md) · [Data model](docs/03-modelo-de-datos.md) · [Backlog](docs/04-backlog.md) · [ADRs](docs/adr/)
