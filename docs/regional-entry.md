# Regional entry screens

The entrance is part of Transtop, not a new app or a transit-coverage change.
US visitors retain the original MetroCard artwork, five icons and right-to-left
interaction. `GB`, `FR` and `JP` choose London, Paris and Tokyo respectively.
All other/unknown countries use the US entry. Only this entrance is localized.

## Interaction and session behavior

Every version uses the same pointer/keyboard gesture model. Drag the independent
card **right to left** and release after at least 85% of its travel; an incomplete
or cancelled drag resets. Left Arrow advances 10%, Right Arrow moves back and
Home resets; keyboard entry completes at 100%. Completion is latched once and
pending completion timers are cleared on unmount. Resize/orientation changes
reset incomplete gestures. Reduced motion removes decoration and transition
motion, not the interaction. On short screens content can scroll.

`transtop.entry.v2` still records entry in tab-session storage. The selected
variant is also held for the tab session (`transtop.entry.region`), including a
timeout/default selection. Settings → **Replay the entry screen** clears only
the entry flag, reuses the selected version and retains the current URL.
No skip or automatic entry was introduced. The post-entry route tree does not
mount or fetch transit data until entry. A reload after earlier entry does not
make a country lookup unless the user replays with no region yet saved.

## Private country processing

`GET /api/entry/country` accepts **no location inputs** and returns exactly
`{"country":"US"}`, `"GB"`, `"FR"`, `"JP"` or `null`. Other country values are
withheld rather than sent to the browser. Neither IP query parameters nor
client-provided country/GeoIP/real-IP headers select a country.

The server reads a local DB-IP Lite MMDB. There are no visitor-time external
geolocation requests, IP caches, IP analytics or stored IP records. The
existing request logger serializes only request ID, method and path, not
addresses/headers/query strings. Exceptions from the lookup are swallowed
without logging their possibly sensitive message. Infrastructure access logs
outside Transtop are not controlled by this feature.

Every response is `private, no-store, max-age=0`, with `CDN-Cache-Control:
no-store`, `Surrogate-Control: no-store`, `Pragma: no-cache`, `Expires: 0` and
`Vary: *`; it cannot be reused across visitors. The server deadline is 200ms;
the client bounds the entire fetch **and JSON parsing** to 900ms, aborts obsolete
requests and ignores late results. A brief blank black resolving state precedes
one stable version. Offline, timeout, missing/corrupt data, unsupported countries,
nonpublic IPs and unexpected ingress all use the US screen without blocking
the swipe.

This is approximate styling, not reliable physical location. VPNs, carrier
networks, satellite connections and database inaccuracies can choose a different
country. Browser language, timezone and GPS are not used. Entry never asks for
GPS permission. Only the selected styling identifier is saved in tab storage.

## Proxy trust — verified before implementation

**Development ingress observed on October 31, 2026** through this workspace's
actual HTTPS development domain and local shared proxy, using a temporary
address-free structural probe that was removed:

| Path | Socket | X-Forwarded-For structure |
| --- | --- | --- |
| Local shared proxy | loopback | loopback |
| Local proxy with forged XFF | loopback | supplied entries, appended loopback |
| HTTPS development ingress | loopback | client, private ingress, loopback |
| HTTPS with forged XFF / X-Real-IP / Forwarded | loopback | same overwritten three-address chain; forged sentinel absent |

The shell's client in the HTTPS probe was private, so correctly resolved unknown.
Only booleans, counts and address **classes** were observed; visitor addresses
were not recorded or logged by the probe.

Express's existing `trust proxy = 1` resolves to the final loopback hop on this
path. It is intentionally **unchanged**: other IP-dependent features are out of
scope. Entry uses its own strict resolver:

* For an actual public directly connected socket, use the socket only and ignore
  all forwarding headers.
* For a loopback socket, require **exactly three** XFF entries: client, private
  ingress, loopback. This relies on the tested public edge overwriting XFF.
  Unexpected counts, malformed entries or other proxy classes fail closed.
* Private sockets not matching this profile are not trusted.
* Client addresses must normalize to globally routable unicast; private,
  loopback, link-local, carrier NAT, multicast, documentation, reserved and IPv6
  transition ranges are excluded. IPv4-mapped IPv6 is normalized before filtering.
  Ports, zones, brackets, abbreviated IPv4 and octal representations are rejected.

This is **not a universal Replit proxy guarantee**. Published ingress was not
probed or changed, and no deployment was performed for this work. Before
approving a production release, verify its edge overwrites XFF and matches this
profile using the same address-free structural checks. If infrastructure differs,
keep the default instead of weakening the rule or trusting a numeric hop count
alone. Private processes with control of the workspace can synthesize request
fixtures; browser clients cannot choose a theme by forging country headers.
Reverify the profile after hosting/proxy changes.

## Database redistribution and packaging

Source: [DB-IP IP to Country Lite](https://db-ip.com/db/lite.php), October 2026.
License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
DB-IP expressly permits use and redistribution with attribution; no signup,
paid subscription or new contractual agreement is required.

The unmodified gzip snapshot URL and SHA-256 are pinned in
`artifacts/api-server/scripts/prepare-country-database.mjs`. Build-time download
has a 30-second timeout, 8MB compressed/32MB uncompressed limit and checksum
verification. A verified cache under root `node_modules/.cache/transtop-geo`
avoids repeated downloads. `build.mjs` packages the MMDB, source manifest and
attribution notice into API `dist/geo` after cleaning the build output.
There are no large binary additions to Git, no browser database download and
no startup/visitor-time download. Runtime starts with unknown if packaging is
unavailable; server startup and entry never require internet geolocation.

The entry footer (including the default) links **IP Geolocation by DB-IP** and
CC BY 4.0; Settings repeats the credit. The packaged notice is
`artifacts/api-server/licenses/DB-IP-Lite.txt`. The underlying DB is unmodified;
Transtop restricts its *output* to styling countries. Lite offers reduced
coverage/accuracy and upstream monthly updates, not a guarantee of correctness.

### Monthly update process

1. Obtain the new month's **free country Lite** snapshot from DB-IP's official
   download page. Do not substitute their paid database or a source with
   different redistribution terms.
2. Download to ignored `node_modules/.cache/transtop-geo`, compute SHA-256
   (`sha256sum`), and review source/license/date before changing the pinned
   month, URL, digest and notice. Do not change the digest merely to suppress
   an unexplained integrity error.
3. Run `pnpm --filter @workspace/api-server run build` to verify the digest,
   package the new file and retain its source/attribution beside it.
4. Run `pnpm --filter @workspace/api-server run test:entry-country` and workspace
   typecheck. Review geographic fixtures against that snapshot, not assumptions
   about globally anycast DNS addresses. Missing or unsupported records remain
   unknown; do not replace them with invented country guesses.
5. Review/merge the normal code change. Publication still requires owner approval.
   A failed download or integrity mismatch uses default styling, never an
   unverified replacement.

## Artwork and accuracy

Regional SVG routes, station dots, cards, badges, landmarks and text are separate
responsive DOM/SVG layers inspired by the three owner-supplied posters:
`Neon_London_Transit_Splash_Screen_1793411149844.png`,
`Neon_Paris_Transit_Map_Splash_Screen_1793411149846.png` and
`Tokyo_Transit_Neon_Map_Poster_1793411149846.png`.
They are not flattened poster backgrounds or official geographic maps.
Lucide icons retain their existing package license; the new SVG compositions
and fictional card labels are original, not issuer-supplied ticket products.

The US raster artwork is unchanged. Oyster-/Navigo-/Suica-inspired cards are
visual entrance controls only, with no fare, balance, payment or ticketing
functionality. Existing historic agency imagery and regional motifs do not
establish affiliation/endorsement or grant new branding permissions. Review
branding rights before public launch. Footer agency names and air/ferry badges
are illustrative and do not promise implemented transport coverage.

## Deterministic preview — no VPN required

The shipped app has **no country query parameter or header override**.

For a local visual preview in browser developer tools on this app's origin:

```js
sessionStorage.removeItem('transtop.entry.v2');
sessionStorage.setItem('transtop.entry.region', 'paris'); // us, london, paris, tokyo
location.reload();
```

This overrides only this browser tab's saved presentation, not server detection.
To test normal detection again, remove both keys and reload. Do not use
`localStorage.clear()`, which would delete unrelated favorites/preferences.

Automated tests intercept `/api/entry/country` with deterministic countries and
failure/late responses. They need no VPN, live transit feeds, API keys or database:

```sh
pnpm --filter @workspace/api-server run prepare:entry-country
pnpm --filter @workspace/api-server run test:entry-country
pnpm --filter @workspace/transtop test
pnpm --filter @workspace/transtop test:browser
pnpm run typecheck
```

`tests/browser/entry.spec.ts` covers all versions, deep-link query/hash preservation,
partial/cancelled slides, resize, mouse, browser-generated touch, keyboard,
replay/session persistence, timeout/late result, failure, reduced motion,
320px mobile, desktop and short landscape. Reference screenshots are generated
under ignored `generated-artifacts/transtop-browser/`; the runner also executes
the existing alert and favorites regressions. Backend checks cover ingress,
IPv4/IPv6, unsupported/private inputs, failed/missing data, bounded response,
cache headers and country-only output.

Final 390px mobile and 1440px desktop references for all four variants are saved
separately in `generated-artifacts/entry-reference/`, so targeted test runs do
not clear them with the runner's disposable output directory.

The managed preview and disposable browser-test Vite server use separate
per-port dependency caches. Their plugin/configuration differences must not
invalidate each other's optimized-module URLs and cause preview HTTP 504s.
