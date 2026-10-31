---
name: Dependency security compatibility
description: Why the GTFS protobuf generator is excluded and security overrides need runtime checks.
---

Do not force a newer minimatch major into legacy glob to clear an audit.

**Why:** The patched major changes internal pattern metadata used by legacy glob; a real synchronous glob call failed despite successful typechecks and builds. Published GTFS bindings already contain generated JavaScript and types, and Transtop does not regenerate the protobuf sources, so excluding their unused generator is safer than an incompatible override.

**How to apply:** Keep runtime GTFS encode/decode checks when updating bindings. Reassess the generator exclusion if the project starts regenerating protocol bindings; that would require a compatible, secure toolchain.

Do not test dependency exclusion by asserting that Node cannot resolve a removed package in an existing install.

**Why:** pnpm can retain stale or hoisted package links after updating an existing node_modules tree even when the resolved lockfile no longer includes the package.

**How to apply:** Check the resolved dependency graph and lockfile for exclusions; test the application's actual runtime behavior separately.
