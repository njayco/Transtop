---
name: Regional import capacity
description: Why archive size and parser memory are not sufficient regional import capacity checks.
---

Budget pre-publication database validation and failed-generation storage as part
of a large regional import, not just compressed bytes and parser memory.

**Why:** A full regional trial stayed within download and memory bounds but a
post-load integrity and membership joins timed out after all calls had been staged. Safety
correctly retained the previous edition, yet the failed generation still occupied
substantial storage. Small fixtures could not reveal this failure mode.

**How to apply:** Measure actual row counts and query plans; establish fresh
staging statistics before joins, prefer compact bounded streaming reference checks
and memberships over full-call post-load joins, and load isolated unindexed call
editions before building their indexes. Keep them detached from reader relations
until publication; an unindexed inherited child can slow last-good reads too.
Use whole-edition retirement rather than relying on millions of random-row
deletes, and retain an
unchanged source body in a bounded checksummed cache for retries. Account for
abandoned generations and cleanup time before raising any resource limit.

Regional capacity also needs a rider-read trial at a busy station, not just a
successful importer or a small timetable fixture.

**Why:** A large licensed archive imported within its memory and storage budgets,
but a busy-station Nearby request exceeded its timeout: repeated exception-calendar
filtering and service-day conversions dominated the read path. A whole-network
geometry cache could also allocate the entire newly added region on an unrelated
map request.

**How to apply:** Keep large regional paths/stops out of global caches; measure
selected-location map and Nearby reads after publication. Bound date/service
selection in SQL and reuse calendar/time-base calculations. Include existing
source/favorite reads in the same acceptance pass.

Catalog search results may omit size metadata even when the detail endpoint has it.

**Why:** Exhausting a bounded catalog allowance must not become permission to
raise it or infer unknown archive sizes.

**How to apply:** Keep missing sizes ineligible for automatic discovery. An explicit
operator measurement may use fresh, normalized catalog rights/timezone evidence
and the same bounded public archive downloader; it does not authorize realtime
companions or new provider terms.

Keep schema introspection stable when feeds make existing indexes large.
Do not change real composite-key order merely to satisfy a nondeterministic
schema diff, or upgrade the whole ORM to a release candidate solely for that bug.

**Why:** Unordered constraint introspection proposed rebuilding unchanged
multi-gigabyte primary keys. The upstream fix was bundled with a major rewrite;
a narrow constraint-ordinal correction preserved the stable toolchain.

**How to apply:** Inspect the proposed DDL and actual key order before allowing
large setup changes. Preserve the ordered-introspection correction until a stable
toolchain upgrade is verified not to recreate unchanged keys.
