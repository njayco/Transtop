# Bounded regional Mobility Database imports

## Decision and operating budget

Large networks use detached, immutable call editions in `mobility_data`, not
millions of additional staged calls in the existing 14 GiB shared call table.
Only the completed, indexed edition is attached to the existing reader relation,
in the same transaction that publishes metadata and the edition pointer.
Existing direct adapters, feed-scoped route/stop IDs and saved IDs are unchanged.
The emptying/reorganization of historic shared schedules is separate work.

Automatic discovery keeps its original 20 MiB / 100 MiB / one-million-record
budget. Regional capacity is an **explicit CLI choice**, not a configuration
change that makes arbitrary large feeds auto-import:

| Resource | Regional ceiling |
| --- | --- |
| Compressed / expanded archive | 96 MiB / 768 MiB |
| Agency, route, trip, calendar and call records | 8,000,000 |
| Shape points | 7,000,000; 100,000 per shape |
| Reference stops / trips / routes | 60,000 / 350,000 / 3,000 |
| Stop–route memberships | 500,000 |
| Accounted compact reference identities | 128 MiB |
| Process RSS / import wall clock | 1 GiB / 20 minutes |
| Index build / other storage statements | at most 180 seconds / 120 seconds |
| Database headroom gate | refuse a new edition above 24 GiB; stop at 30 GiB |
| Cached archives | at most eight, one per feed, at most 96 MiB each |

The database thresholds are application safety cutoffs, **not** an assertion
about an account's physical storage quota or authorization to buy more storage.
If a threshold is reached, stop and review capacity; do not silently remove live
data. One import/measurement/cleanup owner holds the existing advisory lock.
The registered-source limit remains eight; automatic registrations remain two
per day. Catalog reservations remain 20 development / 180 published requests
per UTC day, shared across replicas. No new provider terms were accepted.

## How staging, validation and retirement stay bounded

- ZIP downloads still pin public DNS addresses through HTTPS, forbid redirects
  and credentials, and use only the fixed Mobility Database file host. Disk cache
  reuse requires the immutable dataset URL, dataset identity, length and SHA-256.
  Replacing a cache file uses an atomic rename under the shared import lock.
- Inspect the ZIP central directory before allocating entries. Reject duplicate
  names, paths, directories, oversized expansion and excessive compression ratios.
  Every inflated entry stream enforces its declared byte length.
- Call batches use backpressured COPY into an unindexed, detached table. Shape
  points use a temporary COPY table and ordered database aggregation, not a
  multi-million-point JavaScript map. Temporary points disappear when the session
  closes; explicit cleanup also runs after success or failure.
- Bound trip/route/service and stop/membership identities while streaming. Reject
  missing calendars, unknown call/parent stops, inconsistent agency timezones and
  duplicate identities. This avoids a post-load multi-million-call validation
  join. Unique call and shape indexes validate their keys before publication.
- Build call identity, stop/departure and trip/sequence indexes, then ANALYZE the
  detached edition. Publication attaches it with a five-second lock-wait bound,
  atomically updates all catalog records and the pointer, and commits. A failure,
  including a failure after the inheritance DDL, rolls the whole publication back.
- Generation retirement drops a whole inactive call edition without CASCADE,
  then drains only its smaller metadata in bounded slices. Active pointers are
  excluded. A failed edition must finish retiring before another is allocated.
  Ordinary maintenance has a two-second scheduling budget, plus at most the
  current bounded statement; import cleanup is scoped to its own source.
- An unchanged immutable dataset with this storage method retains its complete
  edition instead of copying millions of rows daily. It records a checked time.

## Regional read and startup budget

Large regional stops and paths do not enter the legacy global caches. SQL limits
stop transfer to 500 and regional maps to city-level viewports, 12 routes,
64 paths, 120,000 raw points per selected route and 40,000 simplified points per
map response. Provider-selected search is independently paginated. Nearby,
direct stop/route links and dated timetables use the same IDs as existing
favorites; parent/platform membership remains publisher-supplied.

No large import, cache checksum, index construction or timetable preload runs on
the HTTP listening path. The existing production command starts the built Node
server directly; scheduled regional refreshes start asynchronously after registry
restoration. A development workflow rebuild measured 612 ms, and its server
reported listening before the asynchronous catalog/refresh failures. Existing
`/api/healthz` requests measured about 4 ms while staging was active.
This is a workspace startup check, not a new production deployment or a promise
about production infrastructure. Published-database connection stability remains
separate work.

## Measurements before enabling larger imports

On 2026-10-31, a disposable local PostgreSQL benchmark loaded **2,000,000** calls:

| Measurement | Result |
| --- | --- |
| Backpressured call staging | 60,800 ms |
| Unique/lookup index builds and statistics | 22,142 ms |
| Complete edition including indexes | 923,811,840 bytes |
| Inactive-edition retirement and safety assertions | 169 ms |
| Importer RSS at completion | 289,259,520 bytes |

The detached read plan was a parent index scan (0.027 ms execution) and did not
include the staging relation. After attachment the selected stop query used the
edition stop index (1,000 calls, about 4 ms execution). A separate-provider query
still excluded the edition by its constant mode constraint. Cleanup retained the
active edition and another provider's row, and removed the inactive edition.
The fixture suite separately forces invalid references, timezone changes,
duplicate calls, frequency templates, bad coordinates and a publication-trigger
failure; the previous edition remains readable after each failure.

The candidate Berlin–Brandenburg archive measured:

- Official catalog identity `mdb-3233`, dataset `mdb-3233-202608220112`.
- SPDX CC-BY-4.0 **and** canonical
  <https://creativecommons.org/licenses/by/4.0/>; no separate authentication.
- Catalog zone Europe/Berlin; agency rows are checked again during import.
- 83,251,265 compressed bytes; 670,521,491 expanded bytes.
- 6,247,945 input calls; 6,090,977 supplied shape points; 282,294 input trips;
  42,147 input stops; 1,264 input routes; 38 operators.
- SHA-256 `cfb88964afbbd2af785ce0fb17ae6064a50fc6e1abc65a8f72339f52031a41d7`.
- Unsupported native modes are withheld; their input counts are not rider
  coverage counts. No realtime companion or vehicle GPS is claimed.

During the real staging trial, existing Canberra catalog requests completed
successfully in about 1.16 seconds; NYC catalog requests ranged from 37 ms to
2.70 seconds. These are observed samples under import load, not latency SLAs.

## Completed regional trial and rider acceptance

The development import completed in **491,697 ms** (8 minutes 12 seconds).
The sealed call edition occupied **3,635,265,536 bytes**, including indexes.
Measured importer peak RSS was **682,160,128 bytes**. The database was about
19.35 GB at acceptance (including pre-existing data and unrelated staging).
Published coverage was **1,257 supported routes**, **27,540 retained stops**
and **6,567,657 agency/route/trip/calendar/call records**. Unsupported ferry
records and unused stop records were not promoted.

The read-only acceptance script verified through the normal API:

| Rider operation | Observed response |
| --- | --- |
| Alexanderplatz search, selected regional provider | 378 ms |
| Nearby, selected regional provider | 2,935 ms |
| Direct Alexanderplatz stop and license/timezone | 187 ms |
| Dated U2 departures, 2026-10-31 | 322 ms |
| Out-of-window 2030 date, no substituted departures | 4 ms |
| Selected U2 map, bounded to 64 supplied paths | 190 ms |
| U2 representative route detail, 7 stops / 62 shape points | 1,334 ms |
| Source credits with canonical CC BY 4.0 URL | 166 ms |
| Existing saved Canberra stop identity | still resolves unchanged |
| Existing NYC catalog | 64 ms |

The first acceptance run exposed a repeated whole-calendar scan in scheduled
arrivals at busy stations. Regional arrival reads now restrict exceptions to
the selected services/dates, filter calls to upcoming service-day time windows,
and reuse calendar decisions and GTFS-noon time bases rather than recomputing
them per call. This preserves source-zone overnight and cancellation behavior.
Selected regional maps also bypass the unrelated whole-network geometry cache.

The real edition's stop lookup and first-call trip lookup plans were indexed;
observed execution times were 0.058 ms and 0.542 ms respectively. These are
database plan timings, separate from end-to-end API timings above. Source credits
identify VBB, Mobility Database, dataset/download date, canonical license and
Europe/Berlin. This is scheduled-only coverage in development, not a claim that
the published app now has this dataset or live vehicle observations.

## Reproduce the checks

From `artifacts/api-server`:

```sh
pnpm run test:mobility

# Start a disposable foreground PostgreSQL server on 127.0.0.1:55440.
# Never point these destructive fixture/benchmark scripts at a workspace DB.
# initdb -D <ignored-local-directory> -U benchmark -A trust
# postgres -D <ignored-local-directory> -h 127.0.0.1 -p 55440 -k /tmp
# createdb -h 127.0.0.1 -p 55440 -U benchmark mobility_import_test
pnpm run bench:mobility
pnpm run test:mobility-import

# Operator checks, not routine CI; uses normal bounded feed access.
pnpm exec tsx tests/mobility-capacity-probe.ts mdb-3233
pnpm exec tsx src/transit/mobility/cli.ts import-regional-cached mdb-3233
pnpm exec tsx tests/mobility-regional-live.ts
```

Raw measurements and query plans are written under ignored
`generated-artifacts/mobility/`; they are not bundled, deployed or checked into
Git. A fresh environment needs its own eligible catalog evidence and successful
import. Development data does not establish published-app coverage.
