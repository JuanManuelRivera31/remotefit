# Despliegue a costo cero (S11)

Arquitectura y motivos: ADR 0007. Aquí van solo los pasos. Ninguno pide tarjeta. Los valores secretos los pegas tú, nunca van en el código ni en el chat.

## 0. Antes de publicar: subir el historial reescrito (lo haces tú)

El historial se reescribió el 2026-11-04: fixtures sintéticos y autor con el correo `noreply`. El `.claude/settings.json` del proyecto le prohíbe a Claude hacer `git push --force`, así que este paso es tuyo. En la terminal de Claude Code:

```
! git push --force origin main
! git push origin --delete feat/s4-ingest
```

La segunda línea borra la única rama remota vieja, que todavía tiene el historial anterior. Respaldo completo previo: `C:\remotefit-respaldo-20261104\remotefit-respaldo-20261104.bundle` (se restaura con `git clone C:\remotefit-respaldo-20261104\remotefit-respaldo-20261104.bundle`).

Nota: GitHub puede conservar un tiempo los commits viejos si alguien conoce su SHA exacto. No hay forks ni PRs que los referencien. Si quieres purgarlos del todo, se le pide a GitHub Support.

## 1. Base de datos en Neon (Free, sin tarjeta)

1. Entra a https://neon.com y regístrate con tu cuenta de GitHub. El plan Free no pide tarjeta.
2. Crea un proyecto `remotefit`, región **AWS US East (N. Virginia)** (cerca de los runners de GitHub), PostgreSQL 17.
3. En *Connect*, copia la *connection string* **con pooling** (el host lleva `-pooler`) y con `sslmode=require` al final. Es tu `DATABASE_URL` de producción. No la pegues en el chat.

### Copiar a Neon lo que ya tienes (opcional, recomendado)

Así no pierdes las 318 clasificaciones ni gastas cuota repitiéndolas. Desde la terminal de Claude Code, con Docker encendido:

```
! docker exec remotefit-db-1 pg_dump -U remotefit -d remotefit --no-owner --no-privileges -Fc -f /tmp/remotefit.dump
! docker exec -it remotefit-db-1 sh -c 'read -s -p "URL de Neon: " U; echo; pg_restore --no-owner --no-privileges -d "$U" /tmp/remotefit.dump'
```

El segundo comando te pide la URL sin mostrarla en pantalla. Si prefieres empezar vacío, sáltalo: el primer run hace las migraciones e ingiere todo, pero tardará unos 5 días de cuota en clasificar el atraso.

## 2. Secretos en GitHub

En el repo: *Settings → Secrets and variables → Actions → New repository secret*:

| Nombre | Valor |
|---|---|
| `DATABASE_URL` | la URL de Neon del paso 1 |
| `GEMINI_API_KEY` | tu clave de Google AI Studio (capa gratuita, sin facturación) |

Opcional, en la pestaña *Variables*: `PIPELINE_MODE` = `full` (por defecto) o `publish-only` (plan B).

## 3. Visibilidad y GitHub Pages

1. Cambia el repo a **público** (lo haces tú: *Settings → General → Danger zone*). GitHub Pages es gratis solo en repos públicos.
2. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.

## 4. Primera corrida

*Actions → "Daily pipeline and site" → Run workflow* (modo `full`). Termina en unos 30–40 minutos si hay cuota para clasificar. El sitio queda en:

**https://juanmanuelrivera31.github.io/remotefit/**

Desde entonces corre solo cada día a las 09:17 UTC (04:17 en Colombia).

## 5. Tu `.env` local después de publicar

La cuota de Gemini es **por proyecto de Google**, no por base de datos. Para que tu PC y el cron no se pisen:

- Para correr un eval local, agrega `QUOTA_DATABASE_URL=<la URL de Neon>` a tu `.env`. Así el eval cuenta contra el mismo contador que el cron y su reserva le da prioridad.
- **No corras `npm run classify` contra tu base local** mientras el cron esté activo: gastaría la misma cuota sin que el cron lo sepa. Si quieres clasificar a mano, apunta `DATABASE_URL` a Neon.

## Plan B: el pipeline en tu PC

Si GitHub objeta usar Actions como pipeline de datos (ADR 0007):

1. En tu `.env`, `DATABASE_URL` pasa a ser la URL de Neon, y debe estar `GEMINI_API_KEY`.
2. Programa la tarea diaria a las 03:30 de Colombia (después del reinicio de la cuota, 08:30 UTC). En PowerShell:
   ```
   schtasks /Create /TN "RemoteFit pipeline" /SC DAILY /ST 03:30 /TR "cmd /c cd /d C:\remotefit && npm run pipeline >> C:\remotefit\data\pipeline.log 2>&1"
   ```
3. En GitHub, variable `PIPELINE_MODE` = `publish-only`. El workflow de las 09:17 UTC solo exporta lo que ya hay en Neon y publica. No llama a Gemini ni a los ATS.
4. Requisito: el PC tiene que estar encendido a esa hora. Si no lo está, el sitio sigue en línea con los datos del día anterior y muestra el aviso a los 3 días.

## Respaldo: Supabase en lugar de Neon

Úsalo si Neon deja de servir.

1. https://supabase.com, plan Free: 500 MB por base, 2 proyectos activos. No verifiqué si pide tarjeta.
2. Crea el proyecto y copia la *connection string* del *Session pooler*, con `sslmode=require`.
3. Copia los datos con el mismo `pg_restore` del paso 1 y reemplaza el secreto `DATABASE_URL`.
4. **Cuidado:** Supabase pausa los proyectos Free tras 7 días sin actividad. El cron diario lo mantiene activo, pero si el cron se detiene una semana, la base se pausa (se restaura desde su panel, con los datos intactos).
