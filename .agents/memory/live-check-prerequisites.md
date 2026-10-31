---
name: Live transit check prerequisites
description: Distinguish missing local schedules during startup from provider entitlement or identity failures.
---

Confirm that the local schedule edition has finished publication before using a
live GPS-to-static matching count as evidence of provider or adapter correctness.

**Why:** An authorized Metrobus GPS response contained hundreds of observations,
but a new workspace returned zero matched vehicles while its first automatic
schedule import was still staging. An explicit second import correctly refused
to overlap. Broadening identity matching would have hidden the actual problem.

**How to apply:** Check active local schedule availability and existing import
progress first. Let the current import publish; do not restart it midway or spend
additional live requests while the matching prerequisite is absent. Access and
static identity matching are separate checks.
