# Transitland worldwide operation

## Access and limits

The existing Transtop product now queries Transitland v2 REST on demand; it does
not import the worldwide Feed Archive or replace verified agency sources.
The owner approved production account access, potentially billable requests and
**9,999 requests per UTC calendar month** for this integration.
Do not increase that allowance or buy/upgrade services without fresh approval.

Configure the server-only `TRANSITLAND_API_KEY`, `TRANSITLAND_ENABLED=true`,
`TRANSITLAND_PLAN=production`, `TRANSITLAND_ALLOW_BILLABLE=true` and
`TRANSITLAND_MONTHLY_REQUEST_LIMIT=9999` through environment/Secrets configuration.
All four activation conditions are intentional. Disabling access retains the
direct agency/PDF/research sources. There is no browser Transitland credential.

Reservations are atomic PostgreSQL snapshot updates, including failed requests.
They survive workflow restarts and coordinate replicas using the **same database**.
The total is partitioned: floor(10%) for development, the remainder for the
published app, detected by Replit's `REPLIT_DEPLOYMENT=1`. At 9,999 this is
**999 development + 9,000 published** requests, including existing development
reservations. Separate databases therefore cannot each spend the full allowance.
If both environments intentionally share a database, the shared counter is even
more conservative. Other apps/cloned databases using the same key are outside
this app's control: this is not a provider billing cap. Monitor account usage in
Transitland and use separate keys for other apps. Only increase usage after approval.

Requests use a fixed HTTPS origin, header authentication, no redirects, validated
paths, 15-second timeouts and a 6 MB response cap. Pagination uses validated opaque
cursors, never an upstream URL containing credentials. Concurrent identical
requests are deduplicated. Successful metadata is cached for one hour, dated
timetables for five minutes, realtime departures/vehicles for 30 seconds and
notices for one minute. Failed resources have a one-minute negative cache;
429/server/network failures also back off. Expired realtime is never served stale.
Cache payloads exclude authorization blocks, pagination URLs and raw feed URLs.
Bounded cleanup removes expired global cache rows without touching usage records
or other sources.

## Browsing and coverage

- Nearby accepts worldwide place searches or `latitude, longitude`. Known local
  places/stations remain local; unfamiliar place text goes to Photon. Global
  transit searches/coordinates go to Transitland. Photon publicly permits modest
  project use, not unlimited production-scale traffic; no new paid Google service
  is enabled.
- Nearby, Search, route/stop details and Worldwide map share the integration.
  The worldwide map starts at the selected location; Fit NY / CT restores the
  established regional extent. Zoom to city level (11+) for global discovery.
- Source pages contain at most 60 stop records and 60 route-search records.
  Stop and route cursors are tracked independently. Local pagination and source
  pagination are distinct, visible controls.
- Map requests cover at most eight degrees per side and fetch geometry for at
  most twelve discovered routes and 64 supplied geometry segments per route. Separate
  MultiLineString parts are retained without invented connectors. Additional paths remain in missing-geometry
  details; zoom, filter an operator, or open a specific route. Published shapes
  are never replaced with straight lines between stops.
- A route detail uses one supplied trip pattern, bounded to twelve discovered
  direction/destination patterns and 500 calls. Other branches may exist.
  Frequency-only, untimed and restricted boarding calls do not become invented
  exact departures.
- Stable app identities contain feed Onestop ID plus original GTFS ID, including
  Unicode and punctuation. API internal integers are transient lookup/follow-up
  values only. They are not favorites or canonical database identities.
- Exact reviewed operator crosswalks preserve direct sources. Full local agency
  catalogs take precedence; partial NJ TRANSIT 890/891 imports suppress only their
  matching routes. IBG remains historical and its quarantine stays in force.
  Unknown bus subtypes are not labeled intercity. Extended GTFS coach types and
  exact intercity brands from the existing reviewed carrier inventory provide
  explicit intercity classification, not a grant of data access or terminal proof.

## Dates, observations and rights

Global timetables use verified agency timezones; selected date is a GTFS service
date, not the visitor's browser date. UTC fields lacking a suffix are interpreted
explicitly as UTC. Extended clocks retain their following local calendar date;
fallback conversion uses GTFS noon-minus-twelve semantics across DST.
Existing regional and Amtrak timezone rules remain separate.

Every departure request explicitly sets `use_service_window=false`. Returned
selected service dates must match; a substituted historical date is not a current
departure. Static snapshots older than **45 days**, without a source timestamp,
or with implausible future timestamps cannot supply current clocks. This is a
conservative operational guard, not a promise that every newer feed is accurate.
Interpolated, canceled, skipped, no-data and restricted pickup rows are withheld.
Large raw responses or more than 1,000 departure rows require a narrower From
time; they are not silently presented as complete.

Fresh predictions require the trip observation timestamp, not retrieval time.
Vehicle GPS requires an advertised, accessible feed, a fresh feed header, an
independently fresh vehicle timestamp, actual coordinates and an exact scoped
route match. Only up to three recently viewed feeds are checked for a supplied
viewport. Observations expire after 60 seconds with 30 seconds future tolerance.
No schedule or route interpolation creates positions; denied/unavailable tracking
does not disable eligible timetables. Per-feed tracking states appear in Settings.
Missing realtime access, shape, timezone or licensing information remains a gap.

Feed rights are checked independently from the API subscription. Recognized
permissive data licenses or affirmative compatible reuse flags are required;
explicit prohibitions/share-alike requirements not supported by this integration
are withheld. Registry `exclude_no` is **not** used as a permission grant.
Transitland and upstream attribution are visible in the footer, source panels and
stop/route details. Source instructions are retained; additional contractual
acceptance, Feed Archive access and paid services are not inferred.

## Verification

Real authorized API checks reached three previously unsupported regions:

| Region | Observed eligible page | Mode coverage observed | Detail checked |
| --- | --- | --- | --- |
| Sydney, Australia | 47 stops, 234 route IDs | bus, rail | Australia/Sydney; supplied 42-stop pattern and 279 shape points; dated timetable returned |
| Paris, France | 39 stops, 52 route IDs | rail, bus | SNCB cross-border station record; Europe/Brussels agency timezone; supplied 8-stop pattern; some feeds withheld |
| San Francisco, USA | 31 stops, 37 route IDs | rail, bus, subway | America/Los_Angeles; supplied 25-stop pattern and 152 shape points; dated timetable returned |

These are bounded API pages observed during development, not an inventory or
guarantee of city-wide coverage. Counts can change with upstream versions and
rights metadata. Paris metro and global intercity service were **not established
by these sample pages**. London/Tokyo preliminary probes included old records;
those records were not promoted into current timetables. No live GPS availability
is claimed merely because a catalog or route request succeeded.

Fixtures: `pnpm --filter @workspace/api-server exec tsx tests/transitland.ts`.
Transport fixtures mock both PostgreSQL and fetch; when activation is configured
they test shared reservations, caching/singleflight, 401 isolation, 429 backoff,
network errors and credential stripping without real API consumption.
The normalization suite runs without a credential.

Explicit opt-in real checks (consume approved quota):
`TRANSITLAND_VERIFY_LIVE=true pnpm --filter @workspace/api-server exec tsx tests/transitland-live.ts`.
Do not run repeatedly as a background feed crawler.

References: [REST documentation](https://www.transit.land/documentation/rest-api),
[live schema](https://transit.land/api/v2/rest/openapi.json),
[plans](https://www.transit.land/plans-pricing), [terms](https://www.transit.land/terms),
[Photon usage policy](https://github.com/komoot/photon#demo-server),
[OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
