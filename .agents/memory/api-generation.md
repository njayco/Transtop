---
name: Generated API pitfalls
description: Non-obvious Orval behaviors encountered with split Zod/client generation in this project.
---

Avoid re-exporting every generated TypeScript type alongside every generated Zod value from the same barrel. Disable automatic index generation when maintaining a curated barrel.

**Why:** Orval regenerates index files and can append wildcard exports back into a manually edited root barrel. Path/query types can share names with Zod parameter schemas, causing duplicate exports even when every request body is named correctly.

**How to apply:** When extending the API, run codegen and the library typecheck before frontend work. Preserve curated Zod exports rather than patching generated files after every run. Generated header-merging helpers use `Headers.entries()`, so the client library also needs DOM iterable TypeScript types. Pin the query generator to the installed TanStack Query major version rather than relying on Orval's package autodetection in the workspace.

OpenAPI `format: date-time` is coerced into a JavaScript Date by the generated server Zod schema, while the generated browser request type remains an ISO string.

**Why:** The server and browser generators intentionally represent validated timestamps differently; treating the parsed server value as a string causes type errors or incorrect conversion.

**How to apply:** Infer server inputs from the generated Zod schema and use Date operations after validation. Keep serialized browser requests as ISO strings.

Post-merge setup must regenerate both API clients and server Zod schemas before workflows restart.

**Why:** A merged map feature arrived with a newer contract and frontend callers but stale generated bindings, leaving missing hooks and incompatible network-response types. Installing dependencies and pushing the database schema did not refresh those bindings.

**How to apply:** Retain the API-spec codegen step in shared merge setup. Resolve contract mismatches at their source rather than manually patching generated files.

Check for missing generated API files before completing a task, even when their deletion was already present in the initial working tree.

**Why:** Completion can include pre-existing working-tree deletions. Isolated tests do not exercise the browser imports, so they cannot establish that generated bindings are intact.

**How to apply:** If the client barrel imports absent generated modules, run the existing codegen workflow, confirm regenerated files preserve the baseline, and run the full typecheck before completing.
