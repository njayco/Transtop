# Transtop

A mobile-first NYC and Long Island transit app using real agency, scheduled and community data only, with nearby arrivals, maps, local favorites, and opt-in rider contributions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/transtop` — responsive frontend.
- `artifacts/api-server/src/transit` — official adapters, import/poll jobs, arrival rules and private ingestion.
- `lib/db/src/schema/transit.ts` — Drizzle schema.
- `lib/api-spec/openapi.yaml` — API contract; regenerate after changes.
- `README.md` — verified sources, setup, privacy, deployment constraints and limitations.

## Architecture decisions

- Feed availability is not authorization; verify official docs and terms before extending coverage.
- Official predictions are authoritative only when fresh. No demo substitutions in live mode.
- One always-running poller owner is required; multi-instance distributed jobs are not yet configured.

## Product

Nearby, Search, Stop/Route details, Favorites, Ride, Settings; NYC Subway, LIRR and Metro-North imports/live polling are implemented. Live bus integration awaits an authorized key and adapter; NICE is planned only.

## User preferences

- Preserve the user's original Transtop black background, large white typography and angular multicolored transit identity; do not reproduce the HTC frame.
- Focus on buses and trains, no unauthorized MetroCard balance, ferry/air are future only.
- The entry homepage must recreate the user's original Transtop artwork on mobile and desktop, including its five transport icons and MetroCard swipe. Require a right-to-left swipe (or keyboard equivalent) before entering; no skip button or automatic entry.

## Gotchas

- Read README limitations before claiming production readiness or complete agency coverage.
- The rider app is Live-only; backend demo compatibility is retained for development/testing. Never expose raw contributions.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
