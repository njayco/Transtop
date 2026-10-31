---
name: WMATA access boundaries
description: Owner-confirmed terms acceptance and remaining account-access boundaries for direct WMATA integration.
---

The owner confirmed they have already accepted WMATA’s terms for Transtop.

**Why:** The owner explicitly confirmed acceptance when asked about existing WMATA access. Do not ask them to accept the same terms again.

**How to apply:** Treat that confirmation separately from product entitlement, account quotas and any additional redistribution authorization. The owner supplied the public API catalog, not subscription details; that list does not verify account access or limits. Do not create subscriptions, accept additional agreements, or use the public demo key as production authorization.

The owner separately confirmed the default account allowance is 10 calls/second
and 50,000 calls/day. This covers the existing account, not paid upgrades or other
apps' consumption.

**Why:** Public product listings do not establish account quotas.

**How to apply:** Keep development and production within conservative reserved
portions of this allowance and verify access separately per operation.

Treat WMATA entrance and equipment sources as station-wide reports, not a
step-free route guarantee. The official entrance API's ID is deprecated and
does not establish a GTFS entrance/equipment relationship. Equipment unit names
are unique only within type. An estimated return is not proof of repair.

**Why:** Official station-entrance and incident documentation supplies neither
a verified step-free path nor a complete working-equipment inventory; its return
times are estimates and may pass while the unit remains listed as impaired.

**How to apply:** Require exact published station-code relationships, keep
entrance/equipment identities separate, and preserve explicit uncertainty when
extending accessibility features. Research authoritative path/inventory data
before promising entrance-specific or step-free navigation.
