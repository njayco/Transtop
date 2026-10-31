---
name: IDFM access and sharing boundary
description: Owner-approved scheduled Paris source and owner-only public compliance actions.
---

The owner approved official IDFM scheduled transit under Licence Mobilités after
being informed of attribution, freshness and conditional derived-database sharing
obligations. This does not authorize PRIM signup, paid services, new
agreements, external publication or external messages.

**Why:** The user explicitly approved schedules with those limits. Licence
Mobilités has conditional PAN publication and licensor-notification duties that
cannot be dismissed merely because the app provides limited query results.

**How to apply:** Keep source databases separate. Provide linked credits and a
complete transformation method. Resolve any applicable PAN publication/contact
with the owner before affected public use; do not silently turn a confirmation
flag on or treat scheduled-data approval as permission for extra Transitland spend.

The owner initially chose **“Keep schedules for now”**, then explicitly requested
PRIM realtime and informational data using their existing account and a key
stored securely in Transtop's Secrets.

**Why:** The owner changed the earlier deferral and requested PRIM integration.

**How to apply:** Use the secure Secrets flow and server-side authentication.
Verify endpoint entitlements, quotas and licensing independently; the uploaded
estimated-timetable definition describes predictions, not vehicle GPS.
The request does not authorize signup, paid plans or new agreements.
Public PRIM permission is separate from scheduled-data publication permission.
Do not treat a schedule-only confirmation or working account key as resolving
the PRIM page's conflicting license notices.

Public-use gating covers retained metadata and positive caches, not just
timetables or refresh jobs.

**Why:** Disabling imports does not remove source records, and a separate saved
service or inventory endpoint can otherwise expose that retained database.

**How to apply:** Apply publication permission before cache hits and before
returning names, listing verdicts, operator inventories or import diagnostics.
Withhold unavailable-to-publish metadata without deleting the rider's saved IDs.

PRIM can return a fresh HTTP/SIRI response containing estimates whose individual
production timestamps are much older. Keep production-age limits independent
from response/retrieval age; never make sparse predictions look fresh by replacing
their timestamps with the request time.

**Why:** An authenticated Noctilien response contained forecasts produced over
twenty minutes before its fresh response timestamp. Successful authentication
also proved only that endpoint access, not account quota or complete live coverage.

**How to apply:** Preserve source production timestamps and expiry through caches
and failures. Show scheduled fallback and an explicit withheld/unavailable status
when no fresh predictions survive. Verify other API entitlements separately.
