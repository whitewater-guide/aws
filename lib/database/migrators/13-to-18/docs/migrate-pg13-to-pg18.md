# Stage 1: Migrate PG13 → staging PG18

**Goal of this stage**: Move data from PG13 to a temporary, larger PG18 instance running alongside PG13. No app cutover. PG13 continues serving traffic throughout.

See [Stage 2](migrate-pg18-partitioning.md) for: app cutover, proper partitioning, cleanup of PG13 and staging instance.

---

## TL;DR

| #   | Step                                                              | Status         |
| --- | ----------------------------------------------------------------- | -------------- |
| 0   | Docker images upgraded                                            | ✅ Done        |
| —   | pg_partman investigation ([gorge-db-state.md](gorge-db-state.md)) | ✅ Done        |
| 1   | CDK deploy: create staging PG18 + run migration                   | ← You are here |
| 2   | Verify data on staging PG18                                       | Pending        |

**One `cdk deploy`.** PG13 untouched throughout. Revert = remove staging PG18 from CDK and redeploy.

---

## Prerequisites (done)

- `ghcr.io/whitewater-guide/postgres` → PG18, PostGIS 3.6.2, pg_partman 5.2.4, pg_cron 1.6
- `ghcr.io/whitewater-guide/pg_dump_restore` → PG18 client tools (version 4.0.0)
- pg_partman investigation complete — see [gorge-db-state.md](gorge-db-state.md)
- Decision: dump gorge with `--exclude-schema=partman`, drop the phantom partman cron job

---

## CDK changes

### Instance sizing

The staging PG18 is **temporary and larger than needed for normal operation** — sized to make the 19 GB gorge restore fast.

Suggested: `db.t3.medium` (2 vCPU, 4 GB RAM) or `db.m5.large` (2 vCPU, 8 GB RAM). Pick based on acceptable restore window. At `db.t3.micro` speeds the restore could take 2–3h.

### Files to create/modify

**`lib/database/constants.ts`** — add:

```typescript
export const POSTGRES18_STAGING_SECRET_NAME = 'Pg18Staging';
```

**`lib/database/Postgres18Staging.ts`** — copy of `Postgres13.ts`, with:

- Engine: `rds.PostgresEngineVersion.VER_18` (or `VER_18_2`)
- Construct ID: `'Pg18Staging'`
- Instance type: `db.t3.medium` (or larger — your choice)
- Secret name: `POSTGRES18_STAGING_SECRET_NAME`
- **No CloudMap** — not serving app traffic
- `deletionProtection: false` — temporary instance
- `removalPolicy: RemovalPolicy.SNAPSHOT` — keep snapshot when removed
- `backupRetention: Duration.days(0)` — no automated backups needed
- Alarms: `'Pg18StagingHighCPU'`, `'Pg18StagingLowStorage'`
- No parameter group needed unless pg_cron required here (it isn't for staging)

**`lib/database/migrators/13-to-18/Dockerfile`**:

```dockerfile
FROM ghcr.io/whitewater-guide/pg_dump_restore:3.6.1
COPY migrate.sh /app/migrate.sh
ENTRYPOINT ["/app/migrate.sh"]
```

> Uses `3.6.1` (PG13 client tools) — correct, dumping FROM PG13.

**`lib/database/migrators/13-to-18/migrate.sh`**:

```bash
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
```

**`lib/database/migrators/13-to-18/Migrate13To18TaskDefinition.ts`** — same pattern as `lib/database/migrators/12-to-13/Migrate12To13TaskDefinition.ts`:

- Env vars: `PG13_HOST`, `PG13_PASSWORD`, `PG18_HOST`, `PG18_PASSWORD` from secrets
- `S3_BUCKET` = `backups.{topLevelDomain}`, `S3_PREFIX` = `v3/`
- **`ephemeralStorageGiB: 50`** — gorge is 19 GB; default 20 GB ECS ephemeral is too tight

**`lib/database/migrators/13-to-18/Migrate13To18Provider.ts`** — identical to `Migrate12To13Provider.ts`. Lambda polls ECS task. Use **3h timeout** (not 2h — gorge restore on t3.micro can exceed 2h).

**`lib/database/migrators/13-to-18/lambda.ts`** — same as 12→13 lambda. `Create` event only.

**`lib/database/migrators/13-to-18/Migrate13To18.ts`** — same orchestrator as `Migrate12To13.ts`. Props: `cluster`, `secrets: { pg13, pg18Staging }`. No temp DB needed.

**`lib/database/index.ts`** — add (no other changes):

```typescript
const pg18Staging = new Postgres18Staging(this, props);
new Migrate13To18(this, 'Migrate13To18', {
  cluster: props.cluster,
  secrets: { pg13: pg13.secret, pg18: pg18Staging.secret },
});
// ScheduledBackup, PGInit, Postgres13: unchanged
```

---

## Deploy

```bash
npm install
npm run build
npm run cdk -- synth "DevStack/Db" --profile dev
# Check: new Pg18Staging instance + Migrate13To18 CustomResource visible
# Check: no changes to Pg13, ScheduledBackup, PGInit

# Test on dev first
npm run cdk -- deploy "DevStack/Db" --profile dev

# Prod
npm run cdk -- deploy "ProdStack/Db" --profile prod
```

CloudFormation creates staging PG18 (several minutes), then the Custom Resource triggers the ECS migration task. The Provider lambda polls until the task exits (up to 3h).

---

## Verify

**1. ECS task logs in CloudWatch** — final line should be `=== Migration complete ===`.

**2. Connect to staging PG18 and run the queries below.**

### Server version

```sql
SHOW server_version;
-- Expected: 18.x
```

### All three databases present

```sql
\l
-- Expected: gorge, wwguide, synapse
```

### gorge: row counts

```sql
\c gorge

-- Total measurements (should be close to PG13 count — PG13 received some
-- writes after migration started, so a small gap is expected)
SELECT count(*) FROM measurements;
-- Expected: ~104M

SELECT count(*) FROM gauges;
```

### gorge: partition structure

```sql
-- All child partitions of measurements
SELECT
  child.relname                                         AS partition,
  pg_get_expr(child.relpartbound, child.oid, true)      AS range
FROM pg_inherits
JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
JOIN pg_class child  ON child.oid  = pg_inherits.inhrelid
WHERE parent.relname = 'measurements'
ORDER BY child.relname;
-- Expected: measurements_default (all data) + measurements_p2037_06 (empty)
-- Same structure as PG13 — partitioning fix is Stage 2

-- Row count per partition
SELECT tableoid::regclass AS partition, count(*)
FROM measurements
GROUP BY tableoid
ORDER BY partition;
-- Expected: measurements_default ~104M, measurements_p2037_06 0

-- Timestamp range
SELECT min(timestamp), max(timestamp) FROM measurements;
-- Expected: ~2022-03 → 2037-06-22 (matches PG13)
```

### gorge: no partman schema

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name = 'partman';
-- Expected: 0 rows

SELECT extname, extversion
FROM pg_extension
ORDER BY extname;
-- Expected: fuzzystrmatch, pg_trgm, postgis, postgis_tiger_geocoder, uuid-ossp  (no pg_partman)
```

### postgres: no cron jobs

```sql
\c postgres

SELECT jobname, database, command, active
FROM cron.job;
-- Expected: 0 rows — migrate.sh deletes all jobs matching '%partman%'
```

### wwguide: extensions present

```sql
\c wwguide

SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm', 'uuid-ossp') ORDER BY extname;
-- Expected: 3 rows — migrate.sh creates them explicitly after restore
```

### wwguide: sanity check

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM regions;
```

### synapse: sanity check

```sql
\c synapse

SELECT count(*) FROM events;   -- or any large table
```

**3. S3 backup landed:**

```bash
aws s3 ls s3://backups.whitewater.guide/v3/ --profile prod
# Should show files with today's timestamp
```

---

## What can go wrong

| Problem                          | Likely cause                                        | Fix                                                                                                                 |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ECS task fails, CF rolls back    | pg_restore error / bad env var                      | Check CloudWatch logs. Fix migrate.sh. CF holds — delete the Custom Resource manually and redeploy. PG13 untouched. |
| `VER_18` not found in CDK        | CDK version too old                                 | `npm install aws-cdk-lib@latest`                                                                                    |
| Task times out (3h)              | Slow restore on small instance                      | Increase timeout in Provider, or upgrade instance type. Re-deploy after CF failure.                                 |
| Disk full in ECS task            | 3 databases exceed ephemeral storage                | Confirm `ephemeralStorageGiB: 50` in task definition                                                                |
| S3 backup fails at end           | IAM on task role                                    | Fix policy. Data is on staging PG18 — run backup manually via `npm run manual`.                                     |
| `cron.job` still has partman row | pg_cron not loaded in staging (cron schema missing) | Connect and run `DELETE FROM cron.job WHERE jobname LIKE '%partman%';` or ignore if cron schema absent              |

**Revert:** Remove `Postgres18Staging` and `Migrate13To18` from `index.ts`, redeploy. Staging PG18 is destroyed with a final snapshot (`RemovalPolicy.SNAPSHOT`). PG13 continues serving.

---

## Files summary

| File                                                                                                                             | Action                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [lib/database/constants.ts](lib/database/constants.ts)                                                                           | Add `POSTGRES18_STAGING_SECRET_NAME`      |
| [lib/database/Postgres18Staging.ts](lib/database/Postgres18Staging.ts)                                                           | **Create**                                |
| [lib/database/migrators/13-to-18/Dockerfile](lib/database/migrators/13-to-18/Dockerfile)                                         | **Create**                                |
| [lib/database/migrators/13-to-18/migrate.sh](lib/database/migrators/13-to-18/migrate.sh)                                         | **Create**                                |
| [lib/database/migrators/13-to-18/Migrate13To18TaskDefinition.ts](lib/database/migrators/13-to-18/Migrate13To18TaskDefinition.ts) | **Create**                                |
| [lib/database/migrators/13-to-18/Migrate13To18Provider.ts](lib/database/migrators/13-to-18/Migrate13To18Provider.ts)             | **Create**                                |
| [lib/database/migrators/13-to-18/lambda.ts](lib/database/migrators/13-to-18/lambda.ts)                                           | **Create**                                |
| [lib/database/migrators/13-to-18/Migrate13To18.ts](lib/database/migrators/13-to-18/Migrate13To18.ts)                             | **Create**                                |
| [lib/database/index.ts](lib/database/index.ts)                                                                                   | Add `Postgres18Staging` + `Migrate13To18` |

---

## Checklist

- [x] pg_partman decision: drop it (partitioning never worked — see [gorge-db-state.md](gorge-db-state.md))
- [ ] `npm run build` succeeds
- [ ] `npm run cdk -- synth` (Dev): staging PG18 + migration visible, no changes to PG13
- [ ] Dev Deploy: ECS task exits 0
- [ ] Prod Deploy: row counts match PG13, no partman schema, no cron jobs, S3 backup present
