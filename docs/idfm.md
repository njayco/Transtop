# Île-de-France Mobilités scheduled transit

## Permission and source boundary

The owner approved scheduled-data use under **Licence Mobilités**, after being
informed of attribution, freshness and conditional sharing duties. This does not
authorize PRIM registration, paid plans, new agreements, external
uploads or sending messages on the owner's behalf.

The two supplied catalog exports are discovery/provenance inputs, not transit
records. The CSV has 94 dataset entries with semicolon-delimited multiline HTML.
No catalog descriptions are inserted as HTML or treated as departures.

The two subsequently supplied Swagger JSON files both describe the same PRIM
`GET /marketplace/estimated-timetable` endpoint. They are API definitions, not
realtime records, and their response object has no defined properties. The
endpoint supplies partial-network arrival predictions, not vehicle GPS or a
replacement for the regional stop/route database and dated schedules. It needs a
PRIM account/API key and an approved account-specific request budget. Its
documentation also has a separate API/data-license boundary (the API text says
ODbL; the catalog header says Licence Mobilités), which must be resolved before
affected public reuse. The owner initially selected **“Keep schedules for now,”**
then explicitly requested PRIM live/informational data with an existing account
and added `PRIM_API_KEY` through Secrets. No signup, paid service or new agreement
was accepted. The key is used only in a server-side HTTP header, never frontend code.

### PRIM predictions: separately licensed, opt-in account access

The supplied global endpoint is not bulk-polled. Official documentation also
defines [stop-monitoring](https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/idfm-ivtr-requete_unitaire),
which was verified using the owner's key on October 31, 2026. A Métro boarding
point returned HTTP 200 with no visits; Noctilien N02 / Montparnasse returned
HTTP 200 with four real estimates. This verifies those requests, not nationwide
coverage, GPS, all operators, all APIs or the account's formal quota.

- Only a selected stop detail requests live data; Nearby, map and route-stop
  lists never multiply PRIM requests. There is no background bulk download.
- Published numeric GTFS boarding IDs map to documented `STIF:StopPoint:Q:` IDs;
  explicitly supplied parent station `location_type=1` IDs map to `StopArea:SP:`.
  Unsupported identifiers remain unavailable. SNCF station-wide reports are not
  silently assigned to a particular child platform. Parent queries allow only
  their exact supplied child references, capped at 128.
- Exact `STIF:Line::C…:` references must match a route at the selected stop.
  Names/proximity and RATP technical journey counters are not trip crosswalks.
  GTFS and PRIM rows stay separately labelled; duplicates can remain rather than
  hiding distinct trips or directions without proof.
- Only timezone-qualified **Expected** arrival/departure fields produce live
  estimates. Aimed/theoretical fields never become live. Production and response
  timestamps must be within two minutes (30-second future-clock tolerance).
  HTTP refresh cannot extend old production timestamps; expired predictions and
  cancellation notices disappear. Some actual returned Noctilien estimates had
  older production timestamps and are intentionally withheld as stale.
- Supplied destinations, directions, expected clocks, platforms and
  cancelled/missed-call notices are supported. No inferred GPS, general traffic
  feed, fares, journey planner, train length or unsupported informational API
  is enabled.
- Each fetch has an eight-second timeout and a two-MiB expanded-body cap.
  Credentials are never put in query strings, followed to redirects, returned to
  browsers, logged or included in error bodies.
- A shared database advisory lock serializes requests. Persistent atomic counters
  cap each environment at **180 requests per UTC day**, even across process
  restarts/instances. Separate dev/production databases each have that cap;
  these are local safeguards, not proof of provider account quota or allowance
  for other clients using the same key. PRIM documents 1,000/day and 5/second
  default access, but the owner must verify their own consumption/entitlements.
- Stop results cache for 60 seconds, global pacing is at least 15 seconds,
  transient failures back off five minutes, and 401/403/429 back off an hour.
  No automatic retries consume extra requests. Old predictions cannot regain
  freshness through a failed refresh. Small working cache/budget records expire
  after two days, with at most 50 old rows removed per request.
- Set non-secret `PRIM_ENABLED=false` to disable calls without removing the key.
  The existing IDFM public-compliance gate also applies, and production PRIM
  additionally requires its own `PRIM_PUBLIC_COMPLIANCE_CONFIRMED=true` **only after
  the owner resolves the separate PRIM license obligations**. A schedule-only
  confirmation never authorizes PRIM public use. Source status exposes
  configured/disabled state, last check, failures and partial coverage without
  exposing the key.

The current PRIM page's header says Licence Mobilité, while its API/data terms
explicitly link ODbL and July 2022 API conditions. Both notices are linked in the
UI; they are not silently treated as the schedule license. Live records remain
separate working-cache records. The owner has confirmed that the PRIM license
discrepancy and applicable public-use obligations are resolved for this use, and
explicitly authorized the separate PRIM public-use confirmation. Both notices
remain linked; this integration does not claim that either supersedes the other.
This is the owner's confirmation, not an independent legal determination.
**A working API key alone is not public-use confirmation.**

The public gate also withholds retained source inventory, operator names,
import diagnostics and saved-service metadata checks, including positive cache
hits. A saved ID remains on the rider's device and receives an uncertain check,
not a claim that its service was removed. Turning off public permission never
deletes the last-good source edition.

Authenticated opt-in probe (one request; never prints the key):

```sh
PRIM_LIVE_SMOKE=true pnpm --filter @workspace/api-server exec tsx \
  tests/prim-live.ts STIF:StopPoint:Q:37380:
```

The static six-mode smoke disables PRIM independently; its passing schedule
checks are not claims of live prediction coverage. PRIM parser/transport fixtures
test timestamps, identity, stale/theoretical exclusion, cancellation expiry,
response limits and credential-safe errors; the isolated database fixture tests
persistent budget rollover/exhaustion.

Only the official scheduled GTFS is imported:

- [IDFM dataset](https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/)
- [Authorized public archive](https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip)
- [National access point](https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites)
- [Publisher resource redirect](https://www.data.gouv.fr/api/1/datasets/r/413988ed-d340-467b-8be2-7b999fcd207a)
- [GTFS documentation, February 2026](https://eu.ftp.opendatasoft.com/stif/GTFS/opendata_gtfs.pdf)
- [Licence Mobilités, February 3, 2021](https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm/download)

Reverified October 31, 2026: the resource redirect resolves to `IDFM-gtfs.zip`,
HTTP 200, 143,987,527 compressed bytes, last modified October 30 at 15:24 GMT.
The restricted Opendatasoft `/records` API is not used. The nonexistent legacy
`IDFM.zip` and community-modified archives are not substitutes.

`arrets-lignes`, line references and separate geometry datasets have their own
ODbL licenses and are **not imported**. GTFS-supplied shapes, operator attributions
and fields suffice. No PRIM realtime-perimeter dataset becomes predictions.

## Public-use compliance gate — owner action required

IDFM-derived records remain independent from other source databases and subject
to Licence Mobilités. The application does not assert that an independent-source
aggregation, a limited API, or not exposing a ZIP eliminates sharing duties.

- **5.3–5.4:** source and linked license notices appear in the rider footer,
  stop/route details, result cards, maps and source inventory.
- **5.5–5.6:** IDFM records remain separable; no unrelated agency or user data is
  incorporated into an IDFM derivative. Rights in application code and independent
  databases are unchanged.
- **5.8(b):** `/api/transit/idfm/method` freely provides a downloadable text file
  explaining all transformations, selection rules, added technical metadata and
  display algorithms. It identifies the original database and license. This is
  also the public API reuse notice. It is not a replacement for 5.6(d).
- **5.6(d):** same-nature/granularity/time/geographic-extent derivatives can require
  publication under the original PAN dataset in the original format. This
  integration conservatively treats that as an unresolved owner action.
- **5.10:** any required licensor notification for third-party database transfer
  is also an owner action; acceptance cannot be inferred from providing API access.
- **5.7:** source dates, calendar windows, caps, exclusions, unknown fields,
  scheduled-only capability and refresh errors are disclosed; expired editions do
  not supply current departure clocks.

**Production browsing/import is disabled by default** until the owner either
completes the applicable PAN publication/notification or obtains documented
confirmation that these specific actions are unnecessary for this transformation.
The owner has confirmed that all applicable PAN derivative publication and
IDFM/PAN notification actions are complete, and explicitly authorized
`IDFM_PUBLIC_COMPLIANCE_CONFIRMED=true`. This records the owner's confirmation;
Transtop did not publish the derivative or contact IDFM/PAN, and no external
evidence was independently verified. The flag does not complete an action or
grant new rights. Both `REPLIT_DEPLOYMENT=1` and `NODE_ENV=production` enforce
the gate. Development integration/checks remain available under the already
approved use.

No external publication, contact or new contract was performed by this task.

## Coverage and interpretation

Use the existing Nearby location search (Paris, Versailles, Saint-Denis, or any
geocoded Île-de-France location), Search, maps, provider/mode filters, stop/route
details, local favorites and selected-date timetables. There is no Paris hub.
Select **Île-de-France Mobilités** in Search for independently paginated regional
route and stop results.

The inspected archive contains 2,029 source routes: 1,970 type-3 bus routes,
24 type-2 rail routes, 17 type-0 tram/light-rail routes, 16 type-1 Métro lines, one type-7
funicular and one type-6 cable service. The latter two are excluded, as are
source-labelled `TàD` demand-response routes. Final imported counts and operators
come from the validated generation and may change by edition.

GTFS agencies represent **commercial networks**, not necessarily the carrier.
Route-level `attributions.txt` operator names are retained and displayed;
commercial network and native type remain in route details. GTFS type 2 can mean
RER or Transilien/train; their supplied network distinguishes them.
Native type 0 also includes airport automated links such as ORLYVAL; these retain
the publisher's classification and supplied names, not an invented Métro mode.
This edition also contains 10 source TER routes;
only the boarding points and trips actually supplied by the regional archive are
imported, not a national TER timetable. Tramways use
the existing rail/tram filter. Type 3 does not reliably distinguish buses from
regional coaches: these stay in the bus filter without invented intercity,
express or coach labels. Extended coach subtypes, if supplied, retain that detail.

Stops retain parent and individual platform identities and every supplied route
membership. A mixed-mode stop is selected by matching routes, not one assigned
adapter-wide type. Distinct platforms are not merged by name or proximity.
Unknown accessibility is not an inaccessible claim; a supplied rail accessibility
flag can still require staff assistance or advance reservation.

Timetables:

- Date and From use **Europe/Paris**, regardless of browser timezone. Departure
  clocks and following calendar dates use the same zone.
- Calendars and explicit additions/removals are applied before results are returned.
  GTFS noon-minus-12-elapsed-hours conversion preserves DST and clocks over 24:00.
- Actual trip/stop headsigns and native direction IDs are used; no NY direction
  labels are added. Existing New York and station-local Amtrak paths are unchanged.
- Untimed, restricted pickup, window-based, frequency-template and explicitly
  approximate (`timepoint=0`) calls do not become exact boardable departures.
- Supplied frequency windows show headways and exactness at the trip origin.
  Even exact repeating windows are disclosed as windows rather than fabricated
  intermediate stop clocks. The inspected full archive has no `frequencies.txt`.
- Current clocks require a nonexpired published edition and a date in its actual
  service window. No stale clock is moved forward to imply current service.
- Scheduled results never create predictions, alerts, GPS, community estimates or
  moving vehicles. Missing paths/boarding information remain unknown.

The publisher warns that some local demand-responsive/municipal routes are
absent; schedules span roughly four weeks and lines may disappear seasonally.
The catalog and February documentation differ in their descriptions of RATP
works adaptations; do not promise all works are represented. OPTILE local-traffic
restrictions cannot all be represented by GTFS. Check operator notices and
boarding conditions; Transtop is not affiliated with IDFM or its operators.

## Import, resources and atomicity

The Paris importer is separate from the small-feed in-memory importer:

- Download backpressure to a temporary disk ZIP; no whole-archive `Buffer.concat`.
  A single bounded ZIP cache under ignored `generated-artifacts/idfm-cache/`
  records exact source validators and SHA-256. Unchanged failed editions can be
  retried from a verified cached body after HTTP 304, without another full download.
  This cache is disposable, not an additional durable service or public download.
- Maximum compressed 192 MiB, advertised/streamed expanded 2 GiB, 32 plain root
  text files, 200:1 per-entry expansion, 256 KiB CSV records, 20 million CSV rows.
  Reject traversal, directories, duplicates, missing required files and unsafe ZIPs.
  EOCD preflight bounds the central directory to 128 KiB / 32 entries before ZIP
  metadata parsing; multi-disk/ZIP64 archives are rejected within this 2 GiB scope.
- Maximum 200 agencies, 5,000 selected routes, 100,000 excluded trip IDs,
  100,000 frequency rows, 50,000 translations, 10,000 attributions,
  5 million shape points and 72-hour GTFS clocks. The inspected full archive has
  11,892,619 stop-time rows and 3,478,028 shape points; limits include headroom.
  Source IDs cap at 512 characters, raw route records at 32 KiB, and retained
  attribution/translation reference metadata at 32 MiB combined.
- Small-table insert batches cap at 1,500 rows / about 1 MiB. Stop-time writes use
  backpressured PostgreSQL COPY batches capped at 25,000 rows / about 8 MiB before
  CSV quoting. A COPY batch is atomic and follows the same staged-generation
  publication rule. Duplicate stop-time IDs
  fail instead of silently overwriting/dropping records. Trip/call/calendar/parent
  references are validated before publication.
- Shape aggregation and route membership use connection-local on-disk PostgreSQL
  staging, not whole-region JS timetable/shape maps. Streaming references use
  compact trip→route identities (at most 1 million / 64 MiB UTF-8 keys+values),
  stop identities (100,000 / 32 MiB) and distinct stop/route pairs (500,000 /
  32 MiB); limits include the actual encoded identifiers, not just row counts.
  Membership batches stay within 1,500 rows / 1 MiB. Calls referencing unknown
  trips/stops fail before COPY, rather than requiring a huge post-load join.
  Import flushes enforce a 1 GiB RSS safety bound. Work memory is 32 MiB
  per SQL operation; statements have a two-minute timeout. The import's cancellation
  signal expires at 30 minutes; an in-progress SQL operation can take up to its
  statement deadline to return before cancellation is observed. These are safety
  limits, not capacity guarantees.
- Call rows use isolated physical editions under `idfm_data`, with an empty
  managed `public.transit_idfm_stop_times` reader parent. A load is initially a
  standalone table, so requests cannot scan an unindexed in-progress edition.
  Three edition-local indexes are built before it is attached by inheritance
  in the same transaction that publishes the catalog and generation pointer.
  The constant checked mode need not be duplicated in every index key.
  Index builds use 64 MiB maintenance memory, up to six minutes per statement
  bounded by the remaining 30-minute import deadline. Failed/retired call editions
  are dropped without cascading, under the shared lock and short DDL deadlines.
  Normalized catalog rows retain bounded slice cleanup. Legacy providers keep
  their existing shared table; they are neither migrated nor dropped.
  Schema management explicitly includes only `public`, so future schema pushes
  cannot delete the independently managed physical editions.
- Staging statistics are analyzed before calendar/parent joins. Full-source
  trials exposed timeouts in post-load full-call integrity and membership joins
  while correctly preventing publication. These are now validated/collected
  during streaming instead; passing small fixtures is not a capacity measurement.
- Database size over 40 GiB blocks new Paris editions until old generations
  are retired. This is a conservative stop condition, not a free-space measurement.
  Unchanged HTTP revalidation does not require new-edition storage headroom.
  Reserve database capacity for two complete editions plus indexes, WAL and
  cleanup/autovacuum headroom; verify your database's actual capacity before enable.
- Shared advisory ownership serializes Paris, other GTFS imports and maintenance.
  All selected small catalogs and the immutable stop-time generation reference
  publish together. Any failure retains the previous complete edition.
- Temporary ZIPs and temporary SQL tables are removed at completion/failure;
  abandoned generations use existing bounded cleanup. A second edition can leave
  millions of retired rows. Additional IDFM-only retirement allows up to 100,000
  deleted rows/minute in separately committed 500-row slices with two-second
  statement / 250 ms lock deadlines and a 30-second outer budget. This is staggered from general maintenance
  and uses the same cross-process ownership lock. General provider budgets are
  unchanged. Allow normal cleanup/autovacuum time, never truncate
  unrelated tables or use blocking rewrites.

### Measured full edition — October 31, 2026

The authorized edition with source publication **October 30, 15:24 GMT** was
successfully published in development at **October 31, 02:23:03 UTC**:

- 143,987,527 compressed bytes; the successful run used the verified ZIP cache
  after conditional revalidation, so this is not a fresh-download timing claim.
- 2,003 retained routes: 1,946 native bus, 24 rail (5 RER, 9 Transilien, 10 TER),
  17 tram/light-rail and 16 Métro. The 24 source-labelled demand-response routes,
  one funicular and one cable route were excluded.
- 53,460 source stop records, 523,983 selected trips, **11,806,656 selected call
  rows**, 3,478,028 shape vertices and 2,029 supplied route attributions. No
  frequency or translation file was present; those paths are fixture-tested only.
- Actual service validity is **October 27–November 28, 2026**, derived from
  calendars and exceptions rather than the catalog's approximate 30-day claim.
  The longest supplied clock is 113,340 seconds (31:29:00).
- About **19 minutes 46 seconds** from import start to committed publication;
  the stored pre-publication duration is 17 minutes 34 seconds. Highest logged
  load-checkpoint Node RSS was **710 MiB**, not an OS-level peak measurement.
  Call-edition table plus its indexes occupied **9,490,694,144 bytes (8.84 GiB)**.
  PostgreSQL memory/I/O and catalog storage are additional.
- Early full-source trials correctly failed before publication on expensive
  shared-table post-load operations. Those trials motivated streaming validation,
  isolated call editions and whole-edition retirement. They are not successful
  refresh measurements. Their invisible legacy trial calls are retired separately
  without deleting the current edition or another provider.

Bounded current-date database/API checks passed for RATP Métro 1, RER A/SNCF,
Transilien H/SNCF, a supplied TER/SNCF service, ORLYVAL/RATP (native type 0), RATP
tram T1 and RATP bus 102. They exercised dated clocks, ordered stops, actual shapes,
Unicode name search, Nearby, native mode filters and capped maps; public response
schemas were checked and no vehicles were fabricated. Other imported regions
remained present. This does **not** assert that every line, commercial network,
operator or boarding restriction was individually validated.

Conditional source revalidation was also executed against the official resource:
the checked timestamp advanced while the successful import timestamp and active
edition remained unchanged, without another regional body download/import.
The 390-pixel mobile / 1280-pixel desktop browser pass verified Paris location
selection, capped map browsing, route/stop favorites surviving reload, and dated
clocks with an America/New_York browser timezone. The provider selector remains
feed-labelled Île-de-France Mobilités while route cards retain supplied carriers.
The PRIM application response was separately checked: four stale source estimates
were withheld, the reason was visible in source metadata, and published
departures remained available. That is a verified fallback, not a claim of fresh
live service across the region.

### Retiring pre-isolation Paris trial calls

Only installations with obsolete IDFM calls in the **legacy shared** call table
need this operator command:

```sh
IDFM_RETIRE_LEGACY=true pnpm --filter @workspace/api-server exec tsx \
  src/transit/idfm/retire-legacy-cli.ts --wait --vacuum
```

After a bounded timeout, `--start-block=N` can resume from the last logged
committed physical block (or omit it for a safe full rescan). Each slice retries
transient timeout/lock failures at most twice. Online VACUUM is optional and may
be deferred when managed maintenance already owns the table; completed row
retirement is not undone. Never use FULL/CLUSTER or a wholesale shared-table
rewrite. The measured trials' legacy IDFM calls were retired without touching
other agencies or the current isolated edition. Online index reclamation is
separate from logical row retirement and can take longer.

Measured development cleanup: online `REINDEX INDEX CONCURRENTLY` of the existing
legacy primary-key index reduced it from 6,580,871,168 to 824,442,880 bytes while
preserving all providers' rows and the same primary-key definition. Database
allocation afterward was **38,665,400,803 bytes (36.01 GiB)**, below the new-edition
preflight guard. The shared heap may retain reusable allocation; this is not a
claim that every dead page or historical unrelated generation was removed.
The current isolated IDFM edition and one checksummed archive cache were kept;
only its byte-identical redundant trial ZIP was removed. Uploaded catalog and
Swagger files were retained.

The pinned Drizzle CLI has an upstream composite-key introspection-order bug
([upstream report](https://github.com/drizzle-team/drizzle-orm/issues/6078)).
A narrow pnpm patch orders keys by their actual constraint ordinal, avoiding
large unchanged primary-key rebuilds during setup. It does not change key order,
drop records or upgrade the ORM to a release candidate. Expression-index
normalization can still recreate the four small catalog indexes; the measured
development schema push completed successfully with private editions excluded.

It refuses unless the active IDFM generation uses isolated storage and is attached
to its reader. Under the shared import lock it deletes **only agency `idfm`** from
the old shared table, in independently committed physical ranges of at most
512 pages (4 MiB visited per slice), with three-second statement and 250 ms lock
deadlines. Other agencies and the new reader/edition are never deleted.
`--wait` allows at most ten minutes for another import to finish. The total work
budget is thirty minutes; `--vacuum` uses ordinary online VACUUM with at most
fifteen minutes within that budget. It never uses VACUUM FULL, CLUSTER, table
TRUNCATE or a blocking table rewrite. A timeout is explicit and rerunning is safe;
completed slices remain committed. Run normal generation maintenance afterwards
to finish small-catalog retirement. This command is not part of startup or routine
refresh and is unnecessary for new installations.

The shared import maintenance and compatibility rollback rules in
[transit-imports.md](transit-imports.md) still apply. No existing source is replaced.

## Refresh and operations

IDFM initial import runs asynchronously after server startup, independent of the
general daily-import flag, and never blocks server startup on a 140 MB download.
Refresh checks run every 15 minutes, with at most hourly retries after source
failure and a local in-flight guard plus the shared database lock.

The catalog lists 08:00, 13:00 and 17:00 Paris publication times. The February 2026
documentation qualifies these: 08:00 daily SNCF, 13:00 non-SNCF weekdays excluding
holidays, 17:00 event-dependent SNCF updates. The implementation conservatively
revalidates after each possible slot, with a 30-minute publication allowance.
`ETag` / `Last-Modified` conditional GETs avoid downloading unchanged editions.
A 304 updates last-checked time, not source publication, import time or validity.
Changed import methods deliberately rebuild once despite unchanged source bytes.
If the last edition failed or a method rebuild is required, a 304 instead reuses
the checksummed cached body and still performs full validation before publication.
Do not clear the failure merely because the server returned 304.

Settings reports scheduled-only capability, last successful import, source
publication, service validity, last check, imported counts, operator inventory,
native exclusions and errors. A refresh failure does not remove saved identities
or relabel stale source data live.

```sh
# Development schema setup includes regional stop/parent and exception lookup indexes.
pnpm --filter @workspace/db run push
# One explicit authorized source, with the same lock and limits as automatic refresh:
pnpm --filter @workspace/api-server run import-gtfs idfm
```

Set `IDFM_ENABLED=false` to stop discovery/imports without deleting records.
Favorites and old deep links retain their stable `idfm:<original GTFS id>`
identity when disabled or temporarily absent. Reenable to resume eligibility.
Production additionally requires the compliance gate described above.

## Query bounds and cross-source identities

IDFM stops, timetables and shapes are excluded from legacy global memory caches.
Nearby uses a geographic database query (80 candidates, existing 16-card limit).
Region-specific catalog pages return at most 500 matching rows internally and
use the existing smaller API page size. Combined source search is explicitly
capped; select IDFM for full pagination.

Maps query a selected city viewport, at most 500 stop records and 12 selected
routes, 64 output paths and 40,000 simplified output points. Per-route shape
queries cap at 64 source paths / 120,000 points; the bounded cache holds at most
300,000 points. Capped views say to zoom/filter/open a route; they do not claim a
complete regional drawing. No complete IDFM network is sent to a browser.
Route details use one supplied pattern, at most 80 destinations and 500 calls;
other branches are explicitly possible.

Exact equivalent Transitland records are suppressed only when its feed metadata
identifies the exact approved IDFM archive and original route/agency IDs agree.
At a boarding point, original stop ID, parent, platform, coordinates and route
must additionally agree. Unknown provenance or a differing platform remains
separate. A name or nearby coordinate is never a match. Saved Transitland links
continue using their original source; Transitland's budget and license gate are
unchanged. No feed-wide Paris match is inferred from the earlier cross-border
SNCB smoke test.

## Verification

Deterministic fixture suite:

```sh
# Start the disposable PostgreSQL described in transit-imports.md first.
pnpm --filter @workspace/api-server exec tsx tests/idfm.ts
pnpm --filter @workspace/api-server exec tsc -p tests/tsconfig.json --noEmit
```

It uses only `benchmark@127.0.0.1:55439/gtfs_import_test`, resets only that disposable
database and forbids non-fixture fetches. Covers actual importer staging,
publication failure/rollback, shared ownership, unsafe/oversize source rejection,
orphan references, source timezone/date rejection, Unicode, operators, mixed
platform/mode membership, calendars/exceptions, DST/overnight clocks, frequency
exactness labeling, unknown fields, pagination, browsing, conditional 304,
expiry, cancellation and unrelated-provider retention.

Bounded **real imported data** smoke (no external API budget, no second archive
download):

```sh
IDFM_VERIFY_LIVE=true pnpm --filter @workspace/api-server exec tsx tests/idfm-live.ts
```

This requires a successfully imported official full edition using the current
method. It validates sample Métro, RER, train, tram and bus routes through the
shared public schemas, nearby/search, map, details and current dated timetables.
Output distinguishes counts/samples from guaranteed network completeness.
Generated measurement logs and archives stay under ignored `generated-artifacts/`.
