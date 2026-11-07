# Despliegue a costo cero (S11)

Arquitectura y motivos: ADR 0007. Aquí van solo los pasos. Ninguno pide tarjeta. Los valores secretos los pegas tú, nunca van en el código ni en el chat.

## 0. Antes de publicar: subir el historial reescrito a un repo nuevo

El historial se reescribió el 2026-11-04: fixtures sintéticos y autor con el correo `noreply`. **No se usa `git push --force`** sobre el repo existente: la vista de Actividad de GitHub enlaza los commits anteriores a un push forzado y quedarían visibles al hacer público el repo. En su lugar se sube a un repo nuevo y vacío (hecho el 2026-11-05):

1. En GitHub (lo haces tú): renombrar el repo viejo a `remotefit-archivo` y dejarlo **privado**. Crear un repo nuevo llamado `remotefit`, vacío (sin README, licencia ni `.gitignore`).
2. Comprobar que `origin` apunta al repo nuevo y que está vacío:
   ```
   git remote -v                 # origin -> https://github.com/JuanManuelRivera31/remotefit.git
   git ls-remote origin          # sin salida = repo vacío
   ```
3. Limpiar las referencias de seguimiento que quedaron del repo viejo y hacer un push normal:
   ```
   git fetch --prune origin
   git push -u origin main
   ```
4. Verificar que el remoto solo tiene `main` y que coincide con el HEAD local:
   ```
   git rev-parse HEAD
   git ls-remote origin          # solo HEAD y refs/heads/main, mismo SHA
   ```
   Mientras el repo sea privado, la API pública (`https://api.github.com/repos/JuanManuelRivera31/remotefit/branches`) responde `Not Found`; después de hacerlo público sirve como segunda comprobación.

Las ramas locales viejas no se suben: solo se empuja `main`. Respaldo completo previo: `C:\remotefit-respaldo-20261104\remotefit-respaldo-20261104.bundle` (se restaura con `git clone C:\remotefit-respaldo-20261104\remotefit-respaldo-20261104.bundle`); el historial anterior también sigue en `remotefit-archivo`, que no debe hacerse público.

## 1. Base de datos en Neon (Free, sin tarjeta)

1. Entra a https://neon.com y regístrate con tu cuenta de GitHub. El plan Free no pide tarjeta.
2. Crea un proyecto `remotefit`, región **AWS US East (N. Virginia)** (cerca de los runners de GitHub), PostgreSQL 17.
3. En *Connect*, copia la *connection string* **con pooling** (el host lleva `-pooler`) y con `sslmode=require` al final. Es tu `DATABASE_URL` de producción. No la pegues en el chat.

### Copiar a Neon lo que ya tienes (opcional, recomendado)

Así no pierdes las 318 clasificaciones ni gastas cuota repitiéndolas. Con Docker encendido (`docker start remotefit-db-1`), en **una ventana de PowerShell aparte** (no en la de Claude Code: la URL no debe pasar por el chat), desde la carpeta del repo:

```powershell
docker cp scripts/neon-restore.sh remotefit-db-1:/tmp/neon-restore.sh
docker exec -it remotefit-db-1 bash /tmp/neon-restore.sh
```

El script ([`scripts/neon-restore.sh`](../scripts/neon-restore.sh)) pide la URL de Neon sin mostrarla (pega la de *Connect*, con o sin `-pooler`), se niega si Neon ya tiene tablas, respalda la base local, la restaura y muestra los conteos local | Neon lado a lado: deben coincidir. Hecho el 2026-11-07: 20 empresas, 2250 ofertas, 318 clasificaciones, 5 migraciones.

Por qué un script y no un comando de una línea (lo que falló la primera vez):

- **Comillas:** PowerShell 5.1 les quita las comillas dobles a los argumentos de programas externos, así que un `sh -c '... "..." ...'` llega roto al contenedor.
- **`read -s`:** el `sh` de la imagen de Postgres (dash) no lo soporta; el script corre con `bash`.
- **Pooler:** `pg_restore` debe usar la conexión **directa**. A través del pooler (PgBouncer en modo transacción) su `search_path` vacío se queda en conexiones compartidas y las consultas siguientes no encuentran las tablas. El script quita `-pooler` del host por ti. El cron y la app sí usan la URL con `-pooler`.

Si prefieres empezar vacío, sáltalo: el primer run hace las migraciones e ingiere todo, pero tardará unos 5 días de cuota en clasificar el atraso.

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
