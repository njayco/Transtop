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
