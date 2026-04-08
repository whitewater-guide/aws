#!/bin/bash
set -e; set -o pipefail

PG13_CONN="postgresql://postgres:${PG13_PASSWORD}@${PG13_HOST}"
PG18_CONN="postgresql://postgres:${PG18_PASSWORD}@${PG18_HOST}"

echo "=== Dumping PG13 databases ==="
pg_dump --dbname="${PG13_CONN}/wwguide" -Fc --no-owner --no-privileges -f wwguide.bak
pg_dump --dbname="${PG13_CONN}/gorge"   -Fc --no-owner --no-privileges \
  --exclude-schema=partman -f gorge.bak
pg_dump --dbname="${PG13_CONN}/synapse" -Fc --no-owner --no-privileges -f synapse.bak

echo "=== Restoring to PG18 ==="
psql --dbname="${PG18_CONN}/postgres" -c "CREATE DATABASE wwguide;"
pg_restore --dbname="${PG18_CONN}/wwguide" -Fc wwguide.bak || true
psql --dbname="${PG18_CONN}/postgres" -c "CREATE DATABASE gorge;"
pg_restore --dbname="${PG18_CONN}/gorge" -Fc gorge.bak || true
psql --dbname="${PG18_CONN}/postgres" -c "CREATE DATABASE synapse;"
pg_restore --dbname="${PG18_CONN}/synapse" -Fc synapse.bak || true

echo "=== Ensuring extensions ==="
psql --dbname="${PG18_CONN}/wwguide" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql --dbname="${PG18_CONN}/wwguide" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql --dbname="${PG18_CONN}/wwguide" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'

echo "=== Removing partman cron job ==="
psql --dbname="${PG18_CONN}/postgres" -c \
  "DELETE FROM cron.job WHERE jobname LIKE '%partman%';" || true

echo "=== Cleaning up dumps ==="
rm -f *.bak

echo "=== Running initial backup from staging PG18 to S3 ==="
export PGHOST=${PG18_HOST}
export PGUSER=postgres
export POSTGRES_PASSWORD=${PG18_PASSWORD}
source ./backup.sh

echo "=== Migration complete ==="
