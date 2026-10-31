# Mobility Database integration

Mobility Database is a worldwide **feed catalog**, not a stop/departure API or
permission to redistribute every feed it lists. Transtop queries the official
catalog, imports eligible GTFS into the existing generation-based database and
uses matching authorized GTFS-Realtime companions. Existing direct integrations
and Transitland remain available independently.

## Rider experience

- Nearby discovers feeds around the rider-selected location (roughly a city
  viewport). Eligible small feeds can stage asynchronously; normal Nearby polling
  or revisiting the location makes completed imports visible.
- Imported stops/routes participate in existing Search, provider and mode filters,
  Google Maps, favorites, route details and dated timetables. No separate transit hub.
- Settings → Worldwide feed discovery searches schedule/realtime feed metadata by
  ISO country code and provider, with bounded pagination. A catalog listing is not
  current rider coverage. Source counts and import errors below remain authoritative.
- Detail panels include Mobility Database and publisher attribution, source
  download date, dataset ID, license link and verified agency timezone.
- Mixed bus/subway/rail/tram/intercity feeds retain each supported native mode.
  GTFS bus type 3 is not guessed to be intercity; extended 201/202 are intercity.
  Ferries, cable cars, demand-response and frequency-only timetable semantics are
  not added by this integration.

## Access and operating limits

`MOBILITY_DATABASE_REFRESH_TOKEN` is server-only. OAuth access tokens are obtained
at `/v1/tokens/access`, held only in process memory and refreshed before expiry.
No credential is returned to browsers, added to a feed URL, or stored in catalog
snapshots. `MOBILITY_DATABASE_ENABLED=false` disables the integration.

The app's initial catalog allowance is **200 data requests/day total**, allocated
20 to development and 180 to published instances (UTC days). Database reservations
are atomic across replicas sharing that environment's database. Normalized catalog
pages cache for six hours. Token exchanges and publisher feed downloads are
separate from this catalog-request counter; failed data requests consume a
reservation. This is a local safety limit, not a claim about the account's quota
or permission for paid upgrades. Other applications using the same account are
outside this app's accounting.

Capacity is intentionally bounded: up to 8 registered feeds, at most 2 new
automatic registrations/day per database, one discovery import at a time per
process, 20 MB zipped / 100 MB expanded / 1 million staged records per feed.
The existing cross-process GTFS import/cleanup lock and atomic generation promotion
are reused. A failed staging import does not overwrite another service's data.
These limits do **not** mean all worldwide schedules are already imported.
Larger feeds and feeds with unknown rights need review before enabling.

Only active, official feeds with explicit compatible SPDX identifiers **and**
matching canonical CC BY 4.0, CC0 or PDDL URLs are eligible. Separate-auth sources,
unknown/contradictory terms, share-alike obligations not implemented here, stale
or future service windows and unverified timezones are withheld. Source metadata
does not replace the underlying license. Required credits and links remain visible.

Static archives must use the fixed `files.mobilitydatabase.org` HTTPS host.
Realtime downloads use HTTPS with public-address DNS validation and a pinned
connection; private/reserved addresses, credentialed URLs, redirects and oversized
responses are rejected. No Mobility Database bearer token is sent to a publisher.
Only explicitly catalog-linked realtime companions with their own compatible
rights and no separate credentials can be polled.

## Dates, realtime and deduplication

Agency zones are verified against archive metadata. Mixed-zone archives are
withheld rather than silently assigned New York time. Current service calendars,
exceptions and 24+ hour calls are evaluated in the source timezone. Past/future
date requests never substitute another date's timetable.

Live trip updates and vehicle positions require fresh per-entity observations,
exact imported trip/route identities, an active explicit service date and a
generation unchanged during validation. Calls must match exactly and allow
boarding. Absolute prediction times only; delays alone are not invented arrivals.
The feed header and vehicle observations must be fresh (60 seconds, 30 seconds
future-clock tolerance). Station reports and scheduled positions are never GPS.
Missing observations remain scheduled, not live.
Fresh-feed notices retain only exact imported route selectors. System-wide,
unknown and stop-only alert scopes are withheld rather than promoted to all routes.
Station arrivals aggregate the publisher's supplied child platforms.

Exact publisher URLs already owned by direct adapters are withheld. Explicit
Transitland feed crosswalks suppress only imported matching route IDs and modes;
uncovered routes remain available from Transitland. Feed-scoped GTFS IDs stay
stable across refreshes. Existing rider favorites are not rewritten.

## Operations

Run from `artifacts/api-server`:

```sh
pnpm exec tsx src/transit/mobility/cli.ts catalog AU
pnpm exec tsx src/transit/mobility/cli.ts import mdb-935
pnpm exec tsx --test tests/mobility.ts
```

Manual imports use the same eligibility gates and active-feed capacity, but do
not consume the automatic-registration/day allowance. No public write/import
endpoint is exposed. Registered metadata restores at startup; stale registered
feeds are checked every six hours and imported no more often than daily.
New deployments require their own successful imports; development database
contents do not automatically become published data.

## Verified initial coverage

The Canberra Metro Operations feed (`mdb-935`) was successfully imported and
checked through the normal API: 6 rail/bus routes, 40 station/platform records,
6 supplied map line segments, a 14-stop light rail route with 386 shape points,
and dated departures in Australia/Sydney. A 2030 date returned no departures
rather than recycled old times. Canberra realtime is not claimed: the verified
initial feed is scheduled-only. These measurements describe the development
import, not guaranteed worldwide or published-app coverage.

Official references:
- https://mobilitydata.github.io/mobility-feed-api/SwaggerUI/index.html
- https://mobilitydata.github.io/mobility-feed-api/DatabaseCatalogAPI.yaml
- https://mobilitydata.github.io/mobility-feed-api/DatabaseCatalogTokenAPI.yaml
- https://mobilitydatabase.org/terms-and-conditions
