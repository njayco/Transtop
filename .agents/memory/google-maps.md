---
name: Google Maps credentials
description: Why the Google Maps Replit integration and runtime map authorization are separate.
---

The Google Maps Platform MCP connection provides official documentation tools, not runtime API credentials or Google Cloud billing.

**Why:** Connecting the available Replit integration did not supply application access. The user separately supplied a browser SDK key through Replit Secrets. Browser map keys are intentionally public, unlike server API credentials; hiding them behind a server proxy is not a substitute for Google Cloud website and API restrictions.

**How to apply:** Keep browser and server credentials separate. Require Maps JavaScript API authorization and permitted preview/published origins, and explain Google Cloud charges. Do not log, read back, or commit credentials while debugging. Changing a Vite browser key requires rebuilding the deployed client.
