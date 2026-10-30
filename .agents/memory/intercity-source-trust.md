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
