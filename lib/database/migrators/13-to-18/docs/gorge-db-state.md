# gorge Database State Analysis

Findings from diagnostic queries run against production PG13 on 2026-04-04.

---

## Instance

- PostgreSQL 13.4 on AWS RDS
- Instance type: `db.t3.micro`
- Storage: 20 GB allocated, 100 GB max

---

## Databases

Three application databases: `wwguide`, `gorge`, `synapse`. All run on the same RDS instance.

---

## gorge database

### measurements table

```sql
CREATE TABLE measurements (...) PARTITION BY RANGE (timestamp);
```

| Fact                      | Value                                            |
| ------------------------- | ------------------------------------------------ |
| Table type                | Declarative range-partitioned                    |
| Partition column          | `timestamp` (timestamptz)                        |
| Total rows                | **104,207,157**                                  |
| Total data size           | **19 GB** (sum of all child partitions)          |
| Date range                | `2022-03-01` → `2037-06-22`                      |
| Data in default partition | **100%** — `measurements_default` holds all rows |

### Child partitions

| Partition               | Range                   | Row count              |
| ----------------------- | ----------------------- | ---------------------- |
| `measurements_default`  | DEFAULT                 | 104,207,157 (all data) |
| `measurements_p2037_06` | 2037-06-01 → 2037-07-01 | 0 (empty)              |

### Monthly distribution (measurements_default)

All data is in `measurements_default`. Distribution by month:

| Period            | Approx rows/month |
| ----------------- | ----------------- |
| 2022-03 → 2022-12 | ~1.75M/month      |
| 2023-01 → 2023-09 | ~1.8–1.9M/month   |
| 2023-10 → 2023-12 | ~2.2M/month       |
| 2024-01 → 2026-03 | ~2.1–2.6M/month   |
| 2026-04 (partial) | ~258K             |

Growth trend: ~1.75M rows/month in 2022 → ~2.5M rows/month in 2025–2026.

### The 2037 data

`max(timestamp) = 2037-06-22 10:03:00+00` — bad timestamps from at least one gauge source returning garbage data. `measurements_p2037_06` was created by pg_partman in response to seeing these timestamps, but the data still landed in `measurements_default` (the partition was created after the insert had already happened).

---

## pg_partman state

Extension version: `4.5.1` (installed in `partman` schema)

`part_config` row:

| Column                     | Value                 |
| -------------------------- | --------------------- |
| `parent_table`             | `public.measurements` |
| `partition_interval`       | `1 mon`               |
| `retention`                | `13 months`           |
| `retention_schema`         | `archive`             |
| `retention_keep_table`     | `true`                |
| `premake`                  | `6`                   |
| `infinite_time_partitions` | `true`                |

Archive schema: **empty** (0 tables). Retention never triggered.

---

## pg_cron state

Extension installed in `postgres` database. One job:

| jobid | jobname               | schedule  | database | command                               | active |
| ----- | --------------------- | --------- | -------- | ------------------------------------- | ------ |
| 1     | `partman_maintetance` | `@hourly` | `gorge`  | `CALL partman.run_maintenance_proc()` | `true` |

Note: typo in jobname (`maintetance` not `maintenance`).

Job run history: consistently `succeeded` in ~300–850ms. Returns `return_message = 'CALL'`.

---

## Root cause: why partitioning never worked

### The failure

Attempting to add any monthly partition fails with:

```
ERROR: updated partition constraint for default partition "measurements_default"
       would be violated by some row
```

This is a hard PostgreSQL constraint: **a new partition cannot be created if the default partition already contains rows whose timestamps fall within the new partition's range.** Since `measurements_default` contains rows for every month from 2022-03 to 2026-04, no monthly partition can ever be created for any of those months.

### Why the cron job reports "succeeded"

`run_maintenance_proc()` is a stored procedure. It attempts to create new partitions, encounters the constraint violation, handles it internally (without re-raising), and returns normally. pg_cron sees the procedure complete without an unhandled exception → records `succeeded`. The procedure completes in ~476ms because:

1. It looks at the latest child partition: `measurements_p2037_06` (June 2037)
2. Calculates: partitions already exist through June 2037, which is well beyond `now + premake(6 months)`
3. Concludes there is nothing to create → exits immediately

### How it got into this state

Most likely sequence during the 12→13 migration:

1. `CREATE TABLE measurements (...) PARTITION BY RANGE (timestamp)` created on empty PG13
2. `SELECT partman.create_parent(...)` called — created a few monthly partitions around migration time + default partition
3. `pg_restore gorge.bak --clean` ran with `--clean` flag, which issues `DROP ... CASCADE` before recreating objects, destroying the partman-created child partitions
4. Restored measurements data (spanning 2022 onwards) into what was now a table with only a `measurements_default` partition → all rows landed in default
5. From that point forward, every attempt by the hourly maintenance job to create monthly partitions failed with the constraint violation
6. The only partition that ever succeeded was `measurements_p2037_06` — created at some point when the 2037 bad data was first inserted and there was no data in default for that range yet

### What this means

- Partition pruning has **never worked** for gorge queries. All queries on `measurements` scan the full 19 GB default partition.
- pg_partman has been running for ~4 years while silently failing to do anything.
- Fixing this requires moving data out of `measurements_default` into monthly partitions — a multi-step process (see Stage 2 plan).

---

## Extensions (gorge database)

| Extension              | Version |
| ---------------------- | ------- |
| fuzzystrmatch          | 1.1     |
| pg_partman             | 4.5.1   |
| pg_trgm                | 1.5     |
| postgis                | 3.1.x   |
| postgis_tiger_geocoder | 3.1.x   |
| postgis_topology       | 3.1.x   |
| uuid-ossp              | 1.1     |

pg_cron is installed in the `postgres` database, not gorge directly.

---

## wwguide and synapse databases

No partitioning. Standard relational tables. No known issues. Not investigated in depth during this diagnostic session.
