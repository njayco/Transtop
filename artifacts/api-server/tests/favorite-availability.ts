import assert from "node:assert/strict";
import { availabilityCache, uncertain } from "../src/transit/favorite-availability-cache";
import { CheckFavoriteAvailabilityBody, CheckFavoriteAvailabilityResponse } from "@workspace/api-zod";
import { lookupFavorite } from "../src/transit/favorite-availability";
import { documentStops, documentRoutes } from "../src/transit/intercity/uploaded-data";

let now = 0, calls = 0;
const item = { id: "source:saved", kind: "stop" as const };
const run = availabilityCache(async () => {
  calls++;
  return { status: "unavailable", message: "No longer listed." };
}, () => now);
assert.equal((await run([item, item])).length, 2);
assert.equal(calls, 1, "duplicate saved identities share a cached check");
now = 599_999;
await run([item]);
assert.equal(calls, 1);
now = 600_001;
await run([item]);
assert.equal(calls, 2, "negative results expire, never a permanent tombstone");
await run([{ ...item, kind: "route" }]);
assert.equal(calls, 3, "stop and route identity spaces stay separate");

calls = 0; now = 0;
const outage = availabilityCache(async () => { calls++; throw new Error("source offline"); }, () => now);
const result = (await outage([item]))[0];
assert.equal(result.status, "unknown");
assert.equal(result.message, uncertain.message);
assert.equal(result.id, item.id);
now = 59_999; await outage([item]);
assert.equal(calls, 1, "failures are cached to avoid a retry flood");
now = 60_001; await outage([item]);
assert.equal(calls, 2);

let finish!: () => void;
calls = 0;
const gate = new Promise<void>(resolve => { finish = resolve; });
const slow = availabilityCache(async () => { calls++; await gate; return { status: "available", message: "Listed" }; });
const first = slow([item]);
const duplicate = slow([item]);
const second = slow([{ ...item, id: "source:other" }]);
assert.equal((await slow([{ ...item, id: "source:third" }]))[0].status, "unknown", "concurrency is globally bounded");
assert.equal(calls, 2);
finish();
assert.deepEqual(await first, await duplicate, "simultaneous checks share work");
await second;

assert.equal(CheckFavoriteAvailabilityBody.safeParse({ items: [] }).success, false);
assert.equal(CheckFavoriteAvailabilityBody.safeParse({ items: Array(21).fill(item) }).success, false);
assert.equal(CheckFavoriteAvailabilityBody.safeParse({ items: [{ ...item, kind: "train" }] }).success, false);
assert.equal(CheckFavoriteAvailabilityBody.safeParse({ items: [{ ...item, id: "x".repeat(241) }] }).success, false);
CheckFavoriteAvailabilityResponse.parse([result]);

for (const kind of ["stop", "route"] as const) {
  const records = kind === "stop" ? documentStops : documentRoutes;
  for (const record of records) {
    const verdict = await lookupFavorite({ kind, id: record.id });
    assert.equal(verdict.status, "available", "document metadata does not depend on GPS or today's departures");
    assert.equal(verdict.currentName, record.name);
  }
  assert.equal((await lookupFavorite({ kind, id: "transbridge:not-listed" })).status, "unavailable");
  assert.equal((await lookupFavorite({ kind, id: "ibg:retired" })).status, "unavailable");
}
process.stdout.write("Favorite availability cache, bounds, outage and document checks passed.\n");
