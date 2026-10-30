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
