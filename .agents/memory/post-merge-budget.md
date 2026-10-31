---
name: Post-merge setup budget
description: Why database reconciliation needs a five-minute setup budget.
---

Allow a five-minute budget for shared dependency-install and database-schema setup unless measurements show that it has become reliably faster.

**Why:** With the expanded transit catalog loaded, setup exceeded two minutes and was killed during schema reconciliation. An unchanged retry with a five-minute budget succeeded in about 134 seconds, without forcing destructive schema changes.

**How to apply:** Preserve the longer post-merge timeout when changing setup or merging configuration. Diagnose prompts or real failures separately; do not drop/reset data merely to fit a short setup budget.
