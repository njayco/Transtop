---
name: Intercity source trust
description: Why legacy feed calendars and national bus atlases cannot establish current departures.
---

Do not treat a distant GTFS calendar end date as proof that an intercity feed is current. Check publication history, HTTP modification dates, official carrier pages, and exceptions.

**Why:** Research on 2026-10-30 found NYSDOT Trailways archives last modified in 2021 and 2024 with calendars extending into 2030–2033. Those dates would incorrectly make years-old schedules look current.

**How to apply:** Keep these archives out of current departure results until independently revalidated. A failed current source must not cause an old calendar to be shifted or silently accepted.

The BTS Intercity Bus Atlas is not a source of timetables for this app.

**Why:** Its underlying GTFS is confidential; its published GIS data is CC-BY-NC, and its usage terms discourage near-real-time planning, scheduling and navigation.

**How to apply:** Find an authorized carrier feed or validate public factual timetable information instead. Do not infer departures or road paths from atlas route lines.

Do not confuse the University of Illinois Intercity Bus GTFS (IBG) project with the BTS atlas. IBG publishes downloadable GTFS schedules and GeoJSON, but remains a research snapshot rather than a realtime service.

**Why:** The Findings article and UTEL-UIUC/intercity-bus-gtfs repository reviewed on October 30, 2026 include mostly 2025 source records and some January 2026 records. Their documented processing removes one-day services and can adjust stop coordinates, timezones and geometry; these choices need checking against actual archive contents before rider-facing use.

**How to apply:** Use IBG to discover carriers and upstream sources, then revalidate current departures, precise boarding points and holiday exceptions separately. Establish dataset/carrier reuse terms rather than assuming the article's license automatically covers all source data.

When adding IBG to the app, keep it a labeled research-reference source isolated from current predictions. Newer verified Martz and Trans-Bridge records take precedence in primary browsing.

**Why:** The actual archive contains calendars spanning 2010–2035 despite much older collection dates, and its processing can alter timezones, one-day service and geometry. Import time cannot establish source freshness.

**How to apply:** Preserve historical dates and source attribution; do not shift encoded schedules into today or create moving vehicles. Revalidation is required before any subset becomes a current timetable source.

Research-reference labeling does not make a stop suitable for nearby rider results.

**Why:** The regional audit found a State College airport name attached to a Newark-area coordinate in IBG, far beyond its documented snapping tolerance. Same-name points can also have a correct location elsewhere.

**How to apply:** Quarantine contradictory name/location records for carrier verification; do not silently relocate every same-name stop or call a geographical screen verified coverage.

Peter Pan's website is not an authorized default scraping source.

**Why:** Its general terms reviewed on October 30, 2026 expressly restrict automated extraction and redistribution without consent; the article's license does not resolve those upstream terms.

**How to apply:** Recheck https://peterpanbus.com/general-terms-of-service/ and obtain applicable authorization before a current integration. An official route listing establishes neither departure clocks nor bulk reuse rights.

For printed timetables, omit ambiguous footnotes, continuation destinations, uncertain boarding locations and unverified holiday overrides rather than guessing.

**Why:** Official Martz pages contain special trips, downtown continuation notes, weekday boarding relocations and a Sunday overnight meridiem inconsistency. A generic route pattern would give riders the wrong remaining stops.

**How to apply:** Normalize actual trip-specific timepoints, preserve the service day across midnight, reject ambiguous DST clocks and show coverage gaps explicitly.

Establish data-use authorization separately from an adapter's software license
before enabling a new operator's collection or redistribution.

**Why:** Amtrak's website terms reviewed October 30, 2026 restrict automated
retrieval and redistribution; the uploaded adapter's ISC declaration does not
authorize upstream data use. No separate applicable permission was established.

**How to apply:** Check current source-specific terms or written authorization,
separately for schedules and tracking. Do not infer permission from HTTP success,
third-party catalog listings or approval for another operator in a shared archive.
See `docs/amtrak-access.md` for the access prerequisite and sources.

Distinguish public-record access and reuse of factual timetables from recurring
access to undocumented tracking services.

**Why:** The user pointed to 49 CFR Part 701; § 701.1 explicitly permits obtaining
public train timetables without a FOIA request, but does not expressly address
automated tracking polling. Treating these as identical overstates the blocker.

**How to apply:** Assess schedule and tracking access independently. Do not claim
that FOIA provides a blanket API license or that website terms conclusively
prohibit using timetable facts.

Amtraker offers its API data for reuse under its own published terms; distinguish
that from permission to collect directly from Amtrak.

**Why:** Its provider documentation explicitly publishes an ODC-By data license,
an identifying User-Agent requirement and visible app/map attribution guidance.
That changes the available source options, not the original endpoint's status.

**How to apply:** Recheck current provider terms before activation, obtain approval
for the source change, and keep tracking snapshots separate from full timetables.
