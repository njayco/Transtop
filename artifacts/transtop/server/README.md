# Public page metadata

The homepage head is in `index.html`. Its search description is intentionally
shorter than a coverage inventory; the social descriptions can use different
copy. The verified canonical origin is `https://transtop.app`.

Social crawlers generally do not execute React, so stop, route and dated train
links need their identity in the initial HTML response. The route-aware web
host uses the same renderer for metadata and readable public content, without
a second provider request. The production artifact runs the built public web
host instead of a static wildcard rewrite. Rider entry behavior is unchanged.

The route-aware host calls the existing transit service directly. The optional
standalone public-content middleware uses the API service's internal port 8080
in development; browser API requests use relative paths through artifact
routing.

Only identity is used: no live countdowns, vehicle positions or personalized
state appear in metadata. Canonical URLs drop queries and fragments, and never
trust incoming Host headers. A source failure returns a temporary 503, not an
invented empty page. Explicit missing details return HTTP 404 with noindex.

The share image is a 1200 × 630 PNG at `/social-card.png`, not an app icon. Its
editable source is `assets/social-card.svg`; rasterize with ImageMagick:

```sh
magick -background '#0c0c0d' assets/social-card.svg public/social-card.png
```

Run the metadata and production-server regression tests from the repository root:

```sh
node --test artifacts/transtop/tests/metadata.test.mjs
```
