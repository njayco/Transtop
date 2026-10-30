# Transtop

A mobile-first NYC and Long Island transit app based on the creator's original Transtop concept. Desktop has synchronized stop results and a Google map; mobile has Nearby, Search, Favorites and Ride navigation. No account is required.

## Daily GTFS refresh operations

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

`pnpm run typecheck` checks the whole repository. The initial build was checked with TypeScript, API requests and desktop/mobile screenshots; a full automated regression suite is a remaining release requirement.

## Data modes

**Demo is the default.** The persistent “Demo data” indicator means arrivals, alerts and illustrative map lines are examples, not advice for travel. Demo and live records have separate database keys, and live APIs do not substitute demo records. Favorites are stored on the device, tagged with their data mode.

Switch to **Live** in the app header/settings. The regional importer supports the agencies below. Settings is the current coverage inventory: imported counts, source files, import timestamps, service windows, expired/partial data and last errors. Do not infer current coverage from an adapter being configured. Imported development data does not automatically seed a new production database; perform the documented imports in the target environment through an authorized job after schema setup.

### Integration status

| Agency | Implemented | Requirements and limitations |
| --- | --- | --- |
| NYC Subway | Working: regular GTFS + all eight public GTFS-RT feeds + official alerts | No key required. Live predictions verified end to end. GPS positions are not invented from arrival times. Regular static schedule omits many temporary changes; fresh live updates/alerts are authoritative. |
| LIRR | Working: GTFS + public GTFS-RT | No key required. Static import and fresh feed verified. Displays vehicle coordinates only when provided. |
| Metro-North | Working: GTFS + public GTFS-RT | No key required. Port Jervis and Pascack Valley services require a separate NJ TRANSIT integration and are excluded. |
| MTA Bus | Six official packages imported as one atomic generation: Manhattan, Bronx, Brooklyn, Queens, Staten Island, MTA Bus Company | Local/SBS/express schedules. Bus Time live predictions still require separate authorization and an adapter; no fake bus positions. Some routes cross boroughs; the borough file name is not a geographic boundary. |
| NICE Bus | Official public static GTFS | Nassau local/express stops and schedules. No unverified live predictions. |
| Suffolk County Transit | Official public static GTFS | Fixed-route service only; realtime access requires agency approval. |
| Huntington HART / Long Beach / Glen Cove | Public GTFS distributed through NYSDOT 511NY | Check displayed service windows and seasonal timetables. No unverified live predictions. |
| Hudson Rail Link / JFK AirTrain | Public GTFS distributed through NYSDOT 511NY | Bronx commuter feeder buses and Queens airport rail connections. Schedules only. |
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

Search offers paginated route/stop browsing by operator, mode and local/express class. Stop and route pages have selected-service-date timetables and actual destination/direction patterns; route-only timetables show trips departing their origin. All controls and displayed times use **America/New_York**, including for visitors in other timezones. GTFS departures beyond 24:00 show their following calendar date. Untimed intermediate stops remain in route ordering but never acquire fabricated exact times. A published timetable is not a realtime prediction or a guarantee against disruptions.

MTA data is supplied as-is. Transtop is independent and is not affiliated with, endorsed by or licensed by the MTA. No agency logos, proprietary official maps or MetroCard balance integration are included. Original generic route labels/colors are used for identification; review MTA licensing requirements before public launch.

## Arrival selection and timestamps

The server prefers fresh official predictions, then eligible community estimates for a specific trip, then published schedules, then an honest no-arrivals state. Official data older than 60 seconds, in the future, or from a failed poll is not labeled live. Each arrival includes its own source and update time. A server response timestamp is not evidence that the underlying transit observation is fresh.

GTFS trip cancellations and skipped/no-data stop updates are excluded from predictions and schedule fallback when fresh. Regular GTFS is not guaranteed to reflect short-term changes. Agency time uses `America/New_York`, calendar exceptions override weekly calendars, and the schedule conversion follows GTFS noon-minus-12-hours semantics across DST and supports times over 24:00.

Route geometry comes from every distinct available imported GTFS shape referenced by a route's trips, including available branches/directions. There is no stop-to-stop straight-line fallback in live mode. The network response identifies routes with unavailable geometry, including partially missing patterns. Subway prediction feeds do not generally include GPS positions. Vehicle positions require both a fresh successful feed and an independently fresh vehicle timestamp (60 seconds, with 30 seconds future-clock tolerance); missing timestamps are withheld, not replaced with feed timestamps. Static paths are routes, not observed movement.

### Regional map

Open **Regional map** from Nearby to fit NYC's five boroughs, Nassau and Suffolk without geolocation. The supported-operator list comes from the existing catalog, including expired/future schedule status and coverage gaps. It does not imply that every operator or every active service is covered.

`GET /api/transit/network` accepts all four ordered `west,south,east,north` bounds, `zoom` (0–22), mode, type, agency, service class and optional route ID. Bounds must be finite and non-antimeridian-crossing. Legacy `lat,lon` callers remain supported. Results include stable shape IDs, named catalog stops with serving routes, generation, totals, missing geometry and an explicit `truncated` flag. Segment/viewport intersection includes paths that cross the view with no vertex inside it. Simplification retains official vertices. Cached shape bounds avoid expensive intersection work on unrelated paths, and geometry is cached by imported snapshot generation, with importer invalidation and concurrent-load deduplication.

Rail/subway paths remain available at regional zoom; bus paths start at zoom 12 and stops at zoom 13. A route-ID request bypasses these thresholds and viewport clipping. Payload limits are 600 shapes, 180,000 simplified vertices and 500 stops, always disclosed with totals; filter or zoom to resolve a partial view. Selected-route stops have persistent numbers matching the ordered list. The legend is scrollable/searchable and labels mode/operator/express metadata. Mode outlines and widths/dashes supplement official line colors.

Map idle changes are debounced 350 ms. Fetches are keyed by the settled viewport/filters; prior demo/filter responses are not retained as placeholders for a new query. Regional static geometry refreshes every five minutes, independently of the 30-second `/api/transit/map-vehicles` feed. Vehicle refreshes do not reset the viewport or refit route geometry. No demo positions are fabricated or mixed into live results.

MTA's supplemented subway feed was reviewed: it overlaps the regular feed and covers only the next seven calendar days. This build retains the regular complete catalog plus fresh GTFS-RT/alerts, rather than merging two overlapping catalogs and duplicating trips. Temporary static service changes can therefore be missing; always check agency alerts.

Walking distances are straight-line approximations, not turn-by-turn accessible walking routes. Accessibility “not confirmed” is not a statement that a station is inaccessible. Elevator outage integration is not implemented.

Numbered US street addresses use the US Census public geocoder through the server (one new request per second per process, a short in-memory cache, and a timeout). Entered address text is sent to Census for matching. Station and known-neighborhood search stay local. Address matches are approximate and outside-US addresses are unsupported.

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
- `lib/api-spec/openapi.yaml`: request/response contract; regenerate clients with `pnpm --filter @workspace/api-spec run codegen` after edits.
- `lib/db`: PostgreSQL/Drizzle schema and migration.

## Remaining release work

Live bus adapter and authorized access; private-operator coverage agreements; reliable live-trip association where static/realtime IDs differ; calibrated segment/dwell history; aggregated rider-report/crowding publication; stronger independent-contributor verification and abuse controls; multi-instance workers; production Google billing/key/domain configuration; broader automated regression coverage for stale fallback, permission denial, expiry, ingestion races, outliers and demo/live isolation. These are documented limitations, not silently simulated features.
