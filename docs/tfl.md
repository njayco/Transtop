# Direct TfL Unified API

Transtop uses the official `https://api.tfl.gov.uk/` Unified API independently of
Transitland. No Transitland budget, import, feed license or account is needed for
direct London search, stop metadata, predictions or line status. This is not a
full UK or National Rail integration.

## Setup and access

- Save `TFL_API_KEY` in server secrets. It is already configured for this project.
  Never put it in a Vite variable, URL, source file, screenshot, fixture or log.
- A configured key enables this adapter. `TFL_ENABLED=false` disables all direct
  TfL requests, including cached responses. Missing credentials produce setup
  messages; neither condition falls back to anonymous authentication.
- [TfL developer portal](https://api-portal.tfl.gov.uk/) and
  [products](https://api-portal.tfl.gov.uk/products) document a **50 requests/minute
  anonymous baseline** and a standard **500/minute subscribed product**.
  **The saved key's specific subscription entitlement has not been independently
  verified.** HTTP 200 responses with `app_key` prove usable endpoints, not a
  500/minute entitlement. Transtop therefore reserves requests at least 3,600ms
  apart: at most 17 per database in any rolling minute. Development and the
  published app each reserve half of a 34/minute total, staying below the public
  baseline even when they use separate databases and share the saved key.
  The server always sends the saved key. Do not raise this ceiling without
  account-specific verification and owner approval.
- No paid service, quota upgrade or additional agreement was purchased or
  accepted. Owner registration/ongoing compliance with the
  [Transport Data Service licence](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service)
  remains a prerequisite. Recheck terms before expanding to another dataset.

## Actual coverage checked

Authenticated checks on **2026-10-30, 23:42–23:43 UTC (GMT in London)** returned:

| Mode | Representative point | Fresh normalized predictions |
| --- | --- | --- |
| Bus | `490000173RC`, Oxford Circus Station | 5 |
| Underground | `940GZZLUWRR`, Warren Street, Victoria | 6 |
| DLR | `940GZZDLMUD`, Mudchute | 3 |
| Elizabeth line | `910GHTRWAPT`, Heathrow Terminals 2 & 3 | 3 |
| Overground | `910GSACTON`, South Acton, Mildmay | 2 |

Counts describe those checks, not guaranteed continuous coverage. Every mode can
return empty or stale data, particularly after hours. Other Overground lines are
discovered from the current TfL catalogue, not assumed to have predictions at
every station. No claim is made that every National Rail operator, tram, ferry,
airport or UK stop is covered. Current catalogue names included Liberty, Lioness,
Mildmay, Suffragette, Weaver and Windrush. Their names/IDs are **not hardcoded** in
the adapter.

Oxford Circus station search returned 9 boarding/station results. Victoria's
inbound route sequence supplied 16 stops and 16 geometry points; zero vehicle
positions were generated. A line's source geometry is a route pattern, not GPS.
One supplied pattern is shown; other branches may exist. Missing geometry and
pattern failures are disclosed, never connected with invented straight lines.

## Request and freshness boundaries

- Only allowlisted API paths, known query names and bounded identifiers are sent
  to the fixed HTTPS origin. Redirects are rejected. `app_key` is header-only;
  response echoes are scrubbed before caching; user-facing errors are fixed text.
- Requests have a 10-second network timeout and a 4MB streamed response limit.
  Unsuccessful requests never retry anonymously. 401/403, 429 and outages back
  off; Retry-After is honored within a bounded 30-second–15-minute range.
- PostgreSQL cache and expiring request leases deduplicate across server replicas sharing
  this database. An in-flight map deduplicates within one process. An atomic
  request reservation coordinates the key across those processes and restarts;
  the same key used by another application/database is **not** coordinated.
- Cache: catalogue/stop/pattern metadata 24h; area metadata 1h; station searches
  1h; line status 60s; predictions 20s. Cache entries are pruned to 500 keys.
  During failures, expired slow-changing metadata may be retained for at most
  seven days with an explicit stale/error notice, so a working map is not
  cleared. Expired predictions and status records never receive this fallback.
  Source settings do not make any upstream health calls. Last-success reflects
  the source request time, not proof that predictions are fresh.
- Station search takes at most 12 upstream matches in one stop-metadata batch.
  Area discovery uses one page within 1.5km of a quantized center; maps require
  zoom 13+, a viewport no wider than .12° longitude / .08° latitude and a
  southeast England bounding box. Output is at most 80 matched stops (nearby
  UI shows its existing 16 nearest). Partial results are labeled. Narrow the
  map or search a station for other points; no citywide pagination/poll occurs.
- Nearby/map cards do not fetch predictions. A stop detail requests that stop's
  arrivals plus one batched status request for at most 30 lines. Route details
  enrich only their first supplied stop, never every stop; other stops have
  explicit arrival links. TfL pages do not consume/follow Transitland cursors.
- Require upstream `timestamp`, `expectedArrival`, and `timeToLive` with explicit
  offsets. Reject observations older than 90s or more than 30s in the future,
  past arrivals, invalid/expired TTL, unsupported lines and missing destinations.
  Expiry is the earliest of source TTL, observation + 90s and expected arrival.
  Retrieval time never renews prediction freshness. UI drops expired TfL records
  even offline; there is **no synthetic schedule fallback**.
- All times are absolute ISO instants displayed in `Europe/London`, including
  GMT/BST transitions. Platform and direction stay distinct in prediction IDs.
  Service-status validity is checked separately; notices never become arrivals,
  cancellations or a declaration that service has stopped.

## Identities and coexistence

Stable links use `tfl:stop:<NaPTAN>` and `tfl:line:<current-line-id>`.
Provider filters use TfL bus, Underground and rail subsets in the existing UI.
An exact bus lookup can return a parent cluster: Transtop locates the requested
NaPTAN in the supplied child tree, never substituting a cluster centroid or sibling.

Cross-source precedence is deliberately conservative. A boarding-point match
requires an exact NaPTAN ID, coordinates within 25m, no conflicting explicit
platform, and matching **current official line ID and mode**. Only that verified
stop/line pair is preferred. Names, station proximity, operator branding and
numeric route labels alone cannot suppress worldwide results. Unmatched lines,
platforms, operators and non-identical GTFS identifiers remain separate. Legacy
Transitland stop links resolve to direct data only after verification, otherwise
retain their original licensed source. Line-card aliases are scoped to a single
result and are allowed only when every returned worldwide boarding point on that
line is verified. They never enter source-level discovery filters or persist
between searches. Saved worldwide route links always resolve through Transitland,
including after TfL is disabled or unavailable. Existing American provider
precedence is unchanged. Regression fixtures cover a second unmatched point and
a separate platform on the same feed/route, plus saved-route dispatch before and
after disabling TfL.

## Attribution and reuse

The UI retains Transtop's design and displays:

- **Powered by TfL Open Data**
- **Data provided by Transport for London**
- **Contains public sector information licensed under the Open Government
  Licence v3.0**, including NaPTAN stops; TfL rail information may contain National
  Rail Darwin / Knowledgebase data.
- Links to the [TfL licence](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service)
  and [underlying data sources](https://tfl.gov.uk/corporate/data-sources).

TfL's licence is an amended OGL-based licence, not an assertion that all TfL data
is unconditionally OGL v3. Information is provided without warranty; accuracy and
continuous availability are not guaranteed. Do not misrepresent the information,
its source or endorsement. No roundel, TfL logo, proprietary font or TfL branded
interface is adopted. This adapter does not redistribute bulk archives.

## Checks

```sh
pnpm --filter @workspace/api-server test:tfl
# Explicit bounded live diagnostic, requires the server secret and existing DB:
pnpm --filter @workspace/api-server check:tfl-live
```

Fixtures cover namespaced identities, exact boarding-point/line precedence,
platform/direction separation, upstream expiry and invalid timestamps, GMT/BST,
geographic bounds, separate status validity, missing/disabled credentials,
cache/in-flight deduplication, credential redaction, denied access, quota, outage,
response limits and recovery. Live diagnostics print normalized counts and
public transit identities only, never credentials or raw request errors.

Verification also passed repository typechecks, the frontend production build,
59 existing backend regression tests, 40 frontend tests and the Transitland
fixture suites. A desktop/phone browser pass confirmed the London map, filters,
Underground stop/route navigation, credits and settings. It exposed a bus cluster
lookup mismatch; after fixing exact-child resolution, a targeted running API
check for `490013767X` returned HTTP 200 and three fresh platform-labeled
predictions. That fix was confirmed by the API and an isolated regression,
not a second full browser run. Existing unrelated GTFS cleanup timeout warnings
remain outside this adapter's scope.
