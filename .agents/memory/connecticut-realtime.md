---
name: Connecticut realtime extension compatibility
description: Why optional decoded CT metadata must not block valid live arrivals.
---

CTtransit's public trip-update feed can decode optional per-stop headsign and trip short-name metadata into strings containing NUL characters with the current protobuf binding. PostgreSQL JSONB rejects these strings.

**Why:** The feed was fresh and every sampled trip matched the static GTFS, but snapshot persistence failed and marked valid trip updates unavailable. This was not an authorization or trip-matching failure.

**How to apply:** Remove only invalid optional display metadata before snapshot serialization. Preserve identifiers, arrival/departure events, timestamps and valid plain-text headsigns. Check the full fetch/decode/persist lifecycle, not just whether the upstream HTTP request succeeds.
