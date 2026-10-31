# City-aware Transtop welcome screens

The welcome screen now has the ten supplied regional designs: San Francisco,
Philadelphia, Dallas, Miami, Atlanta, Detroit, New Jersey, Cincinnati, Chicago
and Los Angeles. New York retains its existing design. Connecticut has a new
original regional design, as requested. New Jersey and Connecticut apply
statewide; the other automatic US matches use a matching database city **and**
state, not a broad metro radius. Unmatched visitors get the default farebox.
London, Paris and Tokyo remain available as manual-only choices.

## Interaction and presentation

- Mobile and desktop use responsive HTML/SVG overlays, neon maps and optimized
  skyline crops from the supplied artwork. City and transit labels are real text.
- Regional cards swipe left to enter the existing app. The default uses a
  stylized transit dollar sliding horizontally into a bus farebox. This is an
  entry interaction, not a fare payment; nothing is charged.
- Pointer capture, release threshold, keyboard controls, incremental tap controls,
  reduced motion, entry completion analytics, tab-session entry and replay remain.
- A native city selector includes Automatic and every available design.
  An explicit tab-session selection overrides detection and cannot be overwritten
  by a late lookup. The selected welcome design does not change saved services,
  chosen transit locations or claim a provider is supported.
- Default screens print the approximate city when available. A curated operator
  label is used only for a known city/state match; unknown operators are honestly
  labeled Local transit, never invented.
- Public transit information remains available without swiping, JavaScript,
  session storage or special bot treatment.

## Approximate location, not proof of city limits

IP geolocation **cannot establish that a visitor is physically inside municipal
boundaries**. Mobile networks, VPNs, privacy relays, carrier routing and database
errors may identify a different place. The design selection uses DB-IP Lite's
approximate city/region label, not GPS or an exact city-boundary assertion.
Manual selection is always available. Unknown or untrusted ingress uses the
default, not a guessed location.

`GET /api/entry/location` accepts no location parameters. It returns only country,
city, region, theme, an optional curated operator label, approximate/unknown
accuracy, match category and attribution source. It never returns visitor IP or
coordinates. Responses are private/no-store across browser, CDN and surrogate
caches and have a 350ms lookup budget. The frontend has a 1.2-second abortable
budget and safe default. The old `/api/entry/country` remains backward-compatible.

The existing strict ingress resolver is reused unchanged. Arbitrary country,
city and forwarding headers are not authoritative. See
[regional-entry.md](regional-entry.md) for the verified development ingress
profile and the **separate production-ingress verification prerequisite**.
Do not loosen proxy trust merely to obtain a city match.

## Local database and distribution

The server uses [DB-IP IP to City Lite](https://db-ip.com/db/download/ip-to-city-lite),
October 2026, under CC BY 4.0. Attribution and the license link remain in the
welcome privacy disclosure and Settings. No signup or paid geolocation API is
used, and no visitor address is sent to a lookup vendor. Raw visitor IPs are not
cached, persisted or included in location responses; lookup failures are not
logged with their exception/address text. The browser retains sanitized detected
city/theme metadata and explicit theme choice in session storage only, never IP.

The build downloads the fixed snapshot once into the ignored node_modules cache,
streams decompression with fixed size limits, verifies DB-IP's published SHA-1
against the **uncompressed MMDB**, and packages the database under `dist/geo`.
The archive is approximately 60 MB and the runtime database approximately 127 MB.
Neither is added to Git. The database adds roughly that much buffer memory in the
API process, so account for it when sizing production resources. All lookups are
local; no per-visitor network call occurs.

An unavailable or failed-integrity database is not a build/startup outage:
automatic selection falls back to the generic farebox while manual themes work.
Updating the pinned month requires re-verifying the official checksum, source
license, download limits and attribution. The older country database stays
separate for compatibility.

## Checks

```sh
node artifacts/api-server/scripts/prepare-city-database.mjs
pnpm --filter @workspace/api-server exec tsx --test tests/entry-location.ts tests/entry-country.ts
pnpm --filter @workspace/transtop exec node --test tests/entry-location.test.mjs tests/entry-country.test.mjs
```

Canvas comparisons use source-derived copies of the real components with visibly
marked preview fixture data. Those fixtures do not implement fake production IP
selection or charge a fare.
