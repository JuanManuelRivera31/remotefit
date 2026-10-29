---
paths:
  - "apps/web/**"
---

# Reglas para el panel web

- Componentes funcionales con TypeScript; datos del servidor solo con TanStack Query.
- Los tipos de la API se importan de `packages/core`, no se duplican.
- Tailwind para estilos; nada de librerías de componentes pesadas en el MVP.
- La vista principal debe responder en menos de 1 s con 500 ofertas; paginar o virtualizar si hace falta.
- Mostrar siempre la evidencia del clasificador junto al estado: el usuario debe poder verificar por qué una oferta es elegible.
