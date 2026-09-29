#!/usr/bin/env bash
# Creates one schema + one login role per service (ADR-0002).
# Each role owns only its own schema; cross-schema access is denied by default.
# Runs once, on first start of an empty data volume, after the PostGIS image's
# own 10_postgis.sh has created the postgis extension in $POSTGRES_DB.
set -euo pipefail

SERVICES="identity catalog bookings payments messaging notifications reviews"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  -- Only the service roles below may connect; no implicit access via PUBLIC.
  REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL

for svc in $SERVICES; do
  var="$(echo "${svc}_DB_PASSWORD" | tr '[:lower:]' '[:upper:]')"
  password="${!var:-}"
  if [ -z "$password" ]; then
    echo "ERROR: $var is not set" >&2
    exit 1
  fi

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v role="${svc}_svc" -v schema="$svc" -v password="$password" -v db="$POSTGRES_DB" <<-'SQL'
    CREATE ROLE :"role" LOGIN PASSWORD :'password';
    GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"role";
    CREATE SCHEMA :"schema" AUTHORIZATION :"role";
    REVOKE ALL ON SCHEMA :"schema" FROM PUBLIC;
    -- public is kept on the path for PostGIS types/functions (read-only for services).
    ALTER ROLE :"role" SET search_path = :"schema", public;
SQL
  echo "created schema '$svc' owned by role '${svc}_svc'"
done
