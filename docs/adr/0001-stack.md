# ADR 0001 — Stack: TypeScript de punta a punta

- **Estado:** aceptada
- **Fecha:** 2026-10-29

## Contexto
Desarrollador único, con experiencia previa en React, TypeScript, Node/Express y PostgreSQL. El objetivo de aprendizaje es la integración de LLMs y automatización, no un framework nuevo. El trabajo se hace con Claude Code en un plan Pro con límite de uso.

## Decisión
Monorepo con npm workspaces: `apps/api` (Express), `apps/web` (React + Vite), `packages/core` (dominio). PostgreSQL con Drizzle. Zod para validar entradas HTTP y salidas del LLM. Vitest para pruebas.

## Alternativas consideradas
- **Python (FastAPI) para la parte de IA:** buen ecosistema de IA, pero dos lenguajes duplican el contexto que Claude Code debe manejar y el esfuerzo del desarrollador.
- **Next.js full-stack:** menos piezas, pero mezcla UI y lógica de dominio; el pipeline de ingesta y clasificación encaja mejor como comandos independientes.
- **MongoDB:** los datos son relacionales (empresa → oferta → resultados) y las consultas del panel se benefician de SQL.

## Consecuencias
- Tipos compartidos entre API y web.
- La lógica de IA queda aislada en `packages/core`, lista para mostrarse en el portafolio y probarse sin servidor.
