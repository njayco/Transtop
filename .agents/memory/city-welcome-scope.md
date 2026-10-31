---
name: City welcome scope
description: User-approved regional welcome choices and the limits of automatic IP styling.
---

Keep New York's existing welcome design and provide a new regional design for
Connecticut. New Jersey and Connecticut are statewide regional themes; the other
supplied US designs represent cities. A manual design selector must remain available.

**Why:** The user explicitly chose “Keep New York and create a new regional design
for Connecticut” after providing ten regional reference posters and a default
dollar-bill/farebox poster.

**How to apply:** Preserve these regional identities when revising welcome screens.
IP geolocation is approximate, not proof of physical presence inside city limits;
do not strengthen the UI's location claim or weaken ingress trust to force a match.

DB-IP's published City Lite checksum refers to the uncompressed MMDB, not its
gzip download.

**Why:** Checking the archive against the database hash rejected valid downloads;
uncompressed content verification succeeded. Monthly updates must compare like
formats, not remove integrity checks.

**How to apply:** Reverify the official snapshot hash and license whenever updating
the pinned city database. Account for the runtime database's buffer memory; this
is a local lookup, not permission to send visitor IPs to a third-party service.
