---
name: Google Maps credentials
description: Why the Google Maps Replit integration and runtime map authorization are separate.
---

The Google Maps Platform MCP connection provides official documentation tools, not runtime API credentials or Google Cloud billing.

**Why:** Connecting the available Replit integration did not supply application access. The user separately supplied a browser SDK key through Replit Secrets. Browser map keys are intentionally public, unlike server API credentials; hiding them behind a server proxy is not a substitute for Google Cloud website and API restrictions.

**How to apply:** Keep browser and server credentials separate. Require Maps JavaScript API authorization and permitted preview/published origins, and explain Google Cloud charges. Do not log, read back, or commit credentials while debugging. Changing a Vite browser key requires rebuilding the deployed client.

For the non-WebGL map path, keep raster rendering with embedded dark styles and no map ID, using classic markers until a cloud-styled/Advanced Marker path is separately verified.

**Why:** A map ID ignores embedded client styles, while Advanced Markers require a map ID. Combining them without confirming the cloud configuration makes styling and raster support unreliable. Classic markers are deprecated, but remain supported; a future migration should preserve the non-WebGL requirement.

**How to apply:** Do not reintroduce a demo map ID solely to enable Advanced Markers. Check the current Google support policy before changing marker strategy, and verify real tiles rather than map construction alone. `RefererNotAllowedMapError` specifically requires website-origin authorization, not styling changes.

Google website-restriction changes can be intermittent while propagating: a map can briefly render tiles while a later fresh map still fails authorization.

**Why:** After the owner allowed the preview origin, the first regional map rendered, but later full documents still reported a referrer error before subsequent fresh documents and route/stop maps succeeded.

**How to apply:** After a restrictions change, verify a fresh document and representative route/stop maps rather than declaring success from one cached tile-backed view. Never remove website/API restrictions to bypass propagation.
