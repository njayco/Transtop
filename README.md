# Transtop

A mobile-first NYC and Long Island transit app based on the creator's original Transtop concept. Desktop has synchronized stop results and a MapLibre map; mobile has Nearby, Search, Favorites and Ride navigation. No account is required.

## Run locally

Requires Node.js 24, pnpm 10 and PostgreSQL. Replit supplies the development database through `DATABASE_URL`; never commit credentials.

```sh
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run import-gtfs mta-subway mta-lirr mta-mnr
```

Start the existing **API Server** and **Transtop web** workflows. They inject `PORT` and `BASE_PATH`. The API is mounted at `/api`, the app at `/`. For non-Replit hosting, provide the same variables and route `/api` to Express with the frontend at `/`. Build the API with its `build` script and the web app with its `build` script. The web app needs the API service as well as static assets.

`pnpm run typecheck` checks the whole repository. The initial build was checked with TypeScript, API requests and desktop/mobile screenshots; a full automated regression suite is a remaining release requirement.

## Data modes

**Demo is the default.** The persistent “Demo data” indicator means arrivals, alerts and illustrative map lines are examples, not advice for travel. Demo and live records have separate database keys, and live APIs do not substitute demo records. Favorites are stored on the device, tagged with their data mode.

Switch to **Live** in the app header/settings. Official static data was imported for NYC Subway, LIRR and Metro-North during development. Imported development data does not automatically seed a new production database; perform the documented imports in the target environment through an authorized job after schema setup.

### Integration status

| Agency | Implemented | Requirements and limitations |
| --- | --- | --- |
| NYC Subway | Working: regular GTFS + all eight public GTFS-RT feeds + official alerts | No key required. Live predictions verified end to end. GPS positions are not invented from arrival times. Regular static schedule omits many temporary changes; fresh live updates/alerts are authoritative. |
| LIRR | Working: GTFS + public GTFS-RT | No key required. Static import and fresh feed verified. Displays vehicle coordinates only when provided. |
| Metro-North | Working: GTFS + public GTFS-RT | No key required. Port Jervis and Pascack Valley services require a separate NJ TRANSIT integration and are excluded. |
| MTA Bus | Static GTFS importer available for Manhattan; live integration not configured | Bus Time requires the operator's own authorized key. The live SIRI/GTFS-RT Bus Time adapter and additional borough configuration remain to be implemented. No key is requested or used by this build. Bus examples are demo-only unless static schedules are imported. |
| NICE Bus | Unsupported / planned | No permitted, documented current live feed verified. No production NICE estimates are invented. |
| Ferry / air | Out of scope | Future expansion only. |

Official documentation verified on 2026-10-29:

- [MTA developer resources and static downloads](https://www.mta.info/developers)
- [MTA realtime catalog](https://api.mta.info/)
- [MTA data terms](https://www.mta.info/developers/terms-and-conditions)
- [MTA Bus Time API documentation](https://bustime.mta.info/wiki/Developers/Index)
- [US Census address geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)

The allowlisted endpoints are in `artifacts/api-server/src/transit/adapters.ts`. Feeds are fetched, decoded and cached by Transtop's server; browsers never directly fetch MTA data. The adapter registry is the extension point for more cities/agencies. External IDs are namespaced by agency, with dataset mode as a separate key.

MTA data is supplied as-is. Transtop is independent and is not affiliated with, endorsed by or licensed by the MTA. No agency logos, proprietary official maps or MetroCard balance integration are included. Original generic route labels/colors are used for identification; review MTA licensing requirements before public launch.

## Arrival selection and timestamps

The server prefers fresh official predictions, then eligible community estimates for a specific trip, then published schedules, then an honest no-arrivals state. Official data older than 60 seconds, in the future, or from a failed poll is not labeled live. Each arrival includes its own source and update time. A server response timestamp is not evidence that the underlying transit observation is fresh.

GTFS trip cancellations and skipped/no-data stop updates are excluded from predictions and schedule fallback when fresh. Regular GTFS is not guaranteed to reflect short-term changes. Agency time uses `America/New_York`, calendar exceptions override weekly calendars, and the schedule conversion follows GTFS noon-minus-12-hours semantics across DST and supports times over 24:00.

Route geometry is sourced from the imported trip shape. The network map chooses one representative shape per route, so it is not an exhaustive display of all branches and directions. Subway prediction feeds do not generally include GPS positions. Rail positions are shown only when supplied by the agency; markers refresh rather than imply unobserved movement.

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
- Optional daily static imports with `TRANSIT_AUTO_IMPORT=true`; initial imports must be run with the CLI. Static import is disabled by default to avoid unexpected resource use.

Static imports stage a full generation in separate mode keys, then swap atomically. A failed import leaves the previous complete live dataset intact. The import CLI supports only registry-approved agencies and endpoints, not arbitrary user URLs.

Production should have a single poller/worker owner. Multiple independently polling instances will multiply upstream traffic; move jobs to a dedicated worker and add distributed locks/queues and shared rate limits before scaling. Database snapshots persist source observations; the runtime's prediction cache warms on its first poll.

The database schema is in `lib/db/src/schema/transit.ts`; the initial SQL migration is in `lib/db/drizzle/`. Apply development schema changes with Drizzle. Replit-managed production schema changes are applied through Publish; do not run startup-time DDL.

Before production traffic, configure a MapLibre-compatible basemap provider whose plan and terms permit your expected traffic. `VITE_MAP_STYLE_URL` defaults to the attributed CARTO dark style for review. Public/default map hosting is not an unlimited-production agreement. The list remains usable if the map fails.

The web app includes a PWA manifest and original icon. Its production service worker caches the app shell, never `/api` arrivals. Offline favorites are available locally, but arrivals require connectivity and must not be treated as current when offline.

## Code map

- `artifacts/transtop`: responsive React app, MapLibre, favorites, consent and foreground geolocation.
- `artifacts/api-server/src/transit`: adapters, GTFS importer, realtime polling, schedule fallback, estimation, ingestion and jobs.
- `lib/api-spec/openapi.yaml`: request/response contract; regenerate clients with `pnpm --filter @workspace/api-spec run codegen` after edits.
- `lib/db`: PostgreSQL/Drizzle schema and migration.

## Remaining release work

Live bus adapter and authorized key; additional borough and NICE feed verification; reliable live-trip association where static/realtime IDs differ; calibrated segment/dwell history; aggregated rider-report/crowding publication; stronger independent-contributor verification and abuse controls; multi-instance workers; production map-provider agreement; automated regression coverage for calendar/DST, stale fallback, cancellations, permission denial, expiry, ingestion races, outliers and demo/live isolation. These are documented limitations, not silently simulated features.
