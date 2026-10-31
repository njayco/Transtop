# Transtop

A mobile-first transit app based on the creator's original Transtop concept. Verified direct NYC, Long Island, Connecticut and selected intercity sources are supplemented by bounded worldwide Transitland discovery wherever eligible feeds are available. Desktop has synchronized stop results and a Google map; mobile has Nearby, Search, Favorites and Ride navigation. No account is required.

## Current features and recent updates

### Japan public ODPT schedules and verified Sendai realtime

Direct public GTFS/GTFS-JP adds Sendai buses, Nishitokyo Hana Bus and Tosaden
streetcars to the existing search, nearby, map and timetable screens. Dates use
Asia/Tokyo; trams remain identified as trams within the rail filter. Fresh,
exactly matched Sendai trip updates and GPS observations are supported; Hana
and Tosaden remain scheduled. These are selected CC BY 4.0 datasets, not complete
Japan, Tokyo Metro or JR coverage. No ODPT account or Transitland dependency.
See [ODPT setup, credits, verified data, limits and exclusions](docs/odpt.md).

### London official live predictions

Direct TfL Unified API data complements Transitland, without using its requests
or feed-license approvals. London stop search, nearby/map boarding points,
official bus/Underground/DLR/Elizabeth line/Overground predictions and line
notices use the existing Transtop pages and filters. Requires the server-only
`TFL_API_KEY`; disable safely with `TFL_ENABLED=false`. No UK-wide National Rail
claim, invented schedules or prediction-derived vehicle markers. See
[TfL setup, verified samples, conservative shared limits, credits and coverage](docs/tfl.md).

Documentation updated **October 31, 2026**. Coverage describes implemented sources, not a guarantee that an upstream feed or every operator is currently available; check Settings for source health and imported coverage.

### Regional interactive entry

The original US MetroCard entry remains the default. Approximate IP-country
styling adds London (GB), Paris (FR) and Tokyo (JP) versions inspired by the
supplied posters, with separate responsive route art, badges, landmarks and
draggable original cards. Every version still requires a right-to-left slide
or keyboard equivalent, remembers entry in the tab and replays from Settings
without changing the destination. Failed/unknown country detection falls back
promptly; it never requests GPS or sends the visitor IP to a geolocation vendor.
DB-IP Lite is processed locally with attribution under CC BY 4.0. This changes
entry artwork only, not agency coverage, fares or ticketing.
See [privacy, ingress verification, database packaging/updates and fixture previews](docs/regional-entry.md).

- **Original swipe-entry homepage:** responsive mobile/desktop recreation of the supplied black Transtop artwork, large white title, colored transit lines, five transport icons and MetroCard. Drag/swipe the card right to left to enter, or use the keyboard equivalent. There is no skip button or automatic entry. This is an entrance interaction, not a fare payment, card reader or balance service. Ferry and airplane icons are artwork, not active transport coverage.
- **Live-only rider experience:** real agency observations, labeled published schedules and eligible community estimates; no Demo toggle or simulated live arrivals. Missing data is disclosed rather than replaced with examples.
- **Google Maps and regional browsing:** dark geographic basemaps, shared stop/route selection, operator/mode/local-or-express filters, numbered route stops and a searchable legend. Panning retains the current network while the new viewport loads. Route lines, stop markers and vehicles are reconciled by stable identity instead of being removed and recreated on every refresh; delayed initial tiles, offline recovery and authorization failures have explicit states.
- **Transitland worldwide discovery:** city/place or coordinate search, on-demand stop/route/operator discovery, source pages, selected-date timetables, native agency timezones and supplied route patterns in the existing screens. Global stops show source dates, reuse terms, platform/accessibility information and coverage limitations. This does not guarantee every country, carrier or realtime feed. See [Transitland operation](docs/transitland.md).
- **Live route badges:** subway vehicles use colored route circles (including the red 2), and bus/commuter/intercity vehicles use labeled transport badges when their provider supplies fresh observations. GPS markers ease only between received coordinates, never extrapolate, and respect reduced motion. Subway/rail vehicle messages with only a station ID are shown at the reported station, explicitly labeled “not GPS”; no timetable prediction is converted into a location. Schedule-only providers have no invented live vehicle. Positions do not depend on a matching route shape being loaded, and existing source freshness limits still apply.
- **MTA buses across all five boroughs:** six coordinated static packages cover Manhattan, Bronx, Brooklyn, Queens, Staten Island and MTA Bus Company, including local, SBS and express services. Authorized Bus Time feeds add official predictions, reported vehicle positions and alerts where fresh matching data is available.
- **Connecticut buses and trains:** official CTtransit/CTfastrak schedules and public realtime bus feeds, plus published CTrail Hartford Line and Shore Line East timetables. Regional map bounds include Connecticut and Springfield; major Connecticut locations are searchable. Existing Metro-North service remains separate.
- **Integrated Intercity Bus Network:** browse by selected location alongside local buses, subway and commuter rail, then filter by provider and inspect remaining stops and final destinations. Port Authority is a boarding location in this shared experience, **not a separate terminal hub**.
- **Trans-Bridge:** regular and verified Thanksgiving/Black Friday timetables from all 15 supplied carrier PDFs, with stop locations, PABT gates, airport boarding guidance and reservation/drop-off restrictions. Details and known conflicts are documented below.
- **NJ TRANSIT 890/891:** the uploaded T1890 brochure adds weekday local-bus timetables, numbered timepoints, published fares, lift-equipped service notes and school/flex restrictions. These remain local buses, not intercity buses.

Existing features include device-local stop/route favorites, selected-date timetables, source/update labels, large-text and reduced-motion preferences, opt-in foreground Ride Mode and an installable PWA shell.

## Daily GTFS refresh operations

### Amtrak schedules and tracking

Amtrak is integrated with existing rail/operator browsing, not a separate hub.
Import its national rail schedules with
`pnpm --filter @workspace/api-server run import-gtfs amtrak`; the existing
`TRANSIT_AUTO_IMPORT=true` lifecycle also refreshes them. Agency 51 train routes
are isolated from Shore Line East agency 1230 and non-rail/shared-operator services.

Train reports are supplied by [Amtraker](https://amtraker.com), using upstream
Amtrak observations, under [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/).
API documentation: [Amtraker](https://github.com/piemadd/amtrak).
Transtop uses its offered JSON API, not direct Amtrak endpoint decryption.
Prominent app/map attribution is required; source credit must not be hidden in
Settings alone. No Amtraker library code is copied.

Tracking is cached server-side and checked every minute with timeout/backoff.
Reports expire five minutes after the source observation time. Missing, failed,
stale or ambiguous observations never become live predictions or invented route
associations. Selecting a numbered train opens its dated ordered station calls.
Date-selectable timetables use GTFS service dates, with departures shown in
station-local timezones. Thruway, charter, MARC, VIA-only service, Shore Line East
and other agencies' shared-route portions are excluded from this Amtrak catalog.
See [access decisions, operation and limitations](docs/amtrak-access.md).

See [transit import performance and rollback](docs/transit-imports.md) for the
generation-based publication strategy, isolated benchmarks, cleanup limits, and
the required compatibility step before reverting to older schedule readers.

## Run locally

Requires Node.js 24, pnpm 10 and PostgreSQL. Replit supplies the development database through `DATABASE_URL`; never commit credentials.

```sh
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run import-gtfs mta-subway mta-lirr mta-mnr mta-bus nice suffolk hart long-beach glen-cove hudson-link airtrain-jfk
```

Start the existing **API Server** and **Transtop web** workflows. They inject `PORT` and `BASE_PATH`. The API is mounted at `/api`, the app at `/`. For non-Replit hosting, provide the same variables and route `/api` to Express with the frontend at `/`. Build the API with its `build` script and the web app with its `build` script. The web app needs the API service as well as static assets.

`pnpm run typecheck` checks the whole repository. Targeted backend/frontend regression suites, API checks and mobile/desktop visual checks are available; broader end-to-end coverage remains release work. See [Verification](#verification).

### Environment configuration

Use workspace secret/environment configuration; never commit credential values.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL for imported agency data, snapshots and rider contributions. |
| `VITE_GOOGLE_MAPS_API_KEY` | Browser Maps JavaScript API key, restricted to authorized websites and that API. Embedded at frontend build time; see [Google Maps](#google-maps). |
| `MTA_BUS_TIME_API_KEY` | Server-only authorization for Bus Time trip updates, vehicle positions and alerts. Without working authorization, eligible static schedules remain separately labeled rather than called live. |
| `TRANSIT_AUTO_IMPORT` | Set to `true` to opt into missing/stale static GTFS imports on startup and daily refresh. Separate from curated PDF imports. |
| `GOOGLE_MAPS_ROUTES_API_KEY` | Reserved server-only credential for the deferred Google journey planner. Supplying it does **not** enable that feature. |
| `TRANSITLAND_API_KEY` | Server-only Transitland v2 REST key; never prefixed with `VITE_` or returned to clients. |
| `TRANSITLAND_ENABLED` | Explicit `true` enables bounded global lookups; `false` disables them without changing direct sources. |
| `TRANSITLAND_PLAN`, `TRANSITLAND_ALLOW_BILLABLE` | Activation requires approved `production` access and explicit `true` billable-request approval. No signup or plan purchase is performed by the app. |
| `TRANSITLAND_MONTHLY_REQUEST_LIMIT` | Approved total ceiling is 9,999 requests per UTC month: 999 reserved for development and 9,000 for the published app, atomically counted in PostgreSQL before upstream calls. Lower totals retain the 10%/90% split; other apps sharing the key remain outside this cap. |
| `PORT`, `BASE_PATH` | Per-service host configuration supplied by the existing artifact workflows. |

## Data modes

**The rider app is Live-only.** “Live” selects real transit sources; it does not mean every result is a realtime prediction. Rows distinguish fresh agency predictions, published scheduled times and eligible community estimates. Demo-sourced results are filtered out of the rider interface.

Backend demo compatibility and isolated mode keys remain for development/testing, but there is no rider-facing mode switch. Favorites and preferences are stored on the device.

The regional importer supports the agencies below. Settings is the current coverage inventory: imported counts, source files, import timestamps, service windows, expired/partial data and last errors. Do not infer current coverage from an adapter being configured. Imported development data does not automatically seed a new production database; perform the documented imports in the target environment through an authorized job after schema setup.

### Integration status

| Agency | Implemented | Requirements and limitations |
| --- | --- | --- |
| NYC Subway | Working: regular GTFS + all eight public GTFS-RT feeds + official alerts | No key required. Live predictions verified end to end. GPS positions are not invented from arrival times. Regular static schedule omits many temporary changes; fresh live updates/alerts are authoritative. |
| LIRR | Working: GTFS + public GTFS-RT | No key required. Static import and fresh feed verified. Displays vehicle coordinates only when provided. |
| Metro-North | Working: GTFS + public GTFS-RT | No key required. Port Jervis and Pascack Valley services require a separate NJ TRANSIT integration and are excluded. |
| MTA Bus | Six official packages imported as one atomic generation, plus authorized Bus Time GTFS-RT trip updates, vehicle positions and alerts | Manhattan, Bronx, Brooklyn, Queens, Staten Island and MTA Bus Company local/SBS/express schedules. Live access requires `MTA_BUS_TIME_API_KEY`; unmatched trips, failed polls and stale observations are not labeled live. Coordinates are never invented. Borough file names are not geographic boundaries. |
| NICE Bus | Official public static GTFS | Nassau local/express stops and schedules. No unverified live predictions. |
| Suffolk County Transit | Official public static GTFS | Fixed-route service only; realtime access requires agency approval. |
| Huntington HART / Long Beach / Glen Cove | Public GTFS distributed through NYSDOT 511NY | Check displayed service windows and seasonal timetables. No unverified live predictions. |
| Hudson Rail Link / JFK AirTrain | Public GTFS distributed through NYSDOT 511NY | Bronx commuter feeder buses and Queens airport rail connections. Schedules only. |
| CTtransit / CTfastrak | Official GTFS and public GTFS-RT trip updates, vehicle positions and alerts | Hartford, New Haven, Stamford, New Britain, Waterbury and Meriden divisions, including published express routes. No API key required. Live labels require fresh observations; otherwise eligible schedules remain labeled scheduled. |
| CTrail Hartford Line | Official Hartford Line GTFS linked by CTtransit | New Haven–Hartford–Springfield calendars, stations and shapes. Published schedules only; no separate verified public rail realtime feed configured. |
| CTrail Shore Line East | Shore Line East subset of the Amtrak GTFS linked by CTtransit | Only operator ID `1230` and its referenced trips, services, stops and shapes. National Amtrak services are excluded. Scheduled, not realtime; check carrier notices for temporary changes. |
| Trans-Bridge Lines | Curated regular and exact November 26–27, 2026 holiday schedules from 15 carrier PDFs | Allentown/Clinton, Doylestown/Flemington, Newark Airport, Wind Creek and Wall Street. Scheduled times only, qualified map locations and source links; exceptions/conflicts below. |
| Martz | Partial validated public New York timetable | Recurring trip-specific patterns only. Special/ambiguous trips and unverified holidays are withheld. Not complete network or live-vehicle coverage. |
| NJ TRANSIT 890/891 | Uploaded T1890 weekday local-bus brochure | 29 trip patterns and 16 numbered timepoints, effective July 11, 2026. Not a full NJ TRANSIT integration; weekend and unverified holiday schedules are not supplied. |
| Other intercity providers | Coverage inventory and official links, with access/verification gaps disclosed | A provider listing or alias does not mean its departures, stops or booking inventory are imported. |
| Transitland | Global, bounded on-demand stops/routes, supplied patterns and dated departures for eligible feeds | Separate account key, production access approval and request budget. Unknown/incompatible rights are withheld. Static source snapshots over 45 days old do not supply current departures. Realtime feed redistribution is separately gated by actual API access and fresh source timestamps. |
| Private commuter operators | Coverage gap | Hampton Jitney, Hampton Luxury Liner and other operators without a verified authorized bulk feed are not claimed as complete. Use official operator schedules. Google may return some journeys but does not guarantee coverage. |
| Ferry / air | Out of scope | Future expansion only. |

Official documentation verified on 2026-10-29:

- [MTA developer resources and static downloads](https://www.mta.info/developers)
- [MTA realtime catalog](https://api.mta.info/)
- [MTA data terms](https://www.mta.info/developers/terms-and-conditions)
- [MTA Bus Time API documentation](https://bustime.mta.info/wiki/Developers/Index)
- [US Census address geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
- [NICE developer downloads and terms](https://www.nicebus.com/Passenger-Information/App-showcase)
- [Suffolk developer downloads](https://suffolkcountyny.gov/Departments/Public-Works/Transportation/General-Transit-Feed-Specification-Details)
- [NYSDOT open-data terms for 511NY feeds](https://data.ny.gov/download/77gx-ii52/application/pdf)

The allowlisted endpoints are in `artifacts/api-server/src/transit/adapters.ts`. Feeds are fetched, decoded and cached by Transtop's server; browsers never directly fetch MTA data. External IDs are namespaced by agency, with dataset mode as a separate key. MTA bus trip/service/shape IDs are additionally feed-scoped; shared route/stop identifiers remain stable for favorites. The six borough/company files must never be published as successive replacements of the same agency.

Search offers paginated route/stop browsing by operator, mode and local/express class. Stop and route pages have selected-service-date timetables and actual destination/direction patterns; route-only timetables show trips departing their supplied origin pattern. Existing regional controls use **America/New_York**, independent of the visitor's timezone; Amtrak departures retain station-local display. Transitland controls use the verified agency timezone, labeled on the panel; no timezone means no guessed departure clocks. GTFS departures beyond 24:00 show their following calendar date. Untimed intermediate stops never acquire fabricated exact times. A published timetable is not a realtime prediction or a guarantee against disruptions.

MTA data is supplied as-is. Transtop is independent and is not affiliated with or endorsed by the MTA. The supplied historic entry artwork includes MTA/MetroCard imagery; this does not establish agency affiliation or authorization. There is no MetroCard balance integration or fare payment. Review data terms and branding/image rights before public launch.

### Intercity Bus Network

Select/search for a location, choose **Intercity Bus Network**, then filter by provider. Nearby intercity departures use a **3 km** boarding-location radius. Date/time controls, trip-specific subsequent stops, final destinations, boarding notes and official source links are integrated into the shared experience. Named stops without verified coordinates remain in timetable sequences instead of receiving guessed map pins. PDF imports do not invent road geometry or moving vehicles.

The provider inventory audits the supplied Midtown terminal directory, including aliases and operators without usable bulk data. It distinguishes imported, partial, stale, link-only and access-required coverage. A directory listing is not proof of current terminal service; missing imported times do not mean no service operates.

**Martz:** recurring public timetables refresh daily. A validated snapshot is usable for at most 72 hours; stale/changed/unavailable sources cause times to be withheld. Queries are limited to the effective date through the next 30 days. Special/ambiguous rows and unverified holidays are not extrapolated from a generic route.

#### Retained IBG research archive (offline only)

The University of Illinois **Intercity Bus GTFS (IBG)** research snapshot is retained for offline research and audit, not rider-facing coverage. Existing snapshots, audit documents and uploaded source materials are not deleted. Independently imported Martz, Trans-Bridge, NJ TRANSIT 890/891, regional feeds, Amtrak and independent Transitland services retain their own availability and attribution.

- Nearby, search/catalog, maps, provider filters and source coverage do not load IBG records. Saved research favorites are hidden without deleting the stored local records.
- Old IBG stop/route links return the normal unavailable response. Timetable requests containing either an IBG stop or route identity return empty results, including mixed-provider requests.
- Startup does not download or import IBG. Offline archive utilities and validation tests remain available, isolated from public application paths.
- The snapshot uses a separate PostgreSQL **reference** namespace and cannot replace live GTFS, verified PDF timetables or realtime reports. The original 42 MB ZIP is not committed to Git or retained as an application asset.
- An explicit archive-maintenance utility remains available; running it does **not** enable rider coverage:

  ```bash
  pnpm --filter @workspace/api-server exec tsx src/transit/intercity/import-ibg-cli.ts
  # Optional local archive; it must match the pinned SHA-256:
  pnpm --filter @workspace/api-server exec tsx src/transit/intercity/import-ibg-cli.ts /path/to/Merged_GTFS_Feed.zip
  ```

Offline utility downloads are fixed to a repository revision, bounded in size and verified against SHA-256 before atomic snapshot storage. A failed download or validation leaves the previous complete snapshot intact. The article's license is not presented as independent permission for all underlying carrier feeds.

**Attribution:** Ahammed, Dewan T., Bo-Jyun Shih and Lewis Lehe (2026), “[A GTFS-Based Dataset for the US Intercity Bus Network](https://doi.org/10.32866/001c.159284).” [Dataset, processing notes and source metadata](https://github.com/UTEL-UIUC/intercity-bus-gtfs).

#### Trans-Bridge regular and holiday schedules

All **15 supplied PDFs** are recorded with official carrier URLs and SHA-256 source hashes:

| Corridor / source | Imported coverage |
| --- | --- |
| Allentown–Clinton–New York | Eastbound effective July 10, 2026; westbound June 8, 2026. Weekday, Monday–Thursday, Friday-only and weekend patterns retained. |
| Doylestown–Flemington–New York | Both directions effective March 9, 2026, with each run's actual intermediate stops. |
| Newark Airport | To/from-airport sheets effective June 8, 2026, cross-checked against complete corridor timetables; boarding guidance preserved. |
| Wind Creek | Regular June 8, 2026 and holiday extracts cross-check full-route runs instead of creating duplicate buses. |
| Wall Street | Both directions from the July 25, 2025 timetable still listed by the carrier at verification; weekday and Monday–Thursday restrictions preserved. |
| Thanksgiving / Black Friday | Seven dedicated sheets for **November 26 and November 27, 2026**, covering Allentown/Clinton, Doylestown, Newark Airport and Wind Creek. |

There are **75 regular trip patterns, including four Wall Street patterns, plus 22 holiday replacement patterns**. These are calendar-specific patterns, not 97 daily departures. Airport/casino extracts do not add duplicate physical buses.

**Holiday overrides:** the supplied November 26–27 timetables replace regular Trans-Bridge service on those exact dates. **There is no Wall Street service eastbound or westbound on Thanksgiving, Thursday November 26, or Black Friday, Friday November 27, 2026.** Other corridors retain their verified holiday runs. These exceptions do not extend to other years/holidays; unverified holidays are withheld rather than assigned normal weekday clocks.

**Stop locations and restrictions:**

- Individual runs retain published PABT lower-level South Wing gates; confirm current gates before boarding.
- Newark guidance includes Terminal A's lower-level Zone 16 and the carrier's Terminal B/C timing offsets. Airport coordinates are orientation points, not exact boarding poles for every terminal.
- Wind Creek boarding is in the designated parking-garage bus lanes.
- Flemington uses the current **80 Park Avenue** address, not the outdated destination in the older carrier map link.
- Notes distinguish operator-linked places, address-level geocodes and terminal/area orientation points. Unverified street-level pins remain absent.
- Arrival-only and `D` discharge stops never become boarding predictions. Untimed intermediate stops remain in sequence without fabricated times.
- `R` cruise-terminal service requires reservation; no unprinted clock time is supplied. Run 128's untimed Allentown extension appears only for Newark Airport passengers.
- After-midnight times retain the originating service day and show the following calendar date in `America/New_York`.

**Known source conflicts:** the July main timetable supersedes the older airport extract's Friday Allentown/Bethlehem pickups for run 181. Weekend westbound run **214** has conflicting Hellertown, Wescosville and Allentown onward times between sheets; those three public clocks are withheld pending carrier confirmation, while verified boarding and other matched times remain available.

These are **published schedules, not live Trans-Bridge predictions**. The curated PDF snapshot ships with the API and is not automatically replaced by the GTFS job. Review/re-import changed carrier documents before updating it; check the carrier for disruptions and gate changes.

Official sources: [regular schedules](https://transbridgelines.com/schedules-stops/schedules), [holiday schedules](https://transbridgelines.com/schedules-stops/holiday-schedules), [bus stops](https://transbridgelines.com/schedules-stops/bus-stops), [Newark Airport](https://transbridgelines.com/schedules-stops/newark-airport-service), [Wind Creek](https://transbridgelines.com/schedules-stops/wind-creek-bethlehem-casino), and [cruise-terminal reservations](https://transbridgelines.com/schedules-stops/pier-transportation).

#### NJ TRANSIT local routes 890/891

The supplied T1890 brochure adds **29 weekday trips across 16 numbered timepoints**, preserving short workings, blank cells, noon rollovers and directional stop order. Source notes include the July 1, 2026 fares, lift-equipped information, school restrictions and flex-service reservation instructions. Published fares are historical to that source date, not live fare quotes.

These routes use ordinary **bus** mode and the NJ TRANSIT agency filter, not the Intercity Bus Network. Only verified timepoint coordinates are mapped; all named timepoints remain selectable in route timetables. Other NJ TRANSIT routes, weekend clocks and unverified holiday departures are not claimed.

Useful API entry points:

- `GET /api/transit/intercity/providers` — provider inventory and coverage/source status.
- `GET /api/transit/intercity/departures?lat=40.7569&lon=-73.9910&provider=transbridge&date=2026-11-26` — location/provider/date-filtered scheduled departures.
- `GET /api/transit/timetable?mode=live&routeId=transbridge%3Aallentown-west&date=2026-11-26` — shared selected-date timetable.
- Shared `/api/transit/stops`, `/api/transit/routes/:id` and `/api/transit/network` also include eligible imported stops/routes.

### Connecticut coverage and operation

CTtransit buses use ordinary **bus** mode; Hartford Line and Shore Line East use **rail**. All three operators appear in the source inventory, search/agency filters, nearby stops, selected-date timetables and regional map. They are not intercity bus providers. Metro-North's Connecticut/New Haven Line coverage remains under its existing operator rather than being imported again.

Official bus schedules come from [CTtransit's developer download](https://www.cttransit.com/about/developers). The source covers the listed divisions, not every independent Connecticut bus operator. CTfastrak is bus rapid transit, not a train. Published 900-series express routes are classified separately from local/CTfastrak buses.

Three public realtime protobuf feeds provide bus trip updates, vehicle coordinates and alerts without a new credential. Existing feed/vehicle freshness rules apply: stale/unavailable observations never produce fabricated movement or live labels. Connecticut alerts are namespaced to Connecticut routes, not MTA routes.

Rail downloads are `https://ctrides.com/hlgtfs.zip` and the CTtransit-linked `https://content.amtrak.com/content/gtfs/GTFS.zip`. The latter is a shared national archive: selection uses Shore Line East's operator ID, not its generic “Commuter Rail” route name. Unrelated agencies, trips, calendars, stop times, stops and shapes are excluded. A missing selected operator fails the import rather than publishing an empty replacement.

The current Shore Line East trips do not reference route shapes, so stations and timetables are available without an invented map line. Hartford Line supplies referenced geometry. CT bus realtime normalization discards invalid optional display extensions that cannot be stored in JSONB; it preserves identifiers, timestamps and arrival/departure events.

To import/refresh the development database:

```sh
pnpm --filter @workspace/api-server run import-gtfs cttransit ctrail-hartford ctrail-sle
```

These adapters also participate in the existing opt-in daily GTFS importer. Imported development data does not automatically seed a separate production database.

The owner accepted [CTtransit's GTFS license](https://www.cttransit.com/about/developers/terms-of-use) before import. Data is supplied as-is; CTtransit/CTDOT do not guarantee accuracy, completeness or currency. No CTtransit logos or official copyrighted maps are reproduced. Confirm temporary changes with [CTtransit](https://www.cttransit.com/alerts), [Hartford Line](https://www.hartfordline.com/) and [Shore Line East](https://shorelineeast.com/schedules), particularly beyond imported service windows.

## Arrival selection and timestamps

The server prefers fresh official predictions, then eligible community estimates for a specific trip, then published schedules, then an honest no-arrivals state. Official data older than 60 seconds, in the future, or from a failed poll is not labeled live. Each arrival includes its own source and update time. A server response timestamp is not evidence that the underlying transit observation is fresh.

GTFS trip cancellations and skipped/no-data stop updates are excluded from predictions and schedule fallback when fresh. Regular GTFS is not guaranteed to reflect short-term changes. Agency time uses `America/New_York`, calendar exceptions override weekly calendars, and the schedule conversion follows GTFS noon-minus-12-hours semantics across DST and supports times over 24:00.

Route geometry comes from every distinct available imported GTFS shape referenced by a route's trips, including available branches/directions. There is no stop-to-stop straight-line fallback in live mode. The network response identifies routes with unavailable geometry, including partially missing patterns. Subway prediction feeds do not generally include GPS positions. Vehicle positions require both a fresh successful feed and an independently fresh vehicle timestamp (60 seconds, with 30 seconds future-clock tolerance); missing timestamps are withheld, not replaced with feed timestamps. Static paths are routes, not observed movement.

### Regional map

Open **Regional map** from Nearby to fit NYC's five boroughs, Nassau, Suffolk and Connecticut, including the Hartford Line's Springfield terminus, without geolocation. The supported-operator list comes from the existing catalog, including expired/future schedule status and coverage gaps. It does not imply that every operator or every active service is covered.

`GET /api/transit/network` accepts finite `west,south,east,north` bounds, `zoom` (0–22), mode, type, agency, service class and optional route ID. West greater than east denotes a date-line crossing and is split into two geographic requests; narrow to one side to advance a partial source page. Legacy `lat,lon` callers remain supported. Results include stable shape IDs, named catalog stops, generation, totals, missing geometry, explicit `truncated` and optional `globalCoverage` information. Segment/viewport intersection includes paths crossing the view with no vertex inside. Simplification retains official vertices. Existing direct geometry remains cached by imported snapshot generation; international discovery is bounded separately.

Rail/subway paths remain available at regional zoom; bus paths start at zoom 12 and stops at zoom 13. A route-ID request bypasses these thresholds and viewport clipping. Payload limits are 600 shapes, 180,000 simplified vertices and 500 stops, always disclosed with totals; filter or zoom to resolve a partial view. Selected-route stops have persistent numbers matching the ordered list. The legend is scrollable/searchable and labels mode/operator/express metadata. Mode outlines and widths/dashes supplement official line colors.

Map idle changes are debounced 350 ms. Fetches are keyed by the settled viewport/filters; prior demo/filter responses are not retained as placeholders for a new query. Regional static geometry refreshes every five minutes, independently of the 30-second `/api/transit/map-vehicles` feed. Vehicle refreshes do not reset the viewport or refit route geometry. No demo positions are fabricated or mixed into live results.

MTA's supplemented subway feed was reviewed: it overlaps the regular feed and covers only the next seven calendar days. This build retains the regular complete catalog plus fresh GTFS-RT/alerts, rather than merging two overlapping catalogs and duplicating trips. Temporary static service changes can therefore be missing; always check agency alerts.

Walking distances are straight-line approximations, not turn-by-turn accessible walking routes. Accessibility “not confirmed” is not a statement that a station is inaccessible. Elevator outage integration is not implemented.

Known local places and exact local stations stay local. Other entered places/addresses use the public Photon/OpenStreetMap geocoder: at most one new lookup per second per server, five-minute bounded in-memory caching and a timeout, with no persisted search text. The screen discloses this transfer and shows Photon/OpenStreetMap attribution. It is an approximate lookup, has no availability guarantee, and is not intended for bulk geocoding. Latitude,longitude input works without a geocoder. A lookup failure leaves station/operator search and map selection available.

## Privacy and Ride Mode

Browsing and nearby permission are independent of contribution consent. Ride Mode requires explicit consent, an agency, route, direction and boarding stop. Trips can be selected only where reliable matching is available; an ambiguous or absent trip never produces a community ETA.

- Session IDs and capability tokens are cryptographically random. Only token hashes are stored server-side; tokens stay in browser session storage and are never returned through public APIs.
- Contributions require a valid, active, unexpired capability. Stop sharing clears the location watch immediately, revokes server access, and queues revocation retry if offline.
- Sessions expire after two hours. Contributions stop counting as evidence after 90 seconds without fresh samples. A closed browser cannot guarantee an immediate server revocation, but old evidence is withheld and the session expires.
- Browser location is foreground only over HTTPS; no continuous mobile background tracking is promised.
- Raw samples are rejected when stale, overly inaccurate, off-route, duplicate, moving backwards against the trip shape, or implausibly fast.
- Without an identifiable trip and directional shape, raw coordinates are not stored. Reports can still be recorded.
- At least `COMMUNITY_MIN_CONTRIBUTORS` distinct recent browser pseudonyms (minimum 3), each with multiple samples, are required for a trip-specific ETA. Widely separated observations are withheld instead of combining different vehicles. Published estimates are ranges marked heuristic and uncalibrated.
- Browser pseudonyms are a modest anti-duplication measure, **not proof of independent people**. Stronger anti-Sybil and multi-instance rate limiting are required before relying on crowdsourcing at scale.
- No public API exposes raw location, contributor identifiers or individual rider paths. This build publishes community ETA ranges, not community vehicle positions.
- Raw samples/reports are deleted after 24 hours, with up to one minute of cleanup delay while the runtime is running. Old sessions and estimates also expire. If the runtime is stopped, cleanup runs on the next start.
- No coordinates, address queries, cookies or capability headers are included in request logs.

Reports support arrived/departed/delayed and low/medium/high crowding. Reports are stored as explicit observations; the initial ETA engine uses validated route progress and recent speed with a dwell assumption, not a calibrated historical model. Crowding is never inferred from device counts. No crowding aggregation is shown until a reliable publication policy is implemented.

## Jobs and deployment

Use an **always-running server** for predictable polling and retention. The API process owns:

- GTFS-RT and official alerts polling every 30 seconds with limited concurrency and 15-second timeouts.
- Feed health assessed against upstream timestamps on every read.
- Retention cleanup every minute and on startup.
- With `TRANSIT_AUTO_IMPORT=true`, missing/stale static datasets are refreshed on startup and daily, using a shared advisory lock with the CLI. Successful imports younger than 22 hours are skipped. Independent agency failures preserve the last successful generation and do not stop the other agencies. Without this opt-in, run the CLI explicitly.

Intercity sources have separate update rules: Martz refreshes daily when its public source validates; Trans-Bridge and NJ TRANSIT brochure tables are curated snapshots shipped with the code. Updating development code/data does not update an already published app until the update is published.

Static imports stage a full generation in separate mode keys, then swap atomically. A failed import leaves the previous complete live dataset intact. The import CLI supports only registry-approved agencies and endpoints, not arbitrary user URLs.

Production should have a single poller/worker owner. Multiple independently polling instances will multiply upstream traffic; move jobs to a dedicated worker and add distributed locks/queues and shared rate limits before scaling. Database snapshots persist source observations; the runtime's prediction cache warms on its first poll.

The database schema is in `lib/db/src/schema/transit.ts`; the initial SQL migration is in `lib/db/drizzle/`. Apply development schema changes with Drizzle. Replit-managed production schema changes are applied through Publish; do not run startup-time DDL.

### Google Maps

Google Maps Platform is connected through Replit Integrations for official development documentation. That MCP connection does not provision a runtime API key or pay Google Cloud charges.

Add `VITE_GOOGLE_MAPS_API_KEY` through Replit Secrets. Enable **Maps JavaScript API** and billing on its Google Cloud project. Browser keys are intentionally visible to visitors: restrict this key to Maps JavaScript API and the exact preview/published website origins using Google Cloud website restrictions. The loader uses origin-only referrers, so allow the website origin rather than a narrow URL path. Never reuse a server-only Google key in this variable. Vite embeds this value at build time; restart development after changing it and rebuild/republish for production changes.

Maps JavaScript API supplies the basemap. **Current release: schedules only.** The creator approved finishing without Google journey planning after Google rejected the supplied server credentials. Search therefore exposes the agency catalog, not a trip-planning tab; `POST /api/transit/journeys` returns an explicit unavailable response without calling Google. Map display authorization is independent of the deferred journey planner. The integration code is retained for a future separately approved activation with valid authorization.

When activated, Google **Routes API** can supply on-demand journey alternatives; it does not supply the complete GTFS catalog. Existing official transit predictions and GTFS shapes remain separately labeled sources. Ordinary numbered address lookup continues to use Census. Opening a map transmits its viewport and ordinary connection metadata to Google; submitting a journey explicitly sends the two location texts, travel time and transit preferences to Google. Individual rider samples are never sent to Google as public markers.

For the journey planner, enable **Routes API** and billing in Google Cloud and add **`GOOGLE_MAPS_ROUTES_API_KEY`** through Replit Secrets. This is a separate server-only credential restricted to Routes API (and appropriate server application restrictions where supported), never the website-restricted `VITE_` browser key. The Replit MCP connection cannot enable billing/APIs or provision this credential. Missing authorization, quota exhaustion, timeouts and no-route responses have distinct messages; schedules continue working without Google.

Google itinerary responses are not written to the database or browser storage and are sent with `Cache-Control: no-store`. A selected Google route is rendered only on a Google map, not on the schematic fallback. Required attribution stays visible. The server uses explicit field masks, a 20-second timeout, no silent billable retries, per-IP limits of 10 requests/minute, an overall 100 requests/minute and at most six concurrent requests per process. Configure stricter Google Cloud quotas/budgets as appropriate; multiple instances require shared quota enforcement. Google determines available alternatives and service coverage. Transit plans support one departure or arrival time, not both; dates must be within Google's supported transit planning window. Times are planned itineraries, not guaranteed official live predictions.

The shared map component renders stop markers, clickable colored route polylines, source-labeled vehicle markers, selection highlights and route bounds. Google’s native attribution and controls remain visible. It requests raster rendering and embedded dark roadmap styles, retaining geographic labels, roads and water without WebGL. It deliberately does **not** supply a map ID: map IDs ignore embedded styles, and Advanced Markers require a map ID. Classic Google markers are used for this raster-compatible path (deprecated by Google but not currently discontinued). `VITE_GOOGLE_MAPS_MAP_ID` is no longer read. Moving to Advanced Markers requires separately verifying a cloud style/map ID and raster support; do not silently combine incompatible styling options.

Map construction and `tilesloaded` are separate states. A 20-second tile delay, SDK/network failure, offline state or Google auth failure shows an explicit actionable message and labeled schematic, never a fake successful Google basemap. Retry and automatic reconnect rebuild the map; late tiles can recover a timeout. Authorization failures require correcting Google Cloud restrictions then reloading. The error displays the current origin without showing the key.

Every camera change starts a new tile-readiness cycle. The focused browser regression held Google image responses for 2.5 seconds after panning: the map reported `loading` with a visible notice, then `tiles-ready` once the tiles completed. Offline/reconnect also restored real raster tiles automatically without Retry or reload, preserving the exact center and zoom 13. The long Port Washington Branch badge was checked at 390×844 after repair: document width equaled client width with no horizontal overflow.

**Authorization diagnosis and verification (2026-10-30):** the initial Build browser returned `RefererNotAllowedMapError`. The owner authorized the preview origin; fresh documents subsequently displayed real dark Google tiles with `RASTER` rendering. Website-restriction changes were initially intermittent, so one partially loaded map was not treated as proof of success. The browser pass then verified NYC subway geography/stops, Mineola/Hempstead NICE bus geography/stops, Suffolk/Patchogue bus stops, Port Washington Branch route details with numbered stops, and Medford's street map. It also verified viewport-bound requests after panning, Fit region without geolocation, and visible Google attribution/searchable legend at 390×844.

If `RefererNotAllowedMapError` returns, in Google Cloud Console → APIs & Services → Credentials, open the browser key used by `VITE_GOOGLE_MAPS_API_KEY`, retain its Maps JavaScript API restriction, and add the exact origin shown in the app error to **Websites** application restrictions. Keep other authorized sites, do not remove restrictions or paste keys into chat, and ensure Maps JavaScript API/billing remain enabled. Origin-only referrer policy requires a domain restriction without a narrow page path. Reload after the change propagates and verify actual tiles on fresh pages, not a cached schematic or an already constructed map.

Backend verification: `pnpm --filter @workspace/api-server exec tsx --test src/transit/*.test.ts` covers bounds, crossing segments, multiple shapes, missing geometry, refresh/cache invalidation, mode isolation, and stale vehicle timestamps, alongside the existing schedule tests. `pnpm run typecheck` checks the root workspace. Public API checks returned 412 rail/subway shapes in the regional overview and official Nassau/Suffolk bus geometry and stops; missing geometry and dense-stop limits were disclosed. These API checks are not a substitute for Google tile verification.

Google Maps use may incur charges against your Google Cloud billing account. Set budgets and API quotas before public traffic. Do not cache Google map tiles or remove attribution. Official setup: https://developers.google.com/maps/documentation/javascript/get-api-key . Google Maps Platform terms: https://cloud.google.com/maps-platform/terms .

The web app includes a PWA manifest and original icon. Its production service worker caches the app shell, never `/api` arrivals. Offline favorites are available locally, but arrivals require connectivity and must not be treated as current when offline.

## Code map

- `artifacts/transtop`: responsive React app, Google Maps, favorites, consent and foreground geolocation.
- `artifacts/api-server/src/transit`: adapters, GTFS importer, realtime polling, schedule fallback, estimation, ingestion and jobs.
- `artifacts/api-server/src/transit/bus-time.ts`: credential-safe MTA Bus Time requests and static/realtime trip identity matching.
- `artifacts/api-server/src/transit/intercity`: provider inventory, Martz validation, Trans-Bridge source tables/stop registry, and shared uploaded timetable services.
- `.agents/scripts/import_transbridge.py`: reproducible positional PDF extraction for the 15 supplied Trans-Bridge documents. Requires development-only PyMuPDF; serving normalized data does not require Python/PDF parsing.
- `artifacts/api-server/tests`: intercity, uploaded timetable, Trans-Bridge and GTFS import/performance checks.
- `artifacts/transtop/tests`: Live-only behavior and map lifecycle regressions.
- `lib/api-spec/openapi.yaml`: request/response contract; regenerate clients with `pnpm --filter @workspace/api-spec run codegen` after edits.
- `lib/db`: PostgreSQL/Drizzle schema and migration.

## Verification

```sh
# Repository-wide types
pnpm run typecheck

# Calendar, source validation, rollover, boarding and holiday regression tests
pnpm --filter @workspace/api-server exec tsx --test tests/intercity.test.ts tests/uploaded-schedules.test.ts tests/transbridge.test.ts

# Existing schedule/network/geometry backend tests
pnpm --filter @workspace/api-server exec tsx --test src/transit/*.test.ts

# Rider Live-only behavior and Google map lifecycle tests
pnpm --filter @workspace/transtop test
```

The Trans-Bridge update passed the **17 combined intercity/uploaded-schedule tests**, backend/frontend typechecks, frontend production build and running API checks. Checks cover the two exact holiday replacements, Wall Street closure, duplicate prevention, Friday/weekend restrictions, after-midnight dates, source conflicts, conditional/drop-off stops and verified locations. This records that update's verification, not a claim that every suite was rerun for this documentation edit or that production is continuously healthy.

`src/transit/connecticut.test.ts` adds regression coverage for operator-limited shared-archive imports, dependent calendars/trips/shapes/platforms, unchanged unfiltered adapters, CT express classification and correctly scoped CT/MTA alerts.

See [transit import operations](docs/transit-imports.md) for database import tests, isolated performance checks, cleanup and rollback requirements. API tests do not replace browser checks for real Google tiles, swipe gestures, geolocation permissions or offline recovery.

## Remaining release work

Private-operator coverage agreements and remaining link-only intercity sources; additional verified street-level/timepoint coordinates; carrier resolution of conflicting Trans-Bridge clocks and future holiday documents; reliable live-trip association where static/realtime IDs differ; calibrated segment/dwell history; aggregated rider-report/crowding publication; stronger contributor verification and abuse controls; multi-instance workers; runtime feed health and production Google billing/key/domain configuration; broader end-to-end regression coverage for stale fallback, permission denial, expiry, ingestion races, outliers and mode isolation. Google journey planning remains deferred until separately approved and authorized. These are documented limitations, not silently simulated features.
