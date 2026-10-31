---
name: TfL access and prediction boundaries
description: Conservative account allowance, independent source access and non-GPS TfL data rules.
---

Do not treat authenticated HTTP 200 responses as proof of the key's subscribed request entitlement. Until the account-specific product is independently confirmed, stay below the independently documented public baseline and reserve capacity for development and production using separate databases.

**Why:** TfL documents a public baseline and higher subscribed products, but a working saved key does not expose which product applies. Both environments may use that key without sharing a request ledger.

**How to apply:** Preserve the conservative split unless the owner authorizes a change after verifying account allowance. Never upgrade a product or accept another agreement on their behalf.

Direct TfL data must not depend on Transitland usage or reuse approval, and TfL predictions must never be treated as GPS or invented schedules when they expire.

**Why:** The user explicitly requested an independent official London source alongside—not replacing—the worldwide source, without extending into UK-wide rail or vehicle animation.

**How to apply:** Keep direct attribution and failures separate; require upstream observation timestamps and expiry. Prefer direct entities only after exact boarding-point/line verification; do not suppress an entire operator.

A successful exact TfL stop lookup is not proof that its top-level object is the requested boarding point.

**Why:** TfL can return a parent bus cluster for a concrete child NaPTAN request, even with HTTP 200. Substituting the parent would merge directions and use a centroid rather than a boarding point.

**How to apply:** Resolve the exact requested identity inside supplied child relationships; preserve siblings and refuse ambiguous/absent child matches.

Boarding-point verification must not become a persistent route-wide suppression rule.

**Why:** One feed/route can also serve other NaPTANs or platforms that have not been matched. A session-wide alias would hide those services before their boarding points could be checked and could redirect saved links into a disabled source.

**How to apply:** Keep precedence scoped to each returned boarding point and line-card aliases scoped to the current result. Preserve the original source for saved worldwide route links, regardless of TfL availability.
