# Guía de inicio: trabajar con Claude Code en la consola (Windows)

Esta guía te lleva de cero a tu primera sesión de trabajo. Hazla en orden; la primera vez toma 30–60 minutos.

---

## Paso 1 · Instalar las herramientas base

1. **Git para Windows** — https://git-scm.com/download/win
   Instálalo con las opciones por defecto. Claude Code usa la terminal *Git Bash* que viene incluida para ejecutar comandos.
2. **Node.js (versión LTS, 22 o superior)** — https://nodejs.org
   Verifica en una terminal nueva: `node --version` y `npm --version`.
3. **VS Code** (recomendado para ver y editar archivos) — https://code.visualstudio.com
4. **Terminal:** Windows Terminal ya viene en Windows 11 y permite pestañas. **Warp** es opcional; sirve igual.

## Paso 2 · Instalar Claude Code

Abre **PowerShell** y ejecuta:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Cierra y vuelve a abrir la terminal (para que se actualice el PATH) y verifica:

```powershell
claude --version
claude doctor
```

> Alternativa: `winget install Anthropic.ClaudeCode`. Si `claude` "no se reconoce", reinicia la terminal.

### ⚠️ Antes de seguir: la trampa de la clave de API
Tu plan Pro incluye Claude Code. Pero si en Windows existe una variable de entorno llamada `ANTHROPIC_API_KEY`, Claude Code la usa y **te cobra por API** en lugar de usar tu plan. Para comprobarlo en PowerShell:

```powershell
echo $env:ANTHROPIC_API_KEY
```

Si imprime algo, bórrala de las variables de entorno de Windows. Por eso este proyecto usa `RF_LLM_API_KEY` para la clave de la app.

## Paso 3 · Poner el proyecto en tu computador

1. Descomprime `remotefit.zip` en una carpeta **fuera de OneDrive**, por ejemplo `C:\dev\remotefit`.
2. En una terminal dentro de esa carpeta:

```powershell
cd C:\dev\remotefit
git init
git add .
git commit -m "chore: project setup with docs and Claude Code config"
```

3. Crea un repositorio **privado** vacío en GitHub llamado `remotefit` y conéctalo:

```powershell
git branch -M main
git remote add origin https://github.com/JuanManuelRivera31/remotefit.git
git push -u origin main
```

(Más adelante puedes hacerlo público como pieza de portafolio.)

## Paso 4 · Base de datos

Elige una:
- **Sin instalar nada (recomendado para empezar):** crea una base PostgreSQL gratuita en la nube (Neon o Supabase) y copia su cadena de conexión.
- **Local con Docker:** instala Docker Desktop y ejecuta `docker compose up -d` en la carpeta del proyecto.

Luego: copia `.env.example` como `.env` y pega tu `DATABASE_URL`. La clave del LLM la necesitarás hasta la sesión S6; cuando llegues, créala en la consola de Anthropic (https://console.anthropic.com), pon un **límite de gasto mensual** bajo y pégala en `RF_LLM_API_KEY`.

## Paso 5 · Tu primera sesión

```powershell
cd C:\dev\remotefit
claude
```

1. La primera vez inicia sesión con tu cuenta de Claude (plan Pro) y acepta el diálogo de **confianza en la carpeta**.
2. Escribe `/status` para ver que cargó la configuración del proyecto y tu uso disponible.
3. Escribe `/` para ver la lista de skills del proyecto (`/siguiente-tarea`, `/commit`...).
4. Prueba que entiende el proyecto:
   > Resume en 5 líneas qué es este proyecto y cuál es la siguiente sesión del backlog.
5. Empieza a construir:
   > /siguiente-tarea S1

Claude te mostrará un plan y esperará tu aprobación. Léelo, pregunta lo que no entiendas y aprueba.

## Paso 6 · El ciclo de trabajo de cada día

```text
claude                       → abrir en la carpeta del proyecto
/siguiente-tarea             → plan → apruebas → código → pruebas → revisión
/commit                      → commit verificado
/cierre-de-sesion            → actualiza backlog y bitácora
/clear                       → contexto limpio para la siguiente tarea
git push                     → subir a GitHub (Claude te pedirá permiso si lo hace él)
```

## Atajos y comandos que usarás siempre

| Comando / atajo | Qué hace |
|---|---|
| `Shift+Tab` | Cambia entre modos de permisos, incluido el **modo plan** (Claude solo investiga y planea, no toca archivos). El modo activo se ve debajo del cuadro de texto |
| `Esc` | Interrumpe a Claude |
| `Esc` `Esc` | Volver a un mensaje anterior para corregir el rumbo |
| `/clear` | Borra la conversación actual (empieza limpio) |
| `/compact` | Resume la conversación para liberar contexto sin perderla |
| `/status` | Configuración cargada y uso del plan |
| `/model` | Cambiar de modelo |
| `/agents` | Ver o crear subagentes |
| `/init` | Que Claude proponga mejoras al `CLAUDE.md` según el código actual (úsalo tras S1) |
| `claude --continue` | Retomar la última conversación en esta carpeta |
| `claude --resume` | Elegir una conversación anterior para retomar |
| `claude --worktree <nombre>` | Sesión aislada en paralelo (ver `docs/05-flujo-con-agentes.md`) |
| `@archivo` | Mencionar un archivo para que Claude lo lea |
| `@agent-code-reviewer ...` | Llamar a un subagente directamente |

## Qué hay en este proyecto y para qué sirve

| Archivo / carpeta | Para qué |
|---|---|
| `CLAUDE.md` | Instrucciones que Claude lee al iniciar cada sesión: cómo trabajar contigo, arquitectura, reglas |
| `.claude/settings.json` | Permisos (qué puede hacer sin preguntarte, qué tiene prohibido) y hooks |
| `.claude/hooks/format-file.mjs` | Formatea con Prettier cada archivo que Claude edita |
| `.claude/rules/` | Reglas que se cargan solo al tocar ciertas carpetas (LLM, conectores, web) |
| `.claude/agents/` | Los 4 subagentes especializados |
| `.claude/skills/` | Las 6 skills (recetas) del flujo de trabajo |
| `docs/01-vision-y-mvp.md` | Qué construimos y qué no |
| `docs/02-arquitectura.md` | Cómo está construido y por qué |
| `docs/03-modelo-de-datos.md` | Tablas de la base de datos |
| `docs/04-backlog.md` | Las sesiones de trabajo, en orden |
| `docs/05-flujo-con-agentes.md` | Subagentes, sesiones paralelas y cómo cuidar el plan Pro |
| `docs/adr/` | Decisiones técnicas importantes con su justificación |
| `docs/progreso.md` | Bitácora: qué se hizo en cada sesión y qué sigue |

## Si algo falla

- `claude doctor` diagnostica instalación, sesión y configuración.
- Si Claude no respeta una regla, dile: *"revisa CLAUDE.md, la regla X"*. Si se repite, ajusta el texto de la regla para que sea más concreto.
- Si un permiso molesta (te pregunta siempre lo mismo), elige "Sí, y no volver a preguntar": se guarda en `.claude/settings.local.json`, que es solo tuyo.
