#!/bin/bash
# Copy the local database into an empty Neon database, then compare row counts.
# Runs INSIDE the local Postgres container (see docs/despliegue.md):
#   docker cp scripts/neon-restore.sh remotefit-db-1:/tmp/neon-restore.sh
#   docker exec -it remotefit-db-1 bash /tmp/neon-restore.sh
# The Neon URL is read hidden and never printed. pg_restore needs the DIRECT host:
# through the pooler (PgBouncer, transaction mode) its session settings (search_path='')
# leak into shared server connections, so the "-pooler" suffix is stripped here.
set -u

DUMP=/tmp/remotefit.dump
LOCAL=(-U remotefit -d remotefit)
COUNTS="select 'companies', count(*) from public.companies
  union all select 'jobs', count(*) from public.jobs
  union all select 'eligibility_results', count(*) from public.eligibility_results
  union all select 'llm_usage_daily', count(*) from public.llm_usage_daily
  union all select 'profiles', count(*) from public.profiles
  union all select 'migrations', count(*) from drizzle.__drizzle_migrations"

read -r -s -p "URL de Neon: " U; echo
if [ -z "$U" ]; then echo "URL vacia, cancelado."; exit 1; fi
D="${U/-pooler./.}"
unset U

existing=$(psql "$D" -Atc "select count(*) from information_schema.tables where table_schema in ('public','drizzle')") \
  || { echo "No se pudo conectar a Neon (revisa la URL)."; exit 1; }
if [ "$existing" != "0" ]; then
  echo "Neon ya tiene $existing tablas; no restauro nada."; exit 1
fi

echo "Respaldando la base local..."
pg_dump "${LOCAL[@]}" --no-owner --no-privileges -Fc -f "$DUMP" || { echo "pg_dump fallo."; exit 1; }

echo "Restaurando en Neon..."
pg_restore --no-owner --no-privileges --exit-on-error -d "$D" "$DUMP" \
  || { echo "pg_restore fallo."; rm -f "$DUMP"; exit 1; }
rm -f "$DUMP"

echo "Conteos (local | Neon):"
paste -d '|' <(psql "${LOCAL[@]}" -At -F ' ' -c "$COUNTS") <(psql "$D" -At -F ' ' -c "$COUNTS")
unset D
