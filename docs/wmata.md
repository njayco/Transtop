# WMATA Metrobus and Metrorail

## Authorization and source choice

The owner confirmed acceptance of WMATA's Transit Data Terms of Use and supplied
an existing server-only key. The owner reports the subscribed default allowance
as **10 calls/second and 50,000 calls/day**. A public API catalog is not evidence
of those account limits; HTTP success independently establishes only access to
the operation checked, not a higher tier or unlimited requests.

Official documentation checked October 31, 2026:

- [Developer portal and combined-feed/platform announcement](https://developer.wmata.com/)
- [GTFS documentation](https://developer.wmata.com/api-details#api=gtfs)
- [Combined schedule operations](https://developer.wmata.com/api-details#api=gtfs)
- [Rail trip-update semantics](https://developer.wmata.com/api-details#api=gtfs&operation=5d0244884e0f2e9ca44c2737)
- [Transit Data Terms of Use](https://developer.wmata.com/license)

The production GTFS operations used are on `https://api.wmata.com/gtfs/`:

| Capability | Path |
| --- | --- |
| Combined Metrobus/Metrorail schedules | `rail-bus-gtfs-static.zip` |
| Metrobus predictions | `bus-gtfsrt-tripupdates.pb` |
| Metrorail predictions | `rail-gtfsrt-tripupdates.pb` |
| Metrobus alerts | `bus-gtfsrt-alerts.pb` |
| Metrorail alerts | `rail-gtfsrt-alerts.pb` |

All five returned authorized HTTP 200, decoded ZIP/protobuf data during bounded
checks. Separate JSON prediction/incident, GTFS Metro Alert and vehicle-position
products were **not** requested or claimed as verified. No QA feed, guest key,
account registration, subscription upgrade or additional agreement was used.
Empty rail alerts are a valid upstream result, not a promise of no disruptions.

The terms permit transit-data use within an application and restrict standalone
API redistribution. Existing normalized Transtop endpoints support its rider
application; this integration does not create a general-purpose WMATA proxy,
bulk export or license to redistribute a separate data API. Any independent
third-party API distribution requires owner review and, where applicable, prior
written WMATA authorization under section 8. GTFS being an open *format* is not
a CC BY license for WMATA's underlying data. Do not reproduce WMATA logos/maps
or imply affiliation.

Credit displayed on stop and route details:

> Transit data provided by WMATA. Transtop is not affiliated with or endorsed by
> WMATA. Data supplied as-is.

## Configuration

Configure credentials securely, never in source, URLs or a `VITE_` variable:

- `WMATA_API_KEY`: owner's existing key, sent only in the server's `api_key` header.
- `WMATA_VERIFIED_DAILY_LIMIT`: owner-verified daily account allowance. Default
  `0` blocks automatic access; the confirmed account allowance is `50000`.
- `WMATA_ENABLED=false`: stop further upstream requests. Already published
  schedules remain usable, but predictions/alerts are withheld and marked disabled.
- `TRANSIT_AUTO_IMPORT=true`: existing opt-in missing/stale daily import lifecycle.

The application further caps total usage at **5,000/day**: **500 development /
4,500 production**, leaving substantial account headroom. Smaller confirmed
allowances are split the same way. Each environment atomically reserves its share
in PostgreSQL across replicas and restarts; all operations count, including failed
calls and static downloads. Calls are spaced by at least six seconds per
environment (far below the confirmed 10/second even with two environments).
Other applications sharing the key are outside this ledger.

There is no WMATA background realtime timer. Rider views trigger shared/coalesced
polling only for relevant modes. Predictions cache for 30 seconds; alerts check at
most every 120 seconds. Database leases select one poll owner per operation.
429 responses block all operations in the environment; product denial backs off
for an hour. Transient failures back off at least a minute; `Retry-After` is
honored within a bounded window. Exhaustion/spacing/backoff appears as limited,
never as a healthy live feed.

Predictions expire **60 seconds from the older of source header and observation**
(with at most 30 seconds future skew); alerts expire after **180 seconds from the
source header**. Retrieval time never extends source freshness. Persisted caches
are revalidated after process restart. An unavailable cache fails closed, not into
unmetered upstream calls. Endpoints and redirects are allowlisted; redirects are
rejected. Timeouts, compressed/expanded archive limits and record bounds apply.

## Import and refresh

```sh
pnpm --filter @workspace/api-server run import-gtfs wmata
```

Import once in the intended environment after schema setup. Development imports
do not seed the published database. No production import or deployment was
performed as part of development verification.

One combined feed publishes one atomic `wmata` generation. Do not import separate
bus/rail copies over that same namespace. Daily refresh is outside awaited API
startup; a failed download, parse, validation or transaction retains the last
complete generation. See [generation retention/rollback](transit-imports.md).
The compressed limit is 100 MiB; WMATA additionally enforces 100 entries,
400 MiB/file, 800 MiB expanded, 6 million primary records and 30,000 locations.
No large feed archive is committed.

Native type 3 is Metrobus; native type 1 is Metrorail/subway. IDs stay
`wmata:<publisher ID>` for stable saved links. Supplied line names, colors,
headsigns, calendars and exceptions are retained. Feed publication dates constrain
the service window rather than generic long-lived calendar placeholders.
Times, including >24:00, use GTFS noon-minus-12 elapsed-hour rules in
`America/New_York`, not the visitor's timezone.

Parent stations, platforms, entrances and passages retain separate identities.
Search/maps can show boarding platforms and parent stations. Entrances without
calls are not boarding cards; parent/child location links expose their identity
without inventing departures or certifying accessibility. Parent timetables
aggregate actual child calls; predictions preserve the supplied platform name.

## Realtime matching and gaps

Metrobus trip IDs matched the combined static sample directly. The live rail
sample had revision suffixes different from the combined static file. Matching
uses the publisher's `scheduled_trip_id`, plus exact route, direction, active
service date, start time and supplied stop-sequence/platform agreement. Multiple
candidates remain unresolved. No name/proximity/line-color identity guesses.

Unresolved trips can supply a live arrival only at an exact current static
route/platform membership. Destination is then explicitly not supplied; no
inbound/outbound direction is invented. Those predictions do not receive a
guessed scheduled-trip ID. Scheduled fallback for that route at the stop is
withheld while those predictions are fresh to avoid duplicate guessed runs.
Matched predictions replace only that trip's scheduled arrival; cancellation and
skipped-stop exclusions are dated. Added/duplicated runs cannot cancel their
original schedule. Terminal/nonnumeric minute strings never become clock times;
this adapter uses GTFS epoch predictions, not JSON ARR/BRD placeholders.
Schedules remain separately labeled when predictions expire.

Alerts preserve stable mode-namespaced source IDs, source timestamps, active
periods and selectors. Multiple selectors are alternatives; a combined route/stop
selector requires both. Unknown scope stays in the general alert feed without
arbitrary route assignment. Systemwide advisories stay visible for the appropriate
WMATA mode, never every NYC route. Alert outages cannot be hidden by healthy
predictions.

Direct results take precedence only when global feed metadata points to a
documented official WMATA resource and raw route/operator/stop IDs, parent and
coordinates verify the individual boarding point. Unknown or changed global
points remain separate. Existing worldwide saved links retain their source and
are not silently rewritten.

No MARC, VRE, county agencies, ticketing, fares, pathways navigation, push alerts
or new vehicle tracking is claimed. A fresh arrival prediction is not vehicle GPS.

## Verification

```sh
pnpm --filter @workspace/api-server run test:wmata
# Disposable PostgreSQL only: see transit-imports.md (fixed port 55439).
pnpm --filter @workspace/api-server run test:wmata-import
pnpm --filter @workspace/api-server run test:gtfs-import
pnpm --filter @workspace/api-server run test:catalog-timetable
pnpm --filter @workspace/api-server run test:tfl
pnpm --filter @workspace/api-server run test:odpt
pnpm run typecheck
```

Fixtures cover mixed modes, station/platform/entrance identities, revision
crosswalk ambiguity, supplied destinations, overnight/DST, calendar exceptions,
cancellations/skips, stale/future observations, valid empty responses, nonnumeric
times, scoped/systemwide/expired advisories, unknown selectors, denied access,
throttling, coalescing, credential echo protection, safe URLs and preservation
after failed refresh. Fixtures alone are not evidence of current provider access.

Initial authorized real sample: **37,102,969 compressed bytes**, **132 routes
(126 bus / 6 rail lines)** and **9,716 locations**. Feed version `S1000251`,
publication window **2026-09-13–2027-03-27**. Bus predictions contained **1,192
trip updates**, rail **109**; all supplied stop IDs matched static locations.
Metrobus alerts contained **8 advisories**; Metrorail alerts contained **0**.
These are point-in-time sample counts, not promised future coverage. Consult
Settings and stop-level source status for current availability.

The complete development import published **4,576,722 primary records**. A
subsequent fresh rail sample verified **21/106 trips** through the strict static
crosswalk; many other live trip bases were absent from this static edition.
Metro Center returned fresh rail times at exact platforms, while Metrobus stop
`7219` returned live C51/C53 arrivals with verified headsigns. Metro Center's
2026-10-30 timetable returned **1,030 published calls**. Cleanup of older data
hit the existing bounded statement timeout **after publication**; the new
generation remained available and retirement registry was retained for later
cleanup. This does not justify deleting the active generation or treating every
rail trip as matched.

The bounded desktop/mobile rider smoke verified mixed-mode provider filters,
Search, Washington Nearby/map center, Metro Center and Metrobus details,
platform-to-parent navigation, Red Line directions/ordered stops, dated
timetables and a favorite surviving reload. Both modes rendered at 390×844.
Initial one-second loading checks were insufficient; the settled detail pages
returned usable data (one cached mobile station request was 913 ms). An uncached
pair of upstream requests can take 10–20 seconds under the conservative shared
spacing; temporary loading is not proof of denied access. Map tiles may finish
after the textual station information.
