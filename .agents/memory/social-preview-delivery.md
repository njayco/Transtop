---
name: Social preview delivery
description: Why detail-page identity must stay available in initial HTML and why the web artifact runs a server.
---

Keep stop, route and dated train metadata in the initial HTML response, not
only in client effects. The web artifact needs a runtime responder even though
the visible rider screens remain a client application.

**Why:** Most social link-preview crawlers do not execute React. Replacing the
web runtime with a static wildcard shell would restore generic homepage
previews for every detail link.

**How to apply:** Preserve initial-response page identity when changing
rendering or deployment architecture. Reuse the same entity lookup for public
content and metadata where possible rather than fetching it twice. Do not
assume the development preview proxy is a production loopback service. Keep
canonical origins independent of untrusted request headers.
