---
name: Post-merge setup budget
description: Why setup needs more than the default twenty-second timeout.
---

Allow at least two minutes for the shared dependency-install and database-schema setup unless measurements show that it has become reliably faster.

**Why:** With the regional transit catalog loaded, setup completed successfully in about 94 seconds. A 20-second limit killed the schema step before it could finish; increasing the budget fixed setup without forcing destructive schema changes.

**How to apply:** Preserve the longer post-merge timeout when changing setup or merging configuration. Diagnose prompts or real failures separately; do not drop/reset data merely to fit a short setup budget.
