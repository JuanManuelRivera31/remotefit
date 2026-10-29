---
name: cierre-de-sesion
description: Cierra una sesión de trabajo dejando el estado del proyecto documentado para retomarlo después en una conversación nueva.
disable-model-invocation: true
---

# Cierre de sesión

1. Marca como terminada la sesión correspondiente en `docs/04-backlog.md` solo si cumple su criterio de "Hecho cuando". Si quedó a medias, no la marques y explica qué falta.
2. Añade una entrada al inicio de la bitácora en `docs/progreso.md` con este formato:
   ```
   ## AAAA-MM-DD · Sesión <id> · <título>
   - Hecho: ...
   - Decisiones: ... (y si merecen un ADR nuevo en docs/adr/)
   - Métricas: (eval, cobertura, costo LLM si aplica)
   - Pendiente / problemas: ...
   - Siguiente paso: <id de la próxima sesión> — <prompt sugerido para empezarla>
   ```
3. Si cambió algo que contradiga `CLAUDE.md` o la arquitectura, propón la edición (no la apliques sin mi aprobación).
4. Si hay cambios sin commit, recuérdame ejecutar `/commit`.
5. Termina recordándome usar `/clear` antes de la siguiente tarea para empezar con el contexto limpio y ahorrar uso del plan.
