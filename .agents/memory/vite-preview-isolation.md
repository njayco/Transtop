---
name: Disposable Vite server isolation
description: Browser fixture servers must not invalidate the managed preview's optimized dependency URLs.
---

Keep disposable browser-test and managed preview dependency caches separate, even when both serve the same frontend source tree.

**Why:** The fixture server runs with different plugins/configuration. Sharing a Vite optimization cache allowed one server to replace dependency chunks still referenced by the other, producing a blank preview and HTTP 504 responses even though typechecks and isolated browser tests passed.

**How to apply:** Preserve cache isolation when changing frontend test/run configuration. After browser verification, check the actual managed preview, not only the disposable test server. A passing isolated suite cannot establish that the simultaneously running preview remains healthy.
