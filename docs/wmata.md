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
| Metrobus GPS | `bus-gtfsrt-vehiclepositions.pb` |

All five returned authorized HTTP 200, decoded ZIP/protobuf data during bounded
checks. Separate JSON predictions, bus/rail incidents, GTFS Metro Alert and vehicle-position
products were **not** requested or claimed as verified in the initial integration.
Station information and elevator/escalator incidents were subsequently verified
as described below. Metrobus GPS access was also subsequently checked independently;
see below. No QA feed, guest key,
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
polling only for relevant modes. Predictions and GPS cache for 30 seconds; alerts check at
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
or rail GPS is claimed. A fresh arrival prediction is not vehicle GPS.

## Official Metrobus GPS

The documented production [Bus RT Vehicle Positions operation](https://developer.wmata.com/api-details#api=gtfs&operation=5cdc52139e0b4de98fdfd54a)
was verified on the existing authorized account before connecting it to rider
views. The official developer portal's operation metadata establishes the path
and GTFS-RT 1.0 format, not account entitlement. A bounded authenticated request
returned HTTP 200 and decoded **432 VehiclePosition observations / 34,883 bytes**
at **2026-10-31T03:58:07Z**. This proves operation access at that time, not
continuous availability or a larger quota. No JSON Bus Methods, QA product,
rail vehicle-position product or subscription change was needed.

Washington map viewports and exact WMATA bus route views request this product
on demand through the same server-only client, persistent shared ledger, leases,
cache and denial/throttling backoff as predictions and alerts. There is no new
background timer or larger allowance: the existing **500 development / 4,500
production** daily maximum includes GPS, predictions, alerts and static downloads.
Busy views can become limited; they do not bypass request spacing or quota.

Only VehiclePosition coordinates qualify. A physical `vehicle.id` produces the
stable `wmata:vehicle:<id>` identity, never a feed-local entity ID or display label.
Routes must match current static Metrobus IDs exactly. A supplied trip must also
match an exact static trip, route and any supplied direction; absent/mismatched
editions remain unresolved and withheld rather than guessed. Duplicate physical
IDs are withheld. Rail entities, trip-update predictions, deleted records, missing
GPS/timestamps and invalid coordinates do not create markers.

The source label is **official WMATA Metrobus GPS** on the existing route-branded
map badge and source details. Both the full-feed header and each vehicle's
observation must be within 60 seconds, with at most 30 seconds future skew.
`updatedAt` is the older timestamp; `expiresAt` is 60 seconds after that.
Persisted caches are rechecked on every response and the map independently hides
expired positions even if refreshing fails. Retrieval cannot extend freshness.
Missing positions or a failed/denied product replace the old GPS snapshot with
no markers. The existing map can ease only between two received GPS observations;
it never extrapolates movement or animates schedules or rail station reports.

The server reports `bus-vehicles` in Settings source health, and bus route notes
report GPS availability separately from predictions and alerts.

After the development schedule import published 132 routes, the explicit matching
check at **2026-10-31T04:02:58Z** decoded **428 observations / 34,556 bytes** and
accepted **244 fresh, exact-static-identity GPS positions**. The remaining
observations were withheld by freshness/identity validation, not inferred into
positions. The running application then returned **222 Metrobus GPS markers** in
the bounded Washington viewport and **3 M70 buses** on its route detail, with
independent fresh prediction/alert/GPS notes. Counts vary with time and viewport.
These were development checks on the existing account, not a production import,
deployment or claim that every bus currently has usable GPS.

## Station entrances and equipment access

Official documentation and the already accepted
[Transit Data Terms](https://developer.wmata.com/license) were checked again
October 31, 2026. The terms explicitly include elevator/escalator incidents;
the application-only use and independent API redistribution restrictions above
still apply. No new account, product subscription, paid tier or agreement was
created or accepted. Bounded calls using the existing server-only key and the
same PostgreSQL-backed quota client successfully validated all three products:

| Product | Fixed HTTPS path | Point-in-time records |
| --- | --- | --- |
| [Station list](https://developer.wmata.com/api-details#api=5476364f031f590f38092507&operation=5476364f031f5909e4fe3311) | `/Rail.svc/json/jStations` | 102 |
| [Station entrances](https://developer.wmata.com/api-details#api=5476364f031f590f38092507&operation=5476364f031f5909e4fe330f) | `/Rail.svc/json/jStationEntrances` | 275 |
| [Elevator/escalator outages](https://developer.wmata.com/api-details#api=54763641281d83086473f232&operation=54763641281d830c946a3d76) | `/Incidents.svc/json/ElevatorIncidents` | 27 |

These successes establish access to those operations at that time, not permanent
entitlement, additional quota, complete inventory or working elevators. Operation
names in `check-wmata-access.ts` are a fixed allowlist, not user-provided URLs.
No key appears in URLs, browser bundles, results or logs. Recheck deliberately:

```sh
cd artifacts/api-server
pnpm exec tsx scripts/check-wmata-access.ts
# Optional bounded official ZIP check, processed in memory; no import or archive saved:
pnpm exec tsx scripts/check-wmata-access.ts --static-identity
```

Station details now show a distinct access panel, accessible from the station
header, independently of prediction and service-alert status. Parent, platform,
entrance and passage IDs and parent links are unchanged. WMATA's published
station `Code` plus reciprocal `StationTogether1/2` sets must exactly agree with
the complete current GTFS `STN_...` parent identifier. Platform `PF_...` codes
must also belong to that exact parent; published numeric and `_C` platform
suffixes are supported. Names, distance, line colors and wheelchair flags do not
establish a crosswalk. Partial, missing, inconsistent or changed sets are unknown.
The current official ZIP was checked against these identities, including island
platforms, not just example fixtures: **2,176/2,176** station-related locations
matched complete published station-code sets.

Entrances are selected only by the publisher's exact `StationCode1/2` membership.
Their names, descriptions, coordinates and station codes are shown. JSON entrance
`ID` is deprecated and is **not** treated as a GTFS entrance ID. The API supplies
no verified entrance-to-equipment edge or step-free capability flag. All access
results remain explicitly station-wide even when opened from a particular
entrance or platform; there is no guessed equipment assignment to that location.

Outages use the exact composite identity **station code + unit type + unit name**;
WMATA documents that an elevator and escalator may share a `UnitName`.
The station-wide list retains each unit's location, symptom, reported/updated
times and estimated return. Escalators are clearly distinguished from elevators
and are not step-free paths. Source wall times use `America/New_York`, presented
as localized instants. Future report dates are explicitly uncertain.
**Estimated return is not an active-period end, expiry, or proof of repair**:
if it has passed but WMATA still reports the incident, the panel says repair is
unconfirmed. An old individual update can describe a still-reported long outage;
it is not automatically dropped as resolved.

Access sources are fetched only from station-detail requests, without a background
timer. Shared leases, persisted snapshots, per-process coalescing and the existing
global quota/backoff apply. Station-code and entrance snapshots refresh/expire
after 24 hours. Equipment snapshots refresh after 120 seconds and expire after
180 seconds from the request's start. These JSON APIs supply no full-list source
timestamp; the UI says the check time is a retrieval observation, not proof of a
new upstream publication. Incident update times remain separately visible.
Persisted snapshots retain their original check times across restarts. Retrieval
does not extend an incident's source update time.
The browser independently ages these check times every five seconds and on
window focus, so failed refetches or an offline tab cannot retain a fresh label
indefinitely. An initially cold detail request can require several serial,
quota-spaced upstream operations; subsequent requests reuse the shared snapshots.

Disabled/missing credentials, unconfirmed quota, denial, throttling, exhausted
allowance, invalid payloads, stale snapshots and unavailable shared storage are
explicit states. Denial retries no sooner than one hour; other errors no sooner
than one minute, still subject to client-level backoff. Failures do not clear
another product's status or create healthy empty results. Stale records are
withheld, and a stale/missing station crosswalk withholds assignments from both
products. Healthy empty means only that WMATA returned no matching reports;
neither it nor the GTFS wheelchair field certifies accessibility. The station
header and panel explicitly say **step-free access is not verified**, retain
WMATA attribution and link to official elevator status before travel.

No full accessibility certification, verified healthy-equipment inventory,
entrance-specific elevator matching, accessible journey planning or pathway
navigation is claimed.

## Verification

```sh
pnpm --filter @workspace/api-server run test:wmata
# Explicit one-request access/GPS matching check, not part of automated fixtures:
pnpm --filter @workspace/api-server run check:wmata-vehicles-live
pnpm --filter @workspace/transtop exec node --experimental-vm-modules --test tests/wmata-access.test.mjs
# Disposable PostgreSQL only: see transit-imports.md (fixed port 55439).
pnpm --filter @workspace/api-server run test:wmata-import
pnpm --filter @workspace/api-server run test:gtfs-import
pnpm --filter @workspace/api-server run test:catalog-timetable
pnpm --filter @workspace/api-server run test:tfl
pnpm --filter @workspace/api-server run test:odpt
pnpm --filter @workspace/transtop exec node --experimental-vm-modules --test tests/vehicle-visibility.test.mjs tests/map-overlays.test.mjs tests/map-lifecycle.test.mjs
pnpm run typecheck
```

Fixtures cover mixed modes, station/platform/entrance identities, revision
crosswalk ambiguity, supplied destinations, overnight/DST, calendar exceptions,
cancellations/skips, stale/future observations, valid empty responses, nonnumeric
times, scoped/systemwide/expired advisories, unknown selectors, denied access,
throttling, coalescing, credential echo protection, safe URLs and preservation
after failed refresh. Fixtures alone are not evidence of current provider access.
GPS fixtures additionally cover protobuf physical IDs, exact bus route/trip
agreement, duplicate IDs, missing/invalid coordinates and observation timestamps,
stale/future headers, persisted-cache expiry, product denial/backoff, tight map
viewports between stops, source labels and removal without disturbing route paths.

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
