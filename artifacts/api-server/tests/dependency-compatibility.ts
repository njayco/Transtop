import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import express from "express";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { z } from "zod";
import { CheckFavoriteAvailabilityBody } from "@workspace/api-zod";

test("patched Zod rejects oversized arrays before accumulating element issues", () => {
  const result = z.array(z.string()).max(20).safeParse(Array(10_000).fill(null));
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
  }
  assert.deepEqual(CheckFavoriteAvailabilityBody.parse({
    items: [{ id: "mta:station", kind: "stop" }],
  }), { items: [{ id: "mta:station", kind: "stop" }] });
  assert.equal(CheckFavoriteAvailabilityBody.safeParse({
    items: [{ id: "", kind: "invalid" }],
  }).success, false);
});

test("GTFS bindings still encode and decode real feed structures", () => {
  const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
  const message = FeedMessage.create({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [{ id: "vehicle-1", vehicle: {
      trip: { tripId: "trip-1", routeId: "route-1" },
      position: { latitude: 40.75, longitude: -73.98 },
    } }],
  });
  assert.equal(FeedMessage.verify(message), null);
  const decoded = FeedMessage.decode(FeedMessage.encode(message).finish());
  assert.equal(decoded.entity[0].vehicle?.trip?.tripId, "trip-1");
  assert.equal(decoded.entity[0].vehicle?.position?.latitude, 40.75);
});

test("Express survives compressed request bodies with trailing bytes", async () => {
  const app = express();
  app.use(express.json());
  app.post("/", (req, res) => res.json(req.body));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: Buffer.concat([gzipSync('{"ok":true}'), Buffer.from([0, 1, 2, 3])]),
    });
    await response.text();
    assert.ok([200, 400].includes(response.status));
    // A later request must still work after the decoder has had time to finish.
    const next = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });
    assert.equal(next.status, 200);
    assert.deepEqual(await next.json(), { ok: true });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
