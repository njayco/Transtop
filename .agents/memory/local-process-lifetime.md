---
name: Local process lifetime
description: Disposable process lifetime and side effects of temporary package/tool installations.
---

Run disposable local services as foreground processes inside a background shell task, not as detached children of a short-lived shell.

**Why:** Detached PostgreSQL children started successfully but were terminated when the originating shell call ended. That made a healthy server appear to have connection or missing-database failures in later calls.

**How to apply:** Keep the service's process owned by its background task until dependent checks finish, then stop that task. This is especially important for isolated benchmark databases.

System dependency changes can recreate this container, erase temporary files and stop managed workflows. They can also introduce legacy port mappings alongside artifact-managed routing.

**Why:** Installing a temporary OCR tool during PDF processing removed the existing temporary renders and added direct port mappings. Removing the tool did not remove those routing changes.

**How to apply:** Keep original inputs and needed results in the workspace, regenerate disposable renders after an environment restart, inspect configuration changes and preserve artifact-managed routing. Restart the relevant managed workflows once the coherent work is ready.

Development-only PDF tooling can create a new Python project, author metadata and native-library dependencies in this otherwise Node-based workspace.

**Why:** Installing PyMuPDF for timetable extraction generated unrelated Python package scaffolding and brought in native and layout-processing dependencies. None were needed to serve the reviewed schedule data.

**How to apply:** Save normalized runtime data first, then remove only the temporary tooling and scaffolding introduced by that operation. Keep extraction scripts reproducible without making PDF parsing a production dependency, and inspect configuration changes before publishing.
