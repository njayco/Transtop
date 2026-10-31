# Transit import performance and operations

**Paris regional exception:** IDFM uses a separate disk-backed, bounded importer
and geographic/route-scoped readers rather than the small-feed memory path below.
It has source-specific conditional refresh and a public-use compliance gate.
See [IDFM limits, licensing, operation and verification](idfm.md). The 100 MiB
small-feed limit below is unchanged for unrelated providers.

## Publication strategy

No database schema migration or initial data rewrite is required. Existing
`mode='live'` stop-time datasets remain readable through the legacy fallback.
Deploy **all API readers and the importer together** before importing new feeds.
Do not run an old API process alongside a new importer after generation publication.

The large stop-times table keeps its unique staging mode permanently. The agency's
`static` feed snapshot points to that mode. Trips, calendars, routes, stops, shapes,
and source metadata still publish in one transaction, with the stop-time reference.
All six MTA bus packages must finish before that transaction starts. Stop/route
IDs are unchanged; independently published trip/service/shape IDs remain scoped.

Every stop-time SQL reader resolves the reference inside its own SQL statement,
using the same PostgreSQL MVCC snapshot as its joins to the published catalog.
It must **not** reuse a reference from a cached health response or join
`trip.mode = stop_time.mode`. Demo rows remain separate.

### Bulk loading

- Stop-time batches use one JSON parameter and `jsonb_to_recordset`, instead of
  building a Drizzle SQL expression and many parameters for every row.
- Flush at 1,500 rows or approximately 1 MiB of encoded rows (plus the final row).
  CSV records have a 256 KiB parsing limit for the bulk-loaded files.
- Download buffering stops at 100 MiB of compressed bytes; previously this limit
  was checked only after the entire response was buffered. ZIP contents stream
  through the parser. Stop/route membership and shape aggregation remain in memory.
- Load, parse, and database insertion are serial/backpressured; there is no parallel
  six-package fan-out competing with interactive queries.
- `COPY` was considered but not selected: JSON recordsets need no new driver or
  escaping layer, preserve the existing conflict policy, and keep batches bounded.
  Partition swaps would require a schema/data migration and stronger DDL locking;
  the generation reference removes the dominant rewrite without either.

### Statistics and cleanup

Analyze stop-times **before** changing the reference. Analyze the smaller catalog
tables after their mode promotion, inside the publication transaction. An analyze
failure therefore cannot expose a newly published dataset with missing statistics.
Publication has a five-second lock wait limit; an error rolls the transaction back.

Each generation has a small registry entry in feed snapshots, written before
staging begins. The shared advisory lock protects import, maintenance, and rollback,
including direct importer calls (not only the CLI and scheduler).

Cleanup skips the currently referenced generation. It deletes at most 2,000 rows
per transaction and 20,000 rows per invocation, pausing between batches. An index
cursor is committed with each delete, avoiding repeated traversal of dead rows.
Each transaction has a 250 ms lock wait limit and a two-second statement limit.
Failed staging and retired generations resume cleanup after a process restart.
Cleanup failures after publication are warnings, not failed imports.

Maintenance runs at startup and every minute whether automatic downloading is
enabled or not. Automatic downloads remain opt-in (`TRANSIT_AUTO_IMPORT=true`);
an hourly freshness check only downloads feeds older than 22 hours. This retries
busy locks or temporary failures without waiting another full day.

Cleanup can remove 28.8 million rows/day at its default budget when continuously
running. Leave disk headroom for current and staged/retired generations, indexes,
WAL, and dead tuples awaiting autovacuum. Avoid repeatedly importing large agencies
faster than this budget can retire them.

Use ordinary PostgreSQL autovacuum for reclaimed space and ongoing statistics.
Do not run `VACUUM FULL`, `TRUNCATE`, table rewrites, or blocking reindex operations
as part of a daily refresh. Ordinary `VACUUM (ANALYZE) transit_stop_times` can be
scheduled separately if monitoring shows autovacuum lag; deletion itself does not
return relation files to the filesystem.

## Compatibility rollback

Never simply deploy old code after the first generation-based import: old readers
only read `mode='live'`, so doing so would hide schedules.

1. Disable automatic imports and stop old importer processes. Leave the new API
   serving requests while compatibility copies are prepared. Take a normal
   database backup and ensure enough free disk for a second stop-time copy.
2. For each imported agency, run:
   ```sh
   pnpm --filter @workspace/api-server run restore-legacy-gtfs mta-bus
   ```
   Multiple explicit agency IDs are supported. There is intentionally no implicit
   “all agencies” target.
3. The command holds the existing advisory lock, removes partial legacy copies in
   small batches, copies the active generation into `live` in 1,500-row batches,
   analyzes the table, verifies row counts, then removes only the reference field
   in a final metadata transaction. Source dates/URLs and stable IDs are retained.
   New readers keep using the complete immutable source throughout copying.
4. A failed/interrupted copy leaves the active reference intact; rerun the command.
   A completed command is idempotent. Once all relevant agencies are converted,
   old API/import code can be restored. Do not allow a new automatic import between
   conversion and restoring old code.

This is a code-compatibility rollback, **not** a historical timetable restore.
Failed normal imports already preserve the previous published catalog through
transaction rollback. Historical recovery after a successful refresh requires a
database backup, as before. No production conversion or migration was run here.

## Reproducing the isolated checks

The scripts deliberately ignore the workspace database URL and connect only to
`benchmark@127.0.0.1:55439`, databases `gtfs_import_test` and `gtfs_bench`. They
destructively reset **only those disposable databases**. Do not point another
service at these names/port.

```sh
mkdir -p generated-artifacts/gtfs-pg
initdb -D generated-artifacts/gtfs-pg/data -A trust -U benchmark --no-locale
# Keep this foreground process in a separate background shell task:
postgres -D generated-artifacts/gtfs-pg/data -p 55439 -h 127.0.0.1 -k /tmp
# In another shell:
createdb -h 127.0.0.1 -p 55439 -U benchmark gtfs_import_test
createdb -h 127.0.0.1 -p 55439 -U benchmark gtfs_bench
pnpm --filter @workspace/api-server run test:gtfs-import
pnpm --filter @workspace/api-server run bench:gtfs
pnpm --filter @workspace/api-server exec tsc -p tests/tsconfig.json --noEmit
```

Stop the disposable server afterward. Generated databases, archives, logs, and
JSON results live under the ignored `generated-artifacts/` directory and are not
included in Git or deployments.

### What the measurements cover

The synthetic bulk benchmark starts with 1.2 million published stop times and
loads another 1.2 million, representing six equal package segments. It has 60,000
trips, 60 routes, 2,000 stops, calendars, and shapes, with current indexes. Both
strategies use the same generated records, 1,500-row batches, small-table
promotion, and continuously running real catalog, stop-timetable, route-timetable,
and cached network readers. “Before” reproduces the original Drizzle insert /
delete-live / update-stage-to-live path; “after” uses the JSON loader / reference
publication path. Import duration includes staging, publication, and explicit
statistics work, but excludes HTTP downloads, ZIP/CSV parsing, and initial fixture
seeding. These are local PostgreSQL measurements, not production capacity claims.

A second benchmark drains retired rows with the production cleanup code while
catalog/timetable readers run. It invokes minute-sized budgets back-to-back to
measure database work, not real-world elapsed retirement time. WAL is measured
with PostgreSQL LSN differences. Tuple counters report actual inserts/updates/
deletes; the large-table rewrite saved is one update and associated index writes
per imported stop-time row. Retired rows still eventually require one delete.

### Recorded results — 2026-10-30

Local PostgreSQL 16.15, default durability settings, 1,200,000 replacement rows:

| Measurement | Before | After |
| --- | ---: | ---: |
| Bounded staging/load | 103.08 s | 44.91 s |
| Publication transaction | 28.05 s | 1.28 s |
| Import including explicit statistics | 132.08 s | 46.85 s |
| WAL before deferred retirement | 2,314.75 MiB | 871.48 MiB |
| Tuple updates during import | 1,262,062 | 62,063 |
| Tuple deletes during import | 1,262,062 | 62,062 |
| Concurrent catalog p50 / p95 | 13.93 / 121.19 ms | 4.79 / 46.91 ms |
| Concurrent stop timetable p50 / p95 | 204.84 / 275.64 ms | 93.56 / 186.32 ms |
| Concurrent route timetable p50 / p95 | 206.60 / 279.05 ms | 155.83 / 192.65 ms |
| Warm network reader p95 | 0.105 ms | 0.082 ms |
| Indexed stop lookup execution | 0.870 ms | 0.572 ms |
| Stop lookup estimated / actual rows | 297 / 600 | 598 / 600 |

Import time fell 64.5%, publication time 95.4%, and pre-retirement WAL 62.4%.
The small-table rewrite remains; 1.2 million stop-time updates and their index
maintenance are eliminated. In a complete refresh lifecycle both versions still
insert and eventually delete the replaced rows, so the large table goes from
three tuple mutations per replacement to two (about one-third fewer), rather than
eliminating deletion work.

There were no reader errors. Catalog samples: 855 before / 361 after; stop
timetable: 419 / 184; route timetable: 415 / 182. These are single representative
samples, not confidence intervals or latency guarantees. Both cases use the same
current reader code to isolate the write strategy. Network uses its normal warm
cache across cases; its values do not measure cold geometry retrieval, and the
tiny difference should not be interpreted as a network-query speedup.

The first 20,000-row cleanup slice took 0.78 s. The remaining 1,180,000 retired rows
drained in 60 further budgeted calls, taking 55.08 s of accelerated wall time and
354.54 MiB additional WAL. During that drain, catalog p95 was 47.86 ms, stop
timetable p95 193.82 ms, and route timetable p95 196.97 ms, with no reader errors.
That WAL is **additional** to the import figure, not included in the 62.4%
critical-path reduction; the first cleanup slice's WAL was not separately sampled.
At the normal one-minute cadence the same retirement spans about an hour, not
55 seconds. All demo and other-operator sentinel rows survived.

The complete raw plans, latency samples summarized by p50/p95/max, and counters
are emitted to `generated-artifacts/gtfs-performance.json` when reproducing the
benchmark. Benchmark databases and generated files are excluded from deployment.

The real importer is separately exercised with six synthetic ZIP archives,
colliding package-local trip IDs, shared stops, exceptions, and untimed stops.
Checks include failed sixth-package download, failed publication transaction,
lock contention, cleanup failure after commit, cursor/budget resume,
abandoned-generation recovery, other-operator/demo isolation, all schedule
readers, and interrupted/idempotent legacy compatibility rollback.
