---
name: Transitland access constraints
description: Owner-approved usage scope and an observed mismatch in published resource lookup documentation.
---

Do not raise Transitland's approved request allowance or enable additional paid services without fresh approval.

**Why:** The owner selected production access, approved potentially billable Transitland calls, and specified 9,999 app requests per month. That is not permission for unlimited metering or another provider's charges.

**How to apply:** Preserve explicit activation and persistent request accounting. Separate development/production databases must not each spend the full approved total; that would exceed the owner's approval. Other apps sharing the key remain outside this app's control.

Keep saved identities feed-scoped and stable, but resolve them through collection filters before using transient API integers for follow-up requests.

**Why:** During authorized integration, a documented feed-plus-GTFS composite stop lookup returned 404, while collection filtering by the same feed and stop ID worked. The trip-detail path also requires an internal integer, not the original GTFS trip ID.

**How to apply:** Do not persist those transient integers in favorites or replace the collection lookup just because the reference documentation advertises a composite path.
