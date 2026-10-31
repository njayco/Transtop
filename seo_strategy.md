# SEO Strategy

## In scope
- Transtop public entry page, nearby/search experience, public stop, route and train detail pages.
- Source-detectable WCAG 2.2 A/AA issues in the public rider experience.

## Out of scope
- API endpoints as search landing pages, ingestion/admin tools, disposable mockup sandbox, tests and generated research archives.
- Personal favorites, ride state and settings are not organic-search landing pages, but shared public components remain in scope.

## Target audience and topics
- Transit riders finding bus/train schedules, routes, stops, maps, alerts and available live arrivals.
- Coverage spans NYC/Long Island and additional supported regional networks; provider availability varies. Avoid claiming universal live coverage.

## Rendering and crawler assumptions
- Vite/React client-rendered application with Wouter routing. Public informational content should be findable and shareable by search, social and AI retrieval crawlers.
- Deployment origin is canonical; do not invent a production domain.
- Entry artwork and a deliberate swipe or keyboard equivalent are explicit user requirements. Do not recommend removing that interaction; server-rendered public information can coexist with it.

## Dismissed categories
- None recorded.
