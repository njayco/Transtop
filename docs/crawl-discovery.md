# Public URL discovery and HTTP responses

Transtop's web service uses a route-aware Node server, not a static wildcard
rewrite. Its build produces both Vite assets in `dist/public` and a standalone
read-only web-server bundle in `dist/server`, including its logging workers and
runtime dependencies. The build uses the API package's build tools and shared
source, but does not require or modify the API artifact's `dist` directory.
The API artifact separately builds its own server and poll jobs. Do not start
transit jobs in the web process.

## Canonical origin and paths

`artifacts/transtop/public-origin.json` contains the primary origin verified from
the deployment service: `https://transtop.app`. Do not derive it from request
Host/forwarded headers or development domains. When the primary domain changes,
verify the new deployment URL, update that file and the public robots fallback.
This change does not publish anything.

The web server emits an absolute canonical on home, search and existing public
stop, route and train pages. Entity IDs use one URL-encoded path segment.
Alternate encodings and resolved authoritative aliases redirect permanently to
that path; query parameters do not enter the canonical. Client-side navigation
updates the declaration after validating detail-page existence through the API.
Favorites, Ride and Settings remain working application URLs but are noindex,
have no canonical and never appear in discovery.

Unknown routes and missing entities return HTTP 404 and a standalone accessible
error document, without loading the entry gate over it. A failed lookup returns
503 with Retry-After, not a false 404. Existing static assets are served normally.

## Sitemap

`/sitemap.xml` is a sitemap index, backed by the current database's live-mode
public stop/route catalog and reviewed intercity catalog. `/sitemaps/N.xml`
contains at most 10,000 URLs. The catalog is sorted, de-duplicated and cached for
five minutes. The index and parts share the same cache; imports become discoverable
after cache expiry, without a web rebuild. Robots references the absolute index.

No external search is performed to invent or enumerate remote feed identities.
Demo data, retired research IDs, disabled ODPT/IDFM coverage, nonboarding points,
personal state and short-lived dated train runs are excluded. Existing train
links still validate and get their own canonical. The web process reads observed
train identities from the API poller's persisted snapshot, not its own empty
in-memory tracking state. Snapshot-derived fallback text makes no live prediction.

Source-visible fallback text identifies each public entity. Full public content
rendering and entry-gate behavior are maintained separately; discovery metadata
alone is not a replacement for that rendering work.

## Checks

`pnpm --filter @workspace/api-server run test:public-web` checks HTTP status,
canonical normalization, host-header isolation, personal-page exclusions,
lookup failure behavior, XML limits and escaping, catalog eligibility and
cross-process observed-train resolution without live providers or credentials.

Restart the managed `artifacts/transtop: web` workflow to use the same page
handler with Vite in development. Production runs the compiled web entry with
the built Vite directory and no development server.
