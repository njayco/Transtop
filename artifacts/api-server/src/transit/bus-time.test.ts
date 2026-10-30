import { test, mock } from "node:test";
import assert from "node:assert/strict";
import bindings from "gtfs-realtime-bindings";
import { db, pool } from "@workspace/db";
import { busRealtimeUrls, busRequestUrl, tripIdentity } from "./bus-time";
import { feedStatus, liveAlerts, mapVehicles, pollFeed } from "./realtime";
import { officialArrivals } from "./service";
import type { TransitStop } from "./types";

test("Bus Time connects server-side, matches borough trips, withholds stale/failed feeds and keeps credentials out of snapshots", async () => {
  const originalKey = process.env.MTA_BUS_TIME_API_KEY;
  process.env.MTA_BUS_TIME_API_KEY = "test-only-not-a-real-key";
  const now = Math.floor(Date.now() / 1000);
  const snapshots: any[] = [];
  const queries = mock.method(pool, "query", async () => ({ rows: [
    { id: "mta-bus:busco~trip", data: { route_id: "QM2", trip_headsign: "MIDTOWN 57 ST" } },
  ] }));
  const inserts = mock.method(db, "insert", () => ({
    values: (data: any) => ({ onConflictDoUpdate: async () => { snapshots.push(data); } }),
  }) as any);
  let failed = false, old = false;
  const fetcher = mock.method(globalThis, "fetch", async (input: any) => {
    const url = new URL(input);
    assert.equal(url.searchParams.get("key"), "test-only-not-a-real-key");
    if (failed) return new Response("", { status: 403 });
    const observation = old ? now - 180 : now;
    const entities = url.pathname === "/tripUpdates" ? [
      { id: "trip", tripUpdate: { timestamp: observation, trip: { tripId: "trip", routeId: "QM2", directionId: 1 },
        stopTimeUpdate: [{ stopId: "123", arrival: { time: now + 240 } }] } },
    ] : url.pathname === "/vehiclePositions" ? [
      { id: "bus", vehicle: { timestamp: observation, trip: { tripId: "trip", routeId: "QM2" },
        position: { latitude: 40.75, longitude: -73.98 } } },
    ] : [
      { id: "alert", alert: { informedEntity: [{ trip: { routeId: "QM2" } }],
        headerText: { translation: [{ language: "EN", text: "Detour" }] } } },
    ];
    const bytes = bindings.transit_realtime.FeedMessage.encode(
      bindings.transit_realtime.FeedMessage.fromObject({
        header: { gtfsRealtimeVersion: "2.0", timestamp: now }, entity: entities,
      })).finish();
    return new Response(bytes);
  });
  const stop = { id: "mta-bus:123", rawId: "123", type: "bus", routes: [
    { id: "mta-bus:QM2", name: "QM2", color: "#0080ff", type: "bus" },
  ] } as TransitStop;
  try {
    for (const url of busRealtimeUrls) await pollFeed(url, "mta-bus");
    assert.equal(feedStatus("mta-bus").fresh, 3);
    const arrivals = officialArrivals(stop).arrivals;
    assert.equal(arrivals.length, 1);
    assert.equal(arrivals[0].tripId, "mta-bus:busco~trip");
    assert.equal(arrivals[0].destination, "MIDTOWN 57 ST");
    assert.equal(arrivals[0].direction, "Downtown");
    assert.equal(arrivals[0].source, "live");
    assert.equal(mapVehicles()[0].routeId, "mta-bus:QM2");
    assert.deepEqual(liveAlerts()[0].routeIds, ["mta-bus:QM2"]);
    assert.ok(!JSON.stringify(snapshots).includes("test-only-not-a-real-key"));
    assert.ok(snapshots.every(s => !s.id.includes("?")));
    assert.equal(tripIdentity("mta-bus:busco~trip"), tripIdentity("mta-bus:trip"));
    assert.equal(tripIdentity("mta-lirr:trip"), "mta-lirr:trip");
    old = true;
    await pollFeed(busRealtimeUrls[0], "mta-bus");
    await pollFeed(busRealtimeUrls[1], "mta-bus");
    assert.deepEqual(officialArrivals(stop).arrivals, []);
    assert.deepEqual(mapVehicles(), []);
    failed = true;
    for (const url of busRealtimeUrls) await pollFeed(url, "mta-bus");
    assert.equal(feedStatus("mta-bus").fresh, 0);
    assert.deepEqual(liveAlerts(), []);
    delete process.env.MTA_BUS_TIME_API_KEY;
    assert.throws(() => busRequestUrl(busRealtimeUrls[0]), /credentials not configured/);
    assert.equal(busRequestUrl("https://example.com/public"), "https://example.com/public");
  } finally {
    queries.mock.restore(); inserts.mock.restore(); fetcher.mock.restore();
    if (originalKey === undefined) delete process.env.MTA_BUS_TIME_API_KEY;
    else process.env.MTA_BUS_TIME_API_KEY = originalKey;
  }
});
