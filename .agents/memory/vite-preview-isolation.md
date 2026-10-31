---
name: Disposable Vite server isolation
description: Browser fixture servers must not invalidate the managed preview's optimized dependency URLs.
---

Keep disposable browser-test and managed preview dependency caches separate, even when both serve the same frontend source tree.

**Why:** The fixture server runs with different plugins/configuration. Sharing a Vite optimization cache allowed one server to replace dependency chunks still referenced by the other, producing a blank preview and HTTP 504 responses even though typechecks and isolated browser tests passed.

**How to apply:** Preserve cache isolation when changing frontend test/run configuration. After browser verification, check the actual managed preview, not only the disposable test server. A passing isolated suite cannot establish that the simultaneously running preview remains healthy.

Browser execution on Nix must preserve Chromium's executable/resource location and use compatible runtime libraries.

**Why:** Downloaded Playwright Chromium may lack discoverable system libraries. Launching it through an explicit dynamic-loader wrapper can pass `--version` but fail real startup because Chromium resolves ICU assets relative to the loader rather than its own binary.

**How to apply:** Prefer a compatible preinstalled browser. If adjusting a disposable downloaded browser, preserve its executable path and resource directory; do not mistake a successful version check for a working browser launch.
