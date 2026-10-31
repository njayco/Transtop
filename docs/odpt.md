# Japan: direct ODPT GTFS/GTFS-JP

Verified 2026-10-31. This is **selected operator coverage**, not all Japan,
Tokyo Metro, JR, Kyoto, Yokohama or every CKAN railway listing. No account,
agreement acceptance, paid access or Transitland availability is required by
the enabled sources.

## Approved public sources

| Operator / dataset | Format / source route type | Verified edition | Resource and feed validity | Imported |
| --- | --- | --- | --- | --- |
| 仙台市交通局 / Transportation Bureau City of Sendai, `SendaiMunicipal/bus_realtime_information` | GTFS-JP, bus `3` | `20261007_20261130`, file date 20261026, published 2026-10-23 | Resource 2026-10-26–11-30; feed 2026-10-07–11-30 | 339 route records, 2,147 stops, 8,231 trips |
| 西東京市 / Nishitokyo City Hana Bus, `NishitokyoCity/AllLines` | GTFS-JP, bus `3` | `2026/04/01改正-見える化ver2.6h`, published 2026-03-30 | 2026-04-01–2027-03-31 | 7 routes, 146 stops, 514 trips |
| とさでん交通株式会社 / Tosaden Traffic Streetcar, `TosadenTraffic/Streetcar` | GTFS Schedule/GTFS-JP, **tram `0`** within broad rail filter | `calendar_datesの訂正`, file date 20260801, published 2026-09-27 | 2026-08-01–2027-04-30 | 4 route records, 152 stops, 1,024 trips |

Counts are source records, not unique route brands or daily runs; multiple
patterns may have the same name. Editions are resolved at refresh time, not pinned
to this verification's dates or selected from array order. A future edition does
not displace today's edition before its effective date.

Authoritative catalog, operator credit and resource pages:

- [Sendai schedules](https://ckan.odpt.org/dataset/sendai_municipal_bus_realtime_information)
  and [Sendai realtime](https://ckan.odpt.org/dataset/odpt_sendai_municipal_bus_realtime_information).
- [Nishitokyo Hana Bus](https://ckan.odpt.org/dataset/nishitokyo_city_all_lines).
- [Tosaden Streetcar](https://ckan.odpt.org/dataset/tosaden_traffic_streetcar).

All three are licensed **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**.
Transtop uses this material with modifications (normalization, selection and map
display), credits the named publisher and dataset via ODPT, and links the license
and [ODPT credit FAQ](https://developer.odpt.org/en/faq-info#cc-by-credit).
These credits appear on result cards, route/stop details, regional map results and
Settings. No endorsement or accuracy guarantee is implied.

The public developer site's JavaScript bundle was inspected for the FAQ and
metadata documentation; an HTML application shell is not a missing-terms finding.
The [Basic License](https://developer.odpt.org/terms/data_basic_license.html)
and [guidelines](https://developer.odpt.org/terms/data_basic_use_guideline.html)
are **not** substituted for the enabled datasets' CC BY permissions. Basic
License Article 8 restricts reusable/reconstructable data distribution.
Kyoto City Bus and Yokohama authenticated candidates remain disabled, pending
owner-approved agreements and access through workspace Secrets. Challenge-only
data (including the limitation in Kyoto subway's description) is excluded.
JSON-LD-only railway and timetable datasets have no adapter in this increment.

## Discovery is not approval

The documented
[`members-portal.odpt.org/api/v1/resources`](https://members-portal.odpt.org/api/v1/resources)
JSON endpoint describes **file resources only**, not the entire catalog. The
normal CKAN package-search API redirects to HTML and is not used.

`src/transit/odpt/registry.ts` is a closed, reviewed approval list. New publishers,
formats and modes are not activated automatically. Refresh requires the exact
dataset, GTFS format, approved route types, CC BY license, no extra metadata
license terms, the reviewed Japanese description, and a fingerprint of the
catalog's description/terms/links. Changed catalog terms fail closed, retaining
the previous complete generation and reporting a refresh error. An operator
description edit can also trigger review; inspect official terms before updating
the reviewed fingerprint. Never just update it to make a failing import pass.
Resolved snapshot metadata retains edition/publication/validity and CKAN resource
links; no public API exports raw archives or the full upstream metadata catalog.

## Operation and resource limits

Enabled by default. Set **`ODPT_ENABLED=false`** to withhold Japanese browsing,
times and live polling without deleting schedules or touching other sources.
Remove the setting or use `true` to re-enable.

```sh
pnpm --filter @workspace/api-server run import-gtfs odpt-sendai odpt-hana odpt-tosaden
```

The existing generation-safe importer stages and atomically publishes each
approved dataset, under the existing cross-process import lock. A failed
download, malformed archive, changed terms or invalid publication never replaces
usable data with a partial import or clears another operator. Unfinished
generations use existing bounded cleanup; cleanup failures are logged but do not
undo committed publication.

Startup/hourly checks import missing/stale approved public datasets; a successful
generation is refreshed no more often than every 22 hours while valid; an expired
Tokyo service window is eligible immediately at the next hourly check. With
`TRANSIT_AUTO_IMPORT=true`, the existing shared importer handles them instead.
Development imports do not copy data into a separate published database;
the same startup lifecycle provisions approved public feeds there.

There is one serialized ODPT request lane per process, shared request deduplication,
an hourly metadata/catalog cache, a 60-second realtime cache, one-minute failure
backoff, a 5,000-request UTC-day process ceiling and 20/60-second request
timeouts. This is independent of and does not change the approved Transitland
budget. Three minute-cached companions use at most about 4,320 requests/day,
leaving room for metadata and imports under that ceiling. Operate one poller
owner, as with the existing transit integrations.
An exhausted ODPT budget does not disable unrelated transit.

Response limits: 8 MiB metadata, 2 MiB catalog/realtime, 30 MiB compressed GTFS.
Archives: 60 flat `.txt` entries, no duplicate filenames or paths, 100 MiB per
entry, 200 MiB declared aggregate, 250 MiB cumulative streamed reads (including
metadata rereads), 1.5 million main records, 100,000 stops/translations and
1 million shape points. CSV records are limited to 256 KiB.

Only exact public ODPT resource paths are fetched. Public static downloads
redirect to `dataodpt.blob.core.windows.net/files-open/odpt/...`; the exact
publisher/dataset/edition path and read-only SAS parameters are validated.
Every other redirect is rejected. Signed URLs are used only in memory and never
stored, returned, or logged. `api.odpt.org`, credentials, extra query parameters,
private-storage paths, arbitrary hosts and caller-supplied URLs are rejected.
No consumer-key support or browser ODPT requests are enabled.

The archive exists transiently in server memory. Normalized schedule generations
and source snapshots are in private PostgreSQL tables; obsolete generations are
retired by existing cleanup. Rider APIs return bounded app-oriented results,
not reusable raw feed downloads/exports.

## Schedule and map semantics

- Verified agencies use **Asia/Tokyo**. Imports reject missing/changed agency
  timezones rather than using New York. Resource availability, feed-info edition
  metadata and actual calendars are checked together.
- Explicit `calendar_dates` entries override weekly calendars. Japanese holidays
  are not guessed. Service-day extended hours retain their following local date;
  date controls and clocks use Tokyo, independently of the rider's device zone.
- Exact source IDs are namespaced by approved dataset, including Unicode.
  Parent/platform relationships, supplied translations, headsigns and explicit
  accessibility flags are retained. Unknown accessibility remains unconfirmed.
  No romanization, Uptown/Downtown or Inbound/Outbound labels are invented.
- Sendai supplies no usable shapes. Hana's archive contains shape points but its
  trips do **not reference any shape IDs**, so those lines are also withheld.
  Tosaden has referenced shapes. Neither unreferenced points nor stop-to-stop
  segments are substituted for verified route geometry.
- Resource-expired schedules never become current departures, even if another
  calendar in the archive extends farther. Settings keeps expired source status.
  Timetable date bounds disclose source validity instead of shifting old clocks.

### Cross-source identities

Bounded Transitland checks verified these exact dataset crosswalks against direct
operator IDs and raw route/stop records on 2026-10-31:

| Transitland feed | Direct dataset | Checked route / stop |
| --- | --- | --- |
| `f-sendaimunicipal~bus~realtime~information~jp` | `odpt-sendai` | `10000` / `1_0` |
| `f-nishitokyocity~alllines~jp` | `odpt-hana` | `1` / `1_01` |
| `f-tosaden~kotsu~gtfs~tosadentraffic~streetcar` | `odpt-tosaden` | `東西線上り_A` / `1001_01` |

Only imported exact raw route IDs of the same mode in these feeds are suppressed
in primary route cards. Boarding results additionally require an exact raw stop
ID, parent relationship, coordinate and served route match in the direct dataset.
Unknown feed IDs, unrelated NishiTokyoBus (a
different operator), missing routes, similar names and nearby platforms are not
merged. Existing saved Transitland links retain their original lookup behavior.

## Realtime actually verified

The three Sendai public protobuf endpoints are under
`https://api-public.odpt.org/api/v4/gtfs/realtime/`:

- `odpt_SendaiMunicipal_bus_realtime_information_trip_update`
- `odpt_SendaiMunicipal_bus_realtime_information_vehicle`
- `odpt_SendaiMunicipal_bus_realtime_information_alert`

On 2026-10-31 around 00:24 UTC, all decoded successfully with fresh headers.
The bounded real-data check accepted **156 exact trip updates, 155 exact vehicle
entities and 154 fresh non-duplicate map vehicles**. The alert endpoint returned
a valid **empty feed**: endpoint availability was verified, not an actual notice
or guarantee of alert completeness.

Trip updates/vehicles require a matching current static trip, route, service date
and exact stop ID/sequence, plus fresh per-item timestamps. Static generation is
rechecked after matching. The cached metadata must still publish the exact
companion URL and operating flag; the separate realtime catalog terms have their
own reviewed fingerprint. The catalog's current edition version must match the
imported version. Unknown/ambiguous IDs, stale items and mismatched
editions are withheld. No realtime feed version is supplied by these samples;
compatibility is checked against exact active static identifiers, not claimed
from an advertised catalog flag. Only absolute supplied event instants become
predictions. Cancellations, skipped/no-data stops and expiry are respected.
No delay-only extrapolation or invented GPS is made. Supplied coordinates may
be shown without a route shape; schedules never animate a vehicle. Fresh notices
must reference imported routes. Hana and Tosaden are schedule-only.

Sendai explicitly warns about similar static entries and possible realtime
integration failures. Unmatched observations are not fuzzily reassigned.
Fallback remains labeled published schedule, or unavailable.

## Verification

```sh
# Disposable local Postgres only: benchmark@127.0.0.1:55439/gtfs_import_test.
# Start it separately; fixtures deliberately recreate its public schema.
pnpm --filter @workspace/api-server run test:odpt
pnpm --filter @workspace/api-server run test:gtfs-import
pnpm --filter @workspace/api-server exec tsx tests/transitland.ts
pnpm --filter @workspace/api-server run test:tfl
pnpm run typecheck

# Explicitly opt in to a bounded current public-source check after import:
ODPT_VERIFY_LIVE=true pnpm --filter @workspace/api-server run check:odpt-live
```

Fixture coverage includes license/description changes, unauthorized URLs and
redirects, edition/window selection, archive bounds, atomic failure and source
isolation, Unicode and supplied English search, Tokyo extended hours, exceptions,
current expiry, exact deduplication, nearby/maps/details/timetables, realtime
matching/freshness and disabled sources. The live check exercises actual bus
and tram schedules/search/map/detail APIs and reports accepted realtime records;
it does not consume Transitland or TfL requests.

The requested desktop/mobile browsing pass verified Tosaden search/provider/
tram filtering, official geometry, route/stops and a Tokyo-time published
timetable; mobile Hana Japanese/English stop details and timetables; and Settings
source/coverage disclosures. A mobile overflow defect was fixed in stop arrival
and timetable rows and provider controls; the narrow recheck measured the stop
page within the 390-pixel viewport. Search route cards subsequently received the
same explicit constrained grid tracks and bounded badges.

Google tile delivery was intermittent on mobile: the existing visible retry/
schematic fallback remained honest, without drawing an invented Hana route.
The desktop Tosaden map loaded supplied geometry. Separate existing generation
cleanup timeout warnings did not prevent publication or browsing; this
integration does not claim to fix the broader retention/database maintenance work.
