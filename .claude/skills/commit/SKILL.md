---
name: commit
description: Verifica y crea un commit con formato Conventional Commits para los cambios actuales.
disable-model-invocation: true
allowed-tools: Bash(git add *), Bash(git commit *), Bash(git status *), Bash(git diff *), Bash(npm run lint), Bash(npm run typecheck), Bash(npm test)
---

# Commit

## Estado actual

!`git status --short`

!`git diff HEAD --stat`

## Instrucciones

1. Si existe `package.json` en la raíz, ejecuta `npm run lint`, `npm run typecheck` y `npm test`. Si algo falla, **no hagas commit**: muéstrame el error y propone la corrección.
2. Revisa que no se incluyan `.env`, `data/profile.json`, claves ni archivos generados. Si aparece alguno, detente y avísame.
3. Si los cambios mezclan temas distintos, propón dividirlos en varios commits.
4. Escribe el mensaje en inglés con Conventional Commits: `tipo(alcance): descripción en imperativo` (≤ 72 caracteres) y, si aporta, un cuerpo breve con el porqué.
5. Haz `git add` de los archivos relevantes y el commit. No hagas `push`.
6. Muéstrame el mensaje y el hash resultante.
