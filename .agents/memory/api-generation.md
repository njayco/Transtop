---
name: Generated API pitfalls
description: Non-obvious Orval behaviors encountered with split Zod/client generation in this project.
---

Avoid re-exporting every generated TypeScript type alongside every generated Zod value from the same barrel. Disable automatic index generation when maintaining a curated barrel.

**Why:** Orval regenerates index files and can append wildcard exports back into a manually edited root barrel. Path/query types can share names with Zod parameter schemas, causing duplicate exports even when every request body is named correctly.

**How to apply:** When extending the API, run codegen and the library typecheck before frontend work. Preserve curated Zod exports rather than patching generated files after every run. Generated header-merging helpers use `Headers.entries()`, so the client library also needs DOM iterable TypeScript types. Pin the query generator to the installed TanStack Query major version rather than relying on Orval's package autodetection in the workspace.
