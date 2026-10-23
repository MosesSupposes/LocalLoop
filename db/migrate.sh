#!/bin/sh
# Applies migrations (tracked in schema_migrations), then grants, then idempotent seeds.
set -eu

echo "[migrate] ensuring app role"
psql -v ON_ERROR_STOP=1 -q -f /db/roles.sql \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD"

psql -v ON_ERROR_STOP=1 -q -c \
  "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())"

for f in /db/migrations/*.sql; do
  v="$(basename "$f")"
  applied="$(psql -tA -c "select 1 from schema_migrations where version = '$v'")"
  if [ "$applied" = "1" ]; then
    echo "[migrate] skip $v (already applied)"
    continue
  fi
  echo "[migrate] applying $v"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
  psql -v ON_ERROR_STOP=1 -q -c "insert into schema_migrations(version) values ('$v')"
done

echo "[migrate] granting to $APP_DB_USER"
psql -v ON_ERROR_STOP=1 -q -f /db/grants.sql -v app_user="$APP_DB_USER"

for f in /db/seeds/*.sql; do
  echo "[migrate] seeding $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "[migrate] complete"
