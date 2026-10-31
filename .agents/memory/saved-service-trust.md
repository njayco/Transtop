---
name: Saved-service identity trust
description: Why availability checks must not rewrite saved transit identities or claim an operator permanently stopped.
---

Keep saved identities and original labels intact when checking source metadata. A current name can be shown separately; a new identifier is not a replacement without independent verification and rider consent.

**Why:** Stops can be renumbered, similarly named boarding points can serve opposite directions, and independently sourced coverage can be withdrawn without the operator stopping service. Even correct metadata may only be temporarily unavailable.

**How to apply:** Treat expired schedules, withheld documents, licensing failures and outages as uncertainty, not permanent deletion. Say a confirmed missing identity is unavailable *in that source*, rather than claiming the service ended. Leave removal under rider control and never automatically substitute a same-name record.

Use the specific metadata response's validity for availability decisions, not a provider's global live-health status.

**Why:** TfL's live-health timer becomes stale after five minutes, while stop and line metadata remains valid for a day. Conversely, map browsing can legitimately retain expired metadata during an outage; that fallback cannot establish current saved-service availability.

**How to apply:** Accept still-valid metadata without another paid or quota-limited request. Reject expired fallback metadata for availability checks. Only an exact StopPoint not-found response proves that boarding identity is missing; a line-catalog error or an access/quota/network failure does not.
