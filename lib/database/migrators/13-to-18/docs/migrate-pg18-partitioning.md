# Stage 2: Fix partitioning + app cutover

**Starting point**: staging PG18 (`db.t3.medium`) running alongside PG13. All data migrated to staging PG18, no partitioning fixed, app still on PG13.

**Goal**: production PG18 (`db.t3.micro`) with working monthly partitioning on `measurements`, app on PG18, PG13 and staging PG18 gone.

See [gorge-db-state.md](gorge-db-state.md) for the partitioning problem background.

---

## Decisions

| Decision                          | Choice                                             | Rationale                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance type                     | `db.t3.micro`                                      | Same as PG13; retention will archive old partitions, reducing index bloat over time                                                                                                                 |
| Allocated storage                 | 30 GB (max 100 GB)                                 | Up from PG13's 20 GB; 19 GB of data today + headroom                                                                                                                                                |
| Partition interval                | Monthly                                            | Same as intended original design                                                                                                                                                                    |
| Maintenance tooling               | pg_cron + `partman.run_maintenance_proc()`         | AWS RDS does not support third-party background workers (`pg_partman_bgw`); pg_cron is the standard RDS approach (same as PG13)                                                                     |
| Measurements migration            | postgres_fdw + `INSERT INTO measurements` (parent) | Inserting through the parent table triggers partition routing — rows land directly in the correct monthly partition; `measurements_default` stays empty throughout; no `partition_data_proc` needed |
| Bad 2037-timestamp rows (~55)     | Delete from staging PG18 before migration          | Garbage data                                                                                                                                                                                        |
| `measurements_p2037_06` partition | Drop from staging PG18 before migration            | Empty artifact from the original partman failure                                                                                                                                                    |

---

## Overview

Commands below are annotated with the host they run on:

- **[local]** — your machine (`psql`, `pg_dump`, CDK, AWS CLI)
- **[staging]** — connected to staging PG18 (via `psql-staging` alias)
- **[final]** — connected to final PG18 (via `psql-final` alias)

| #    | Step                                                     | Host    |
| ---- | -------------------------------------------------------- | ------- |
| 0    | Make staging PG18 public + local aliases                 | local   |
| 1    | Create final PG18 (CDK deploy)                           | local   |
| 2    | Clean staging PG18                                       | staging |
| 3    | Migrate gorge schema → final PG18                        | local   |
| 4    | Set up pg_partman + all monthly partitions on final PG18 | final   |
| 5    | Set up pg_cron on final PG18                             | final   |
| 6    | Migrate wwguide + synapse                                | local   |
| 7    | Set up postgres_fdw on final PG18                        | final   |
| 8    | Migrate gorge non-measurements data                      | local   |
| 9    | Migrate measurements month by month                      | final   |
| 10   | Final verification                                       | final   |
| 11   | Remove staging PG18 (CDK deploy)                         | local   |
| 12   | Make final PG18 private (CDK deploy)                     | local   |
| 12.5 | Catch-up sync: copy recent measurements from PG13        | final   |
| 13   | App cutover (CDK deploy)                                 | local   |
| 14   | Cleanup: remove PG13 (CDK deploy)                        | local   |

---

## Step 0 — Make staging PG18 public + local aliases [local]

### 0a — Move staging PG18 to public subnet

`Postgres18Staging.ts` already has `publiclyAccessible: true` and `vpcSubnets: PUBLIC` added. **Changing `vpcSubnets` replaces the DB subnet group → CloudFormation replaces the RDS instance → all staging data is lost.**

Before deploying:

```bash
# Take a manual snapshot to keep as a safety net
aws rds create-db-snapshot \
  --db-instance-identifier <staging-instance-id> \
  --db-snapshot-identifier pg18-staging-pre-public \
  --profile ww-prod --region us-east-1
# Wait until status = available (a few minutes)
aws rds describe-db-snapshots \
  --db-snapshot-identifier pg18-staging-pre-public \
  --query 'DBSnapshots[0].Status' --output text --profile ww-prod --region us-east-1
```

> **Note:** The snapshot is for safety only. The replacement instance will start empty — the stage 1 migration ECS task (`Migrate13To18`) will need to be re-run to repopulate it. Alternatively, restore the snapshot manually into the new instance identifier after replacement.

```bash
npm run build
npm run cdk -- deploy "ProdStack/Db" --profile ww-prod --region us-east-1
```

CDK outputs will print the new staging hostname and secret ARN:

```
Outputs:
ProdStack-Db.Pg18StagingHost     = pg18staging.xxxxx.<region>.rds.amazonaws.com
ProdStack-Db.Pg18StagingSecretArn = arn:aws:secretsmanager:...
```

### 0b — Set up local aliases

Retrieve credentials and configure `~/.pgpass` + `~/.pg_service.conf` + `~/.zshrc` once. All subsequent steps use these aliases — no host or password flags needed.

```bash
# Fetch secrets (run after step 0a deploy and again after step 1 deploy for final host)
STAGING_HOST=$(aws cloudformation describe-stacks \
  --stack-name ProdStack-Db \
  --query "Stacks[0].Outputs[?OutputKey=='Pg18StagingHost'].OutputValue" \
  --output text --profile ww-prod --region us-east-1)

STAGING_PASS=$(aws secretsmanager get-secret-value \
  --secret-id Pg18Staging \
  --query SecretString --output text --profile ww-prod --region us-east-1 | jq -r .password)
```

Add to `~/.pgpass` (host:port:database:user:password):

```
# append — run once per instance
echo "$STAGING_HOST:5432:*:postgres:$STAGING_PASS" >> ~/.pgpass
chmod 600 ~/.pgpass
```

Add to `~/.pg_service.conf`:

```ini
[pg18-staging]
host=<STAGING_HOST from above>
port=5432
user=postgres

[pg18-final]
host=<FINAL_HOST — fill in after step 1>
port=5432
user=postgres
```

Add to `~/.zshrc` (reload with `source ~/.zshrc`):

```zsh
# psql shortcuts
alias psql-staging='PGSERVICE=pg18-staging psql'
alias psql-final='PGSERVICE=pg18-final psql'

# pg_dump shortcuts (append db name + any flags)
pgdump-staging() { PGSERVICE=pg18-staging pg_dump "$@"; }
pgdump-final()   { PGSERVICE=pg18-final   pg_dump "$@"; }

# pg_restore shortcut (append -d dbname + any flags)
pgrestore-final() { PGSERVICE=pg18-final pg_restore "$@"; }
```

Connect with:

```bash
psql-staging                  # connects to postgres db on staging
psql-staging -d gorge         # connects to gorge db on staging
psql-final -d gorge           # connects to gorge db on final
pgdump-staging gorge ...      # pg_dump against staging
pgrestore-final -d wwguide ...# pg_restore against final
```

---

## Step 1 — Create final PG18 [local]

New `Postgres18.ts` construct:

- `db.t3.micro`, `allocatedStorage: 30`, `maxAllocatedStorage: 100`
- Parameter group: `shared_preload_libraries: 'pg_cron'`
- `publiclyAccessible: true`, `vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }`
- `CfnOutput` for hostname and secret ARN (same pattern as `Postgres18Staging.ts`)
- No CloudMap yet (added in step 13)
- `deletionProtection: !isDev`, `removalPolicy: RemovalPolicy.SNAPSHOT` in prod
- `backupRetention: isDev ? Duration.days(0) : Duration.days(3)`

```bash
npm run build
npm run cdk -- deploy "ProdStack/Db" --profile ww-prod --region us-east-1
```

CDK outputs will print the final hostname:

```
Outputs:
ProdStack-Db.Pg18Host     = pg18.xxxxx.<region>.rds.amazonaws.com
ProdStack-Db.Pg18SecretArn = arn:aws:secretsmanager:...
```

Fill in `[pg18-final]` in `~/.pg_service.conf` and add credentials to `~/.pgpass`:

```bash
FINAL_HOST=<from CDK output>
FINAL_PASS=$(aws secretsmanager get-secret-value \
  --secret-id Pg18 \
  --query SecretString --output text --profile ww-prod --region us-east-1 | jq -r .password)
echo "$FINAL_HOST:5432:*:postgres:$FINAL_PASS" >> ~/.pgpass
```

**Verify:**

- CloudFormation console: new `Pg18` resource in `Available` state
- Can connect: `psql-final -c '\l'`
  → shows only `postgres` database (empty instance)

---

## Step 2 — Clean staging PG18 [staging → gorge]

```bash
psql-staging -d gorge
```

```sql
-- Confirm count before deleting
SELECT count(*) FROM measurements WHERE timestamp >= '2037-01-01';
-- Expected: ~55

DELETE FROM measurements WHERE timestamp >= '2037-01-01';

DROP TABLE measurements_p2037_06;
```

**Verify:**

```sql
SELECT count(*) FROM measurements WHERE timestamp >= '2037-01-01';
-- Expected: 0

SELECT max(timestamp) FROM measurements_default;
-- Expected: somewhere in 2026

SELECT tablename FROM pg_tables WHERE tablename LIKE 'measurements_%';
-- Expected: only measurements_default
```

---

## Step 3 — Migrate gorge schema to final PG18 [local]

Schema-only dump, no data. We must load data **after** all monthly partitions exist (step 4), so that `INSERT INTO measurements` (parent) can route rows to the correct monthly partition. If data arrived before partitions, the routing would fall through to `measurements_default`.

```bash
pgdump-staging gorge \
  --schema-only \
  --exclude-schema=partman \
  --exclude-schema=archive \
  -f gorge_schema.sql

psql-final -d postgres -c "CREATE DATABASE gorge;"
psql-final -d gorge -f gorge_schema.sql
```

**Verify** [final → gorge]:

```sql
-- measurements table exists, is partitioned, has zero rows
SELECT count(*) FROM measurements;
-- Expected: 0

-- Only default partition exists — no monthly partitions yet
SELECT tablename FROM pg_tables WHERE tablename LIKE 'measurements_%';
-- Expected: measurements_default only

-- Other gorge tables exist (no data yet)
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Expected: gauges, rivers, sources, sections, measurements, ... (whatever gorge uses)

-- No partman schema
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'partman';
-- Expected: 0 rows
```

---

## Step 4 — Set up pg_partman + all monthly partitions [final → gorge]

`measurements_default` is empty right now — this is the only moment we can create monthly partitions without hitting PostgreSQL's constraint (a monthly partition cannot be created if `measurements_default` already contains rows in that range).

```bash
psql-final -d gorge
```

```sql
-- Install pg_partman
CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

-- Drop measurements_default so create_parent can recreate it.
-- The schema restore (step 3) creates measurements_default as part of the
-- partitioned table DDL; create_parent will fail if it already exists.
DROP TABLE IF EXISTS measurements_default;

-- Initialize monthly partitioning
-- create_parent will create a few partitions around the current date (premake=6)
SELECT partman.create_parent(
  p_parent_table => 'public.measurements',
  p_control      => 'timestamp',
  p_type         => 'range',
  p_interval     => '1 month',
  p_premake      => 6
);

-- Configure retention: 13 months, archive to schema (same as PG13 intent)
UPDATE partman.part_config
SET retention                = '13 months',
    retention_schema         = 'archive',
    retention_keep_table     = true,
    infinite_time_partitions = true
WHERE parent_table = 'public.measurements';

CREATE SCHEMA IF NOT EXISTS archive;

-- Pre-create ALL historical monthly partitions from 2022-03 through now+6 months.
-- Use partman's native naming (YYYYMMDD of start date) so it recognises these as
-- its own managed children and won't try to recreate them during maintenance.
-- CREATE TABLE IF NOT EXISTS handles overlap with partitions create_parent already made.
-- measurements_default is empty so there are no constraint violations.
DO $$
DECLARE
  cur  date := '2022-03-01';
  stop date := date_trunc('month', now() + interval '7 months');
  name text;
BEGIN
  WHILE cur < stop LOOP
    name := 'measurements_p' || to_char(cur, 'YYYYMMDD');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF measurements FOR VALUES FROM (%L) TO (%L)',
      name, cur, cur + interval '1 month'
    );
    cur := cur + interval '1 month';
  END LOOP;
  RAISE NOTICE 'DO block complete. Run: SELECT count(*) FROM pg_tables WHERE tablename LIKE ''measurements_p%%'';';
END;
$$;

-- Run maintenance so pg_partman's internal state reflects the full partition set
CALL partman.run_maintenance_proc();
```

**Verify — do not proceed to step 5 unless all checks pass:**

```sql
-- CRITICAL: count must be ~57+ (one per month 2022-03 → 2026-10, plus measurements_default).
-- If this shows fewer than 50, the DO block did not run or failed — stop and investigate.
SELECT count(*) FROM pg_tables WHERE tablename LIKE 'measurements_p%';

-- First and last partition names (sanity-check the range)
SELECT min(tablename), max(tablename) FROM pg_tables WHERE tablename LIKE 'measurements_p%';
-- Expected: measurements_p20220301 → measurements_p20261001 (or later)

-- measurements_default is still empty — if not, stop and investigate before continuing
SELECT count(*) FROM measurements_default;
-- Expected: 0

-- partman config row present
SELECT parent_table, partition_interval, retention, premake, infinite_time_partitions
FROM partman.part_config;
-- Expected: 1 row for public.measurements
```

---

## Step 5 — Set up pg_cron [final → postgres]

pg_cron is installed in the `postgres` database and schedules jobs against other databases via the `database` column.

```bash
psql-final
```

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- cron.schedule() creates the job and returns its integer job ID (pg_cron uses a SELECT-based API)
-- Note: fixes the typo from PG13 ("maintetance" → "maintenance")
SELECT cron.schedule(
  'partman_maintenance',
  '@hourly',
  $$CALL partman.run_maintenance_proc()$$
);

-- pg_cron defaults to running jobs against the 'postgres' database; redirect to 'gorge'
UPDATE cron.job SET database = 'gorge' WHERE jobname = 'partman_maintenance';
```

**Verify:**

```sql
SELECT jobname, schedule, database, command, active FROM cron.job;
-- Expected: 1 row, database='gorge', active=true
```

---

## Step 6 — Migrate wwguide + synapse [local]

No partitioning complexity. Full dump and restore.

```bash
# wwguide — create extensions BEFORE restore so pg_restore doesn't fail on them
pgdump-staging wwguide -Fc -f wwguide.bak
psql-final -d postgres -c "CREATE DATABASE wwguide;"
psql-final -d wwguide <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SQL
pgrestore-final -d wwguide -Fc wwguide.bak

# synapse
pgdump-staging synapse -Fc -f synapse.bak
psql-final -d postgres -c "CREATE DATABASE synapse;"
pgrestore-final -d synapse -Fc synapse.bak
```

**Verify** [final → wwguide]:

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM regions;
SELECT extname FROM pg_extension
WHERE extname IN ('postgis', 'pg_trgm', 'uuid-ossp')
ORDER BY extname;
-- Expected: 3 rows
```

**Verify** [final → synapse]:

```sql
SELECT count(*) FROM events;
SELECT count(*) FROM users;
```

Compare all counts against staging PG18 — they must match exactly (these databases are not receiving new writes; PG13 only serves wwguide/synapse reads, and gorge is read-only from those services).

---

## Step 7 — Set up postgres_fdw on final PG18 [final → gorge]

We use `postgres_fdw` to stream `measurements` data from staging into final PG18. By inserting `INTO measurements` (the parent table), PostgreSQL's partition routing sends each row directly to the correct pre-existing monthly partition. `measurements_default` stays empty throughout.

```bash
psql-final -d gorge
```

```sql
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER staging_pg18
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host '<staging-host>', port '5432', dbname 'gorge');

CREATE USER MAPPING FOR postgres
  SERVER staging_pg18
  OPTIONS (user 'postgres', password '<staging-password>');

-- Increase fetch_size from the default (100) to reduce round trips during the month-by-month migration
ALTER SERVER staging_pg18 OPTIONS (ADD fetch_size '50000');

CREATE SCHEMA IF NOT EXISTS staging;
IMPORT FOREIGN SCHEMA public
  LIMIT TO (measurements_default)
  FROM SERVER staging_pg18
  INTO staging;
```

**Verify:**

```sql
SELECT min(timestamp), max(timestamp) FROM staging.measurements_default;
-- Expected: ~2022-03-01 → 2026-04-xx

SELECT count(*) FROM staging.measurements_default;
-- Expected: ~104M (takes a minute to count)
```

**Cleanup (step 11):** The `staging_pg18` server, user mapping, and `staging` schema are dropped in step 11 before removing the staging instance. Do not skip — dropping these first prevents orphaned foreign server references.

---

## Step 8 — Migrate gorge non-measurements data [local]

All gorge tables except `measurements` and the `partman` schema.

```bash
pgdump-staging gorge \
  --data-only \
  --exclude-schema=partman \
  --exclude-schema=archive \
  --exclude-table='measurements*' \
  -f gorge_nonmeasurements.sql

psql-final -d gorge -f gorge_nonmeasurements.sql
```

**Verify** [final → gorge]:

```sql
SELECT count(*) FROM gauges;
SELECT count(*) FROM rivers;
SELECT count(*) FROM sources;
-- (add any other large gorge tables)
-- Compare against staging PG18 — must match
```

---

## Step 9 — Migrate measurements month by month [final → gorge]

Each INSERT goes through the parent table (`measurements`), which routes rows to the correct pre-existing monthly partition. `measurements_default` never receives any of this data.

```bash
psql-final -d gorge
```

**First, verify the approach on one month:**

```sql
INSERT INTO measurements
SELECT * FROM staging.measurements_default
WHERE timestamp >= '2022-03-01' AND timestamp < '2022-04-01';

SELECT count(*) FROM measurements_p20220301;  -- ~1.75M (not measurements_p2022_03)
```

**If count looks right, migrate all remaining months in one go:**

The procedure commits after each month, so progress is preserved across disconnects and WAL stays manageable.

```sql
CREATE OR REPLACE PROCEDURE migrate_measurements_remaining() LANGUAGE plpgsql AS $$
DECLARE
  cur  date := '2022-04-01';
  stop date := date_trunc('month', now() + interval '1 month');
  cnt  bigint;
BEGIN
  WHILE cur < stop LOOP
    INSERT INTO measurements
    SELECT * FROM staging.measurements_default
    WHERE timestamp >= cur AND timestamp < cur + interval '1 month';
    GET DIAGNOSTICS cnt = ROW_COUNT;
    RAISE NOTICE 'Migrated %: % rows', to_char(cur, 'YYYY-MM'), cnt;
    COMMIT;
    cur := cur + interval '1 month';
  END LOOP;
  RAISE NOTICE 'Done.';
END;
$$;

CALL migrate_measurements_remaining();

DROP PROCEDURE migrate_measurements_remaining();
```

RAISE NOTICE output is visible in PGAdmin's message panel as the procedure runs (~30–90 s per month).

**To resume after a disconnect** — check which partitions already have rows, then adjust `cur` in a new version of the procedure to start from the first empty month:

```sql
SELECT tablename,
       (SELECT count(*) FROM measurements
        WHERE timestamp >= to_date(replace(tablename, 'measurements_p', ''), 'YYYYMMDD')
          AND timestamp <  to_date(replace(tablename, 'measurements_p', ''), 'YYYYMMDD') + interval '1 month'
       ) AS rows
FROM pg_tables
WHERE tablename LIKE 'measurements_p%'
ORDER BY tablename;
```

---

## Step 10 — Final verification [final]

```sql
-- [gorge] Total row count vs staging PG18 (staging had ~104M, minus ~55 deleted 2037 rows)
SELECT count(*) FROM measurements;

-- [gorge] measurements_default must be empty
SELECT count(*) FROM measurements_default;
-- Expected: 0

-- [gorge] Partition pruning works (only relevant partition in plan, not full scan)
EXPLAIN SELECT * FROM measurements
WHERE timestamp >= '2025-01-01' AND timestamp < '2025-02-01'
LIMIT 10;
-- Expected: Seq Scan on measurements_p20250101 — no other partitions in plan

-- [gorge] Spot-check partition counts vs gorge-db-state.md monthly estimates
SELECT count(*) FROM measurements_p20220301;  -- ~1.75M
SELECT count(*) FROM measurements_p20251201;  -- ~2.1–2.6M

-- [gorge] pg_cron maintenance has run (check after the hour ticks)
\c postgres
SELECT job_run_details.runid, jobid, status, start_time, end_time, return_message
FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 5;
-- Expected: succeeded rows for partman_maintenance

-- [gorge] No rows in default (double-check)
\c gorge
SELECT count(*) FROM measurements_default;
-- Expected: 0
```

---

## Step 11 — Remove staging PG18 [local]

Staging PG18 was temporary (`RemovalPolicy.DESTROY`). Once data is verified, remove it immediately — no backup needed.

Remove `Postgres18Staging` and `Migrate13To18` from CDK. Also drop the fdw that points to it (cannot drop after instance is gone):

**First** [final → gorge]:

```sql
DROP SERVER staging_pg18 CASCADE;  -- drops the user mapping and foreign table too
DROP SCHEMA staging;
```

**Then** [local]:

```bash
npm run cdk -- deploy "ProdStack/Db" --profile ww-prod --region us-east-1
```

**Verify:**

- CloudFormation: `Pg18Staging` resource is gone
- RDS console: staging instance no longer listed

---

## Step 12 — Make final PG18 private [local]

The `publiclyAccessible` flag and public subnet placement were temporary for the migration. Revert now that all data is migrated and staging is gone, before cutting the app over.

In `Postgres18.ts`, remove or flip:

```diff
-  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
-  publiclyAccessible: true,
+  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
+  publiclyAccessible: false,
```

Also remove the `CfnOutput` blocks (no longer needed after migration is complete).

> **Note:** Changing `vpcSubnets` replaces the instance (subnet group change). This instance has `RemovalPolicy.SNAPSHOT` — CloudFormation will take a snapshot automatically before replacement, and the new instance starts from that snapshot. The process takes ~15–20 minutes. Schedule during low-traffic hours.

```bash
npm run build
npm run cdk -- deploy "ProdStack/Db" --profile ww-prod --region us-east-1
```

**Clean up local aliases** — the direct public hostnames are no longer reachable after this step. Remove the migration entries from `~/.pgpass` and `~/.pg_service.conf`:

```bash
# Edit and delete the pg18-staging and pg18-final lines
nano ~/.pgpass
nano ~/.pg_service.conf
```

**Verify:**

- RDS console: final PG18 shows "Publicly accessible: No"
- CloudFormation: `Pg18` resource in `Available` state with new private endpoint

---

## Step 12.5 — Catch-up sync: copy recent measurements from PG13 [final → gorge]

The stage 1 migration copied a point-in-time snapshot of PG13 into staging PG18. Since then, gorge has continued writing new measurements to PG13. This step fills that gap before cutover.

**Timing:** Run this after `npm stop` (see step 13) but before the CDK deploy — the app is stopped so PG13 receives no new writes, making this a clean final sync.

Both instances are in the same VPC private subnet; PG18 reaches PG13 via its CloudMap DNS name `postgres.local`.

Retrieve PG13 credentials:

```bash
PG13_PASS=$(aws secretsmanager get-secret-value \
  --secret-id Pg13 \
  --query SecretString --output text --profile ww-prod --region us-east-1 | jq -r .password)
```

```bash
psql-final -d gorge
```

```sql
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER pg13_catchup
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'postgres.local', port '5432', dbname 'gorge');

CREATE USER MAPPING FOR postgres
  SERVER pg13_catchup
  OPTIONS (user 'postgres', password '<PG13_PASS from above>');

CREATE SCHEMA IF NOT EXISTS pg13;
IMPORT FOREIGN SCHEMA public
  LIMIT TO (measurements)
  FROM SERVER pg13_catchup
  INTO pg13;

-- Copy rows newer than what's already in PG18.
-- Using max(timestamp) as the cutoff is exact — no arbitrary window, no duplicates possible.
-- measurements schema: (timestamp, script, code, flow, level); unique key: (script, code, timestamp)
INSERT INTO measurements (timestamp, script, code, flow, level)
SELECT src.timestamp, src.script, src.code, src.flow, src.level
FROM pg13.measurements src
WHERE src.timestamp > (SELECT max(timestamp) FROM measurements);
```

**Before inserting**, record the cutoff so you can verify afterwards:

```sql
SELECT max(timestamp) AS cutoff FROM measurements;
-- Save this value — call it <cutoff>
```

**Verify** (after INSERT):

```sql
-- Rows in PG13 beyond the cutoff — should equal rows inserted
SELECT count(*) FROM pg13.measurements WHERE timestamp > '<cutoff>';

-- Latest timestamp in PG18 — should match PG13's latest (app is stopped)
SELECT max(timestamp) FROM measurements;
SELECT max(timestamp) FROM pg13.measurements;
```

**Cleanup:**

```sql
DROP SERVER pg13_catchup CASCADE;  -- drops user mapping and foreign table
DROP SCHEMA pg13;
```

---

## Step 13 — App cutover [local]

```bash
npm stop --profile ww-prod --region us-east-1
```

CDK changes (in the same deploy):

- Add CloudMap to final PG18 (name: `postgres` — same name as PG13 so services need no config change)
- Update `ScheduledBackup` to use final PG18 secret + `pg_dump_restore:4.0.1` image
- Update all service environment secrets to final PG18 secret name

```bash
npm run cdk -- deploy "ProdStack/Db" "ProdStack/Services" --profile ww-prod --region us-east-1
npm start --profile ww-prod --region us-east-1
```

**Verify:**

- All ECS services show healthy in target groups
- Service logs show no database connection errors
- Gorge is writing new measurements: `SELECT max(timestamp) FROM measurements;` should advance over the next few minutes
- New measurements land in the correct monthly partition (not in default):
  ```sql
  SELECT count(*) FROM measurements_default;
  -- Expected: 0 (or only rows from seconds of new data if pg_partman hasn't run maintenance yet — should be 0)
  ```
- S3 backup created by `ScheduledBackup` on its next run

---

## Step 14 — Cleanup [local]

After 24–48h monitoring with no issues:

- Remove `Postgres13` from CDK
- Delete `lib/database/Postgres13.ts`, `lib/database/migrators/13-to-18/`
- Update `lib/database/index.ts` to remove those imports

```bash
npm run cdk -- deploy "ProdStack/Db" --profile ww-prod --region us-east-1
```

PG13 has `RemovalPolicy.SNAPSHOT` → a final snapshot is created automatically before deletion.

**Verify:**

- CloudFormation: `Pg13` resource is gone
- RDS console: only final PG18 instance remains
- Final PG13 snapshot visible in RDS snapshots

---

## Checklist

- [ ] Step 0: staging PG18 is public, local aliases configured
- [ ] Step 1: final PG18 created, CDK deployed
- [ ] Step 2: 2037 rows deleted, `measurements_p2037_06` dropped from staging
- [ ] Step 3: gorge schema restored (no data), no partman schema
- [ ] Step 4: pg_partman configured, all monthly partitions 2022-03 → 2026-10+ exist, `measurements_default` empty
- [ ] Step 5: pg_cron maintenance job active in `postgres` db, targeting `gorge`
- [ ] Step 6: wwguide + synapse row counts match staging PG18
- [ ] Step 7: postgres_fdw to staging PG18 works, `staging.measurements_default` visible
- [ ] Step 8: gorge non-measurements tables populated, counts match staging
- [ ] Step 9: all monthly partitions populated, `measurements_default` empty
- [ ] Step 10: partition pruning confirmed via EXPLAIN, total count matches, pg_cron running
- [ ] Step 11: fdw dropped, staging PG18 removed
- [ ] Step 12: final PG18 made private, local aliases cleaned up
- [ ] Step 12.5: PG13 catch-up sync done, `max(timestamp)` in PG18 matches PG13
- [ ] Step 13: app cutover done, all services healthy, new data landing in correct partitions
- [ ] Step 14: PG13 removed, final snapshot created
