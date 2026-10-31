---
name: Public feed networking
description: Node DNS callback semantics matter when pinning public feed download connections.
---

When pinning a public DNS answer for HTTPS feed downloads, account for Node's
address-family selection semantics, not just successful DNS resolution.

**Why:** Node's automatic family selection can request an array of DNS answers;
a lookup callback returning only a single address can then fail with an undefined
IP even though resolution succeeded. Explicit family selection and a live bounded
download exposed the distinction that type checks and URL-only fixtures missed.

**How to apply:** Keep private-address rejection and connection pinning together.
When changing Node versions or the downloader, verify a real small public download
without loosening DNS checks or allowing redirects to bypass validation.
