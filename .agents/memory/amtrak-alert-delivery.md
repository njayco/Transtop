---
name: Amtrak alert delivery
description: Why train following initially uses device-local, app-open delivery rather than remote subscriptions.
---

Keep Amtrak follow delivery explicitly described as device-local and app-open unless a separate background-delivery feature is approved and implemented.

**Why:** The initial notification feature intentionally avoids collecting contact details or creating remote rider subscriptions. Browser notification permission alone does not enable delivery when the app is closed. Unofficial source coverage must not be presented as guaranteed delivery.

**How to apply:** Preserve the app-open limitation in follow controls and future marketing. Adding push, email, or cross-device follows needs a separate consent, retention, unsubscribe, and delivery design rather than silently reusing local follow consent.
