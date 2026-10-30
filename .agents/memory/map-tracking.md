---
name: Live map tracking accuracy
description: User's route-badge requirement and why station reports must not be animated as GPS.
---

Use route-branded vehicle badges across transit modes; the user's example is the NYC 2 train as a moving red circle with “2”. Keep route geometry stable during map navigation and vehicle refreshes.

**Why:** The owner reported blinking transit lines in a recording. Rendering churn and viewport requests clearing existing data are not evidence that transit service changed. Subway feeds may report a current/next station rather than geographic coordinates; portraying those reports as precise moving GPS would invent location data.

**How to apply:** Keep static routes separate from vehicle updates. Animate only between actual received GPS observations, honor reduced motion and source expiry, and explicitly label station-anchored observations “not GPS”. Do not create vehicles from timetables or hide valid observed positions merely because a route has no loaded geometry.

Feed-local entity IDs are not global vehicle identities. Prefer the physical vehicle ID, then the trip identity, so independent subway feeds cannot overwrite each other's trains or reassign markers when entity numbering changes. MTA commuter vehicle messages can omit route IDs even when they contain GPS: resolve only exact agency-scoped published trip IDs, never guessed train-number or nearest-track matches.

Fresh Metro-North GPS can have a realtime trip ID that differs from the published GTFS trip ID. Such observations can show an operator-labeled vehicle with “line unresolved”, without a route link or inferred branch. Lack of verified line metadata must not suppress otherwise valid GPS; it must not authorize a guessed line either.
