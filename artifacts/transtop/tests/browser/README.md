# Transtop browser regressions

From the workspace root:

```sh
pnpm --filter @workspace/transtop exec playwright install chromium
pnpm --filter @workspace/transtop test:browser
```

On systems with a preinstalled Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of installing a
browser. Browser system libraries must also be installed (standard Linux CI can
use `playwright install --with-deps chromium`; Replit uses its supplied browser).

The runner starts and stops a separate Vite frontend on port 4179. No API server,
database, transit credentials or live providers are required. All API calls are
intercepted; unexpected API calls fail the suite, and external HTTP requests are
blocked. Each test gets a fresh browser context and real localStorage. Preferences
are seeded only once, so reload assertions cannot be satisfied by reseeding.

Coverage: available/renamed, unavailable and uncertain source responses;
reload persistence; real browser online/offline events; failed HTTP and network
refreshes after unavailable results; mixed stop/route pagination past twenty;
explicit removal, hidden retired records, and the hidden-only empty state.

Failure traces and screenshots go under
`generated-artifacts/transtop-browser/` (ignored by Git and publishing).
The existing `pnpm --filter @workspace/transtop test` focused checks remain separate.

## Regional entry fixtures

`entry.spec.ts` intercepts the same-origin country endpoint with US/GB/FR/JP,
unsupported countries, failures and delayed responses. It exercises entry with
keyboard, mouse and browser-generated touch, partial/cancelled drags, resizing,
session/replay, deep-link query/hash preservation and reduced motion. Mobile,
desktop and short-landscape screenshots go into the ignored output directory.
No VPN or production override is needed. For manual tab-only preview instructions
and server privacy/ingress/database checks, see `docs/regional-entry.md`.
