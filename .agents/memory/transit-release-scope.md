---
name: Transit release scope
description: Why this release ships agency schedules without Google journey planning.
---

The current release ships agency schedules and existing Google Maps displays, but defers Google Routes journey planning.

**Why:** The user explicitly chose “Finish with schedules only” after server credential authorization could not be completed.

**How to apply:** Keep map display and official feed coverage work separate from journey-planner activation. A configured server secret alone is not approval to restore the deferred planner; revisit it when the user asks to resume that feature.

Official MTA Bus Time arrivals, vehicle positions and alerts are within scope.

**Why:** The user subsequently requested live MTA buses across all boroughs and express routes, and supplied the separate Bus Time credential. This expands official bus data coverage, not Google journey planning.

**How to apply:** Preserve official live bus support and labeled schedule fallback without re-enabling Google Routes itineraries.
