# Amtrak integration: access prerequisite

Status: the owner approved Amtraker for tracking on October 30, 2026.
National agency 51 rail schedules use the official shared GTFS archive; tracking
uses Amtraker's offered API rather than direct Amtrak collection/decryption.
Shore Line East remains independently selected as agency 1230.

## Original direct-source assessment

Amtrak's [Web Notices & Site Terms of Use](https://www.amtrak.com/planning-booking/policies/web-notices-terms-of-use.html)
(page dated March 5, 2025) state:

- Under **Materials, Ownership and Restrictions on Use**, reproduction,
  republication, transmission and distribution of site materials require prior
  written permission.
- Under **Code of Conduct**, automatic retrieval and data-mining processes are
  restricted.

These site terms were not treated as authorization to retrieve/decrypt the
undocumented tracking endpoint. A successful HTTP response, another application's
use of the feed and the GTFS format itself are not a standalone license.

The original direct-tracking plan was not enabled. The owner instead approved
Amtraker's explicitly offered API, described below. Published factual timetables
are kept separate from tracking; §701.1 is the owner's supplied basis for their
routine public availability, not a claim of blanket licensing for other Amtrak
site content. No reservation/booking data or protected Amtrak site presentation
is copied. Do not route around denials or substitute an unrelated data source.

The [Transitland feed catalog](https://www.transit.land/feeds/f-9-amtrak~amtrakcalifornia~amtrakcharteredvehicle)
identifies the current official shared archive as
`https://content.amtrak.com/content/gtfs/GTFS.zip`. Its catalog entry and existing
Connecticut-specific source approval are not independent Amtrak license grants.
Amtrak does not advertise a separate feed-specific license here; keep that access
limitation visible and revisit the source if Amtrak publishes conditions, changes
access or requests discontinuation. The integration does not promise unrestricted
rights to Amtrak materials beyond the factual published schedule scope.

## Public-records regulation

The user supplied [49 CFR Part 701](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-VII/part-701),
reviewed October 30, 2026. Section 701.1 expressly says routinely provided
information, including train timetables, may be obtained from Amtrak's website
without using its FOIA procedures. Sections 701.3 and 701.4 address public
availability and inspection of records. Section 701.3(d) limits the FOIA
procedures to existing records and does not require future records to be provided.

This supports access to public timetables; it should not be described as a
prohibition on using timetable facts. However, the regulation does not expressly
authorize recurring polling of the undocumented tracking endpoint, decryption
of its responses, or unrestricted redistribution of all site materials. Do not
treat FOIA disclosure, copyright in materials, reuse of facts and automated
endpoint access as the same question. The later provider choice resolves the
tracking path for this integration without making such a claim about Amtrak's
own undocumented endpoint. The published timetable scope and absence of an
advertised feed-specific bulk license remain explicitly distinguished above.

## Uploaded software review

The supplied July 2024 `@mgwalker/amtrak-api` archive declares `ISC` in
`package.json`. It does not contain a standalone LICENSE file. Before copying
code, verify and retain the author's applicable copyright and ISC permission
notice; do not invent copyright details. Software licensing and upstream
data-use permission are separate.

The reader uses Amtrak's undocumented encrypted map responses, not a full
published timetable. Its mapper drops GeoJSON geometry and does not expose an
observation timestamp in the normalized train object. Its tests use mocked
responses, not evidence of the current upstream contract or permission.

The supplied date helper and its tests explicitly default unknown timezone
characters to Eastern time. That behavior is unsuitable for national service.
The train mapper also mutates source properties and assumes station JSON parses
successfully. A future adapter must preserve geometry, validate report timestamps,
use station timezone metadata, isolate malformed records, preserve distinct
scheduled/estimated/actual calls and avoid inferring live movement.

Current tracking payloads have not been fetched or decrypted during this review
because the access prerequisite is unresolved. Once authorization is established,
validate the current upstream contract before implementation; the uploaded
fixtures cannot establish current geometry, timestamps or station metadata.

## Amtraker alternative

The user supplied Amtraker as an alternative source. Its
[About page](https://amtraker.com/about) explicitly offers free API data use
subject to avoiding excessive requests. Its
[API documentation](https://github.com/piemadd/amtrak#attributionlicensing)
states that API data is licensed under ODC-By 1.0 and requires a project-identifying
User-Agent. The documentation calls for prominent app attribution, map attribution,
and attribution in distributed API/database documentation. Do not hide the
credit solely in settings.

This offers a provider-documented route to third-party tracking data; it is not
evidence that Amtrak granted direct endpoint access. The owner approved switching
to it instead of the original direct-source plan. Do not
install or copy its separately licensed library merely to consume JSON endpoints.

The documented `/v3/stations/:stationId` response is station metadata with train
IDs, not a full published station timetable. The tracking snapshot must not
replace date-selectable GTFS schedules. Validate provider identifiers, per-train
observation timestamps, station-call semantics and current response structure
before deciding which fields can safely be exposed as live.

## Operating the approved integration

Use the integration in existing Transtop experiences, not a standalone app.
Restrict national schedules to verified agency
51 rail services and referenced records, retaining the independent agency 1230
Shore Line East selection. Do not assume agency ownership alone excludes buses
or establishes coverage for shared-operator routes.

Initial schedules can be imported with:

```sh
pnpm --filter @workspace/api-server run import-gtfs amtrak
```

The existing opt-in `TRANSIT_AUTO_IMPORT=true` lifecycle refreshes the same
staged, atomically published dataset. No schema replacement is needed. A failed
import retains the previous complete generation; a cleanup timeout is a
maintenance warning, not a failed publication.

Tracking checks run every 60 seconds, with one in-flight poll and a cross-process
advisory lock. Shared cached retry deadlines prevent alternating workers from
over-polling. Failures back off from two minutes to fifteen minutes and immediately
withhold cached reports as live. Only the allowlisted `/v3/trains` and
`/v3/stations` endpoints are fetched, server-side, with a project-identifying
User-Agent, 15-second timeout, no redirects and a 10 MiB per-response limit.
Browser requests read cached observations, never trigger upstream retrieval.

Per-train freshness is five minutes from `lastValTS`, allowing at most 30 seconds
of future clock skew. Provider update, fetch and database write timestamps never
stand in for that timestamp. Predeparture, completed, canceled, all-departed,
missing-coordinate or stale reports do not become moving markers. Source health
reports fresh/unresolved counts, poll time, source report time and errors.

Matching requires a unique published trip with the same service day, train number,
verified route name/alias and ordered station codes with scheduled times within
one minute. Calendar exceptions are honored. Unmatched observations can expose
clearly unresolved details but never replace scheduled departures or receive a
guessed route. Multiple observations for one dated trip retain schedule fallback.

Timetable Date and From refer to the GTFS agency service-day clock
(America/New_York), not each station's civil date. Every Amtrak departure displays
the station's local date/time/timezone, including preceding dates in the West and
later dates on multi-day runs. GTFS instants use noon minus twelve elapsed hours,
not civil midnight; upcoming-departure lookback derives from the selected trips'
maximum elapsed stop time. Unknown observed station timezones are not guessed.

Amtraker's unvisited-station `arr`/`dep` values are treated as estimates;
`Departed` supplies actual arrival/departure, and `Station` supplies actual arrival
with estimated departure. Missing or unknown semantics retain scheduled fallback.
Only explicit fresh cancellations/skipped stops/actual departures suppress a
matched dated schedule.

Attribution: train reports from [Amtraker](https://amtraker.com), upstream Amtrak
observations, licensed under [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/).
Amtraker and Transtop are unofficial and not endorsed by Amtrak. Provider/API
coverage and uninterrupted access are not guaranteed. This implementation consumes
the JSON API and does not copy the AGPL library or the uploaded ISC code.

Coverage intentionally excludes Thruway buses, charter operators, MARC, VIA-only
service and Shore Line East. Shared-operator portions, such as the VIA-owned
Maple Leaf route portion, are not imported under agency 51. No claim is made
that every Amtrak-branded connecting service or active train is covered.
