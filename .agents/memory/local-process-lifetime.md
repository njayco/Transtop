---
name: Local process lifetime
description: Why disposable background services must remain foreground processes in a managed background shell.
---

Run disposable local services as foreground processes inside a background shell task, not as detached children of a short-lived shell.

**Why:** Detached PostgreSQL children started successfully but were terminated when the originating shell call ended. That made a healthy server appear to have connection or missing-database failures in later calls.

**How to apply:** Keep the service's process owned by its background task until dependent checks finish, then stop that task. This is especially important for isolated benchmark databases.
