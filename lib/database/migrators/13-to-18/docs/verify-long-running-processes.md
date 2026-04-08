# Verification Checklist: Long-Running Processes After PG18 Migration

## 1. pg_cron (partman maintenance job)

**Right after cutover (Step 13):**

```sql
-- [postgres db] Job exists, targets gorge, is active
SELECT jobname, schedule, database, command, active FROM cron.job;
-- Expected: 1 row — jobname='partman_maintenance', schedule='@hourly',
--           database='gorge', active=true
-- Note: typo from PG13 ('maintetance') must NOT appear — the new job has correct spelling
```

**After the first full hour has passed:**

```sql
-- [postgres db] Cron ran at least once and succeeded
SELECT runid, status, start_time, end_time, return_message
FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 5;
-- Expected: status='succeeded' rows, return_message='CALL'
-- If status='failed': check return_message for the actual error
```

**Ongoing (monthly):** Re-run the above. Each new entry should be `succeeded`. If you see a gap of >2h with no entries, the job is stuck or the pg_cron extension failed to load (check `shared_preload_libraries='pg_cron'` in the parameter group).

---

## 2. pg_partman (partition creation + retention)

**Right after cutover:**

```sql
-- [gorge db] Config row is intact
SELECT parent_table, partition_interval, retention, retention_schema,
       retention_keep_table, premake, infinite_time_partitions
FROM partman.part_config;
-- Expected: 1 row, interval='1 mon', retention='13 months',
--           retention_schema='archive', retention_keep_table=true, premake=6
```

**At the start of each new month (e.g. first day of May 2026):**

```sql
-- [gorge db] New monthly partition was auto-created (premake=6 means it should exist 6 months ahead)
SELECT min(tablename), max(tablename), count(*)
FROM pg_tables
WHERE tablename LIKE 'measurements_p%';
-- Expected: max partition is at least 6 months ahead of today
-- count grows by 1 each month

-- New data lands in the current month's partition, NOT in default
SELECT count(*) FROM measurements_default;
-- Expected: 0 at all times (this is the canary — any non-zero is a partitioning failure)
```

**After ~13 months of operation (approx May 2027):**

```sql
-- [gorge db] Old partitions moved to archive schema
SELECT tablename FROM pg_tables WHERE schemaname = 'archive' ORDER BY tablename;
-- Expected: partitions older than 13 months (e.g. measurements_p20220301 etc.)
-- Should appear automatically once partman maintenance runs after the retention window expires

-- Partition is still accessible (retention_keep_table=true)
SELECT count(*) FROM archive.measurements_p20220301;
```

---

## 3. S3 Backups (ScheduledBackup ECS task)

**Right after cutover and daily thereafter:**

```bash
# Backups are written to v4/ prefix
aws s3 ls s3://backups.whitewater.guide/v4/ --profile ww-prod | sort | tail -5
# Expected: files with today's (or yesterday's) date — task runs every 24h

# Check ECS task ran successfully (look for the most recent Backup log stream)
aws logs describe-log-streams \
  --log-group-name /ecs/Backup \
  --order-by LastEventTime --descending \
  --max-items 3 \
  --profile ww-prod --region us-east-1
# Then inspect the latest stream:
aws logs get-log-events \
  --log-group-name /ecs/Backup \
  --log-stream-name <stream-name-from-above> \
  --profile ww-prod --region us-east-1
# Expected: no errors, task exits 0
```

**If a day is missed:** the ScheduledFargateTask has no built-in retry — check the EventBridge rule for missed invocations in the AWS console (Events → Rules → `ScheduledBackup*`).

---

## 4. Backup Restore Test

**Do this once after cutover, and repeat every 3–6 months:**

```bash
# Run the manual restore script against dev (restores prod backup → dev DB)
npm run manual --profile dev
# This exercises the full restore path: S3 → pg_dump_restore container → dev PG18
```

After restore completes, connect to dev PG18 and verify:

```sql
-- [dev gorge] Data arrived and is in monthly partitions (not default)
SELECT count(*) FROM measurements;
-- Expected: similar row count to prod

SELECT count(*) FROM measurements_default;
-- Expected: 0

SELECT max(timestamp) FROM measurements;
-- Expected: close to prod's latest timestamp

-- [dev wwguide]
SELECT count(*) FROM users;
SELECT count(*) FROM regions;

-- [dev synapse]
SELECT count(*) FROM events;
```

Also verify extensions survived restore:

```sql
-- [dev gorge]
SELECT extname, extversion FROM pg_extension ORDER BY extname;
-- Expected: pg_partman 5.x, postgis, pg_trgm, uuid-ossp (and fuzzystrmatch)

-- [dev postgres]
SELECT jobname, schedule, database, active FROM cron.job;
-- Expected: partman_maintenance job exists and is active
```

---

## 5. RDS Automated Backups (belt-and-suspenders)

```bash
# Verify automated snapshots are being taken (prod has backupRetention=3 days)
aws rds describe-db-snapshots \
  --db-instance-identifier <pg18-instance-id> \
  --snapshot-type automated \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table \
  --profile ww-prod --region us-east-1
# Expected: entries within the last 3 days, all Status=available
```

---

## 6. Storage Growth (monthly check)

With ~2.5M rows/month × ~180 bytes/row ≈ ~450 MB/month of new data. Current allocation is 40 GB (max 150 GB).

```bash
# CloudWatch alarm Pg18LowStorage fires at 5 GB free — but check proactively:
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value=<pg18-instance-id> \
  --start-time $(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 --statistics Minimum \
  --profile ww-prod --region us-east-1
```

Once archival starts working (~May 2027), storage should stabilize as partitions older than 13 months get moved to the `archive` schema (they stay in the same DB, so storage won't shrink — but growth will slow since old data won't be duplicated with new writes).

---

## Quick reference: what breaks silently

| Process              | Failure mode                                                       | Canary                                                              |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| pg_cron              | Job not scheduled / extension not loaded                           | `cron.job` has 0 rows after restart                                 |
| pg_partman           | New month has no partition → rows fall into `measurements_default` | `SELECT count(*) FROM measurements_default` is non-zero             |
| pg_partman retention | Partitions never move to `archive`                                 | `pg_tables WHERE schemaname='archive'` stays empty after 13+ months |
| ScheduledBackup      | ECS task fails silently                                            | No new objects in `s3://backups.whitewater.guide/v4/` for 48+ hours |
| Restore              | Backup files exist but are corrupt or wrong version                | Restore test on dev fails or row counts mismatch                    |
