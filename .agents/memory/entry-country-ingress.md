---
name: Country styling ingress trust
description: Why cosmetic country detection cannot reuse a numeric Express proxy setting without verifying the hosting path.
---

Reverify edge header overwriting and the actual proxy chain before changing IP-based entry styling trust. Do not assume that the app's pre-existing numeric Express proxy setting identifies the visitor.

**Why:** Address-free structural checks of the real development ingress showed an extra internal proxy hop; the existing one-hop setting resolves to loopback. Local shared-proxy requests also preserve arbitrary caller-supplied forwarding entries, whereas the tested HTTPS edge overwrites them. Blindly choosing the first forwarded address would therefore confuse trusted public ingress with local fixtures.

**How to apply:** See `docs/regional-entry.md` for observed structural evidence and safe assumptions. Keep unexpected ingress/private clients on the original US presentation. Development evidence is not a guarantee about published infrastructure; verify that separately before approving release. Do not widen trust to make a cosmetic lookup succeed.
