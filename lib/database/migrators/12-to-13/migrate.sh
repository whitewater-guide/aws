#! /bin/bash

set -e
set -o pipefail

START_TIME=`date +%s`

PG12_CONN="postgresql://postgres:${PG12_PASSWORD}@${PG12_HOST}"
PG13TEMP_CONN="postgresql://postgres:${PG13TEMP_PASSWORD}@${PG13TEMP_HOST}"

echo "[migrate] Creating dump of pg12 wwguide database..."
pg_dump --dbname="${PG12_CONN}/wwguide" -Fc --no-owner --no-privileges -f wwguide.bak

echo "[migrate] Creating dump of pg12 gorge database..."
pg_dump --dbname="${PG12_CONN}/gorge" -Fc --no-owner --no-privileges -f gorge.bak

# https://github.com/citusdata/pg_cron#setting-up-pg_cron
# https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL_pg_cron.html#PostgreSQL_pg_cron.enable
# Must be added shared_preload_libraries in CDK ParameterGroup
echo "[migrate] Creating pg_cron extension"
psql --dbname="${PG13TEMP_CONN}/postgres" -c "CREATE EXTENSION IF NOT EXISTS pg_cron;"

echo "[migrate] Creating wwguide database in PG13TEMP..."
psql --dbname="${PG13TEMP_CONN}/postgres" -c "CREATE DATABASE wwguide;"

echo "[migrate] Restoring wwguide database into PG13TEMP..."
pg_restore --dbname="${PG13TEMP_CONN}/wwguide" -Fc --clean wwguide.bak || true

echo "[migrate] Creating gorge database in PG13TEMP..."
psql --dbname="${PG13TEMP_CONN}/postgres" -c "CREATE DATABASE gorge;"

echo "[migrate] Restoring gorge database into PG13TEMP..."
pg_restore --dbname="${PG13TEMP_CONN}/gorge" -Fc --clean gorge.bak || true

echo "[migrate] Restoring complete"
rm -rf *.bak
echo "[migrate] Deleted pg12 backups"

# https://github.com/pgpartman/pg_partman#installation
echo "[migrate] Creating pg_partman extension"
psql --dbname="${PG13TEMP_CONN}/gorge" <<- SQL
    BEGIN;

    CREATE SCHEMA IF NOT EXISTS partman;
    CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

    CREATE ROLE partman WITH LOGIN;
    GRANT ALL ON SCHEMA partman TO partman;
    GRANT ALL ON ALL TABLES IN SCHEMA partman TO partman;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO partman;
    GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO partman;
    GRANT ALL ON SCHEMA public TO partman;

    -- Schema where archived tables will be placed
    CREATE SCHEMA IF NOT EXISTS archive;
    GRANT ALL ON SCHEMA archive TO partman;

    COMMIT;
SQL

# First, the original table should be renamed so the partitioned table can be made with the original table's name.
# Then we recreate original table, but with partitions and make partman handle this new table
echo "[migrate] Creating pg_partman extension"
psql --dbname="${PG13TEMP_CONN}/gorge" <<- SQL
    BEGIN;
    ALTER TABLE measurements RENAME to old_measurements;

    CREATE TABLE measurements
    (
        timestamp timestamp with time zone not null,
        script varchar(255) not null,
        code varchar(255) not null,
        flow real,
        level real
    ) PARTITION BY RANGE (timestamp);

    CREATE INDEX msmnts_script_code_index
        ON measurements (script, code);

    CREATE UNIQUE INDEX msmnts_idx
        ON measurements (script asc, code asc, timestamp desc);

    CREATE INDEX msmnts_timestamp_idx
        ON measurements (timestamp desc);

    SELECT partman.create_parent('public.measurements', 'timestamp', 'native', 'monthly');

    COMMIT;
SQL

# Migrate data from old table to new table with partitions
echo "[migrate] Migrating measurements"
psql --dbname="${PG13TEMP_CONN}/gorge" <<- SQL
    CALL partman.partition_data_proc(
        'public.measurements',
        p_batch := 100,
        p_source_table := 'public.old_measurements'
    );
SQL

# Drop old migrations table
echo "[migrate] Deleting old migrations table"
psql --dbname="${PG13TEMP_CONN}/gorge" <<- SQL
    BEGIN;

    -- Delete old table
    DROP TABLE IF EXISTS old_measurements;

    -- Configure partman maintetance
    -- See https://github.com/pgpartman/pg_partman/blob/master/doc/pg_partman.md#tables
    UPDATE partman.part_config
    SET infinite_time_partitions = true,
        retention = '13 months',
        retention_schema = 'archive',
        retention_keep_table = true,
        premake = 6
    WHERE parent_table = 'public.measurements';

    COMMIT;
SQL

# Since we're migrating here and not in gorge itself, bump migration version to avoid (doomed to fail) double migration attempt
# DELETE FROM public.schema_migrations;
psql --dbname="${PG13TEMP_CONN}/gorge" <<- SQL
    BEGIN;

    DELETE FROM public.schema_migrations;
    INSERT INTO schema_migrations (version, dirty) VALUES (4, false);

    COMMIT;
SQL

# Schedule pg_cron to run partman maintetance
# https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL_pg_cron.html#PostgreSQL_pg_cron.otherDB
echo "[migrate] Scheduling maintetance"
psql --dbname="${PG13TEMP_CONN}/postgres" -c "SELECT cron.schedule('partman_maintetance', '@hourly', \$\$CALL partman.run_maintenance_proc()\$\$);"
echo "[migrate] Scheduling maintetance on gorge"
psql --dbname="${PG13TEMP_CONN}/postgres" -c "UPDATE cron.job SET database = 'gorge' WHERE jobname = 'partman_maintetance';"
echo "[migrate] Manually running maintetance"
psql --dbname="${PG13TEMP_CONN}/gorge" -c "CALL partman.run_maintenance_proc();"
echo "[migrate] Running vacuum"
psql --dbname="${PG13TEMP_CONN}/gorge" -c "VACUUM ANALYZE public.measurements;"

echo "[migrate] Launching ./backup.sh"
# backup.sh expects certain environment variables to connect to pg
# pass them via subshell to to avoid polluting current environment
(
    export PGHOST=${PG13TEMP_HOST}
    export PGUSER=postgres
    export POSTGRES_PASSWORD=${PG13TEMP_PASSWORD}
    # keep files created for ./restore.sh
    export KEEP_BACKUP_FILES=true
    source ./backup.sh
)
echo "[migrate] ./backup.sh completed"

echo "[migrate] Launching ./restore.sh into production pg13"
(
    export PGHOST=${PG13_HOST}
    export PGUSER=postgres
    export POSTGRES_PASSWORD=${PG13_PASSWORD}
    # use files created by ./backup.sh
    export SKIP_DOWNLOAD=true
    source ./restore.sh
)
echo "[migrate] ./restore.sh completed"

END_TIME=`date +%s`
SECONDS=$((END_TIME-START_TIME))

echo "[migrate] Done in $(((${SECONDS} / 60) % 60)) minutes $((${SECONDS} % 60)) seconds"
