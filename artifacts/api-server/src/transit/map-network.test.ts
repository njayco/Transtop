import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { GetNetworkQueryParams } from "@workspace/api-zod";
import { boundsOf, contains, intersects, overlaps, simplify, validBounds } from "./map-geometry";
import { invalidateNetwork, network } from "./network";
import { freshVehicle, mapVehicles } from "./realtime";
import type { TransitRoute } from "./types";

const viewport = { west: -74, east: -73, south: 40, north: 41 };
test("viewport validation rejects incomplete, non-finite, reversed and invalid world coordinates", () => {
  assert.equal(validBounds(viewport), true);
  const parsed = GetNetworkQueryParams.parse({ ...viewport, mode: "live", zoom: "8" });
  assert.equal(validBounds(parsed as typeof viewport), true);
  assert.equal(validBounds({ ...viewport, east: -75 }), true); // West > east crosses the date line.
  assert.equal(validBounds({ ...viewport, east: viewport.west }), false);
  assert.equal(validBounds({ ...viewport, north: Infinity }), false);
  assert.equal(validBounds({ ...viewport, south: -91 }), false);
  assert.equal(GetNetworkQueryParams.safeParse({ zoom: "30" }).success, false);
  assert.equal(GetNetworkQueryParams.safeParse({ west: "-181" }).success, false);
  assert.equal(GetNetworkQueryParams.safeParse({ west: "NaN" }).success, false);
});
test("intersection detects crossing segments, corners, verticals and rejects nearby nonintersections", () => {
  assert.equal(intersects([[-75, 40.5], [-72, 40.5]], viewport), true);
  assert.equal(intersects([[-73.5, 39], [-73.5, 42]], viewport), true);
  assert.equal(intersects([[-75, 39], [-74, 40]], viewport), true);
  assert.equal(intersects([[-75, 41.1], [-72, 41.1]], viewport), false);
  assert.equal(intersects([[-75, 40], [-75, 41]], viewport), false);
  assert.equal(contains(viewport, -74, 40), true);
  assert.equal(overlaps(boundsOf([[-75, 40.5], [-72, 40.5]]), viewport), true);
});
test("simplification retains only official vertices and both endpoints", () => {
  const coords = [[0, 0], [.5, .00001], [1, 0], [1, 1], [2, 1]];
  const reduced = simplify(coords, .01);
  assert.deepEqual(reduced, [[0, 0], [1, 0], [1, 1], [2, 1]]);
  assert.ok(reduced.every(p => coords.includes(p)));
});
test("vehicle timestamps expire independently of feed headers; demo never receives live positions", () => {
  const now = Date.now();
  assert.equal(freshVehicle(now / 1000, now), true);
  assert.equal(freshVehicle((now - 61000) / 1000, now), false);
  assert.equal(freshVehicle((now + 31000) / 1000, now), false);
  assert.equal(freshVehicle(NaN, now), false);
  assert.equal(freshVehicle(0, now), false);
  assert.deepEqual(mapVehicles("demo"), []);
});
test("network keeps multiple branches, discloses missing geometry, caches and invalidates atomically", async () => {
  const route: TransitRoute = { id: "fixture:r", name: "R", agency: "Fixture", type: "rail", color: "#123456" };
  const bus: TransitRoute = { ...route, id: "fixture:b", name: "X1", type: "bus", serviceClass: "express" };
  let generation = 1, reads = 0;
  const queries = mock.method(pool, "query", (async (query: string | {text:string}) => {
    const sql=typeof query==="string"?query:query.text;
    // Drizzle's separate intercity snapshot read is not part of this fixture.
    if(typeof query!=="string"&&sql.includes("transit_feed_snapshots"))return {rows:[]};
    if (sql.includes("transit_feed_snapshots")) return { rows: [{ id: "fixture:static", updated_at: generation }] };
    if (sql.includes("WITH patterns")) {
      reads++;
      return { rows: [
        { route, shape_id: "out", shape: { coordinates: [[-75, 40.5], [-72, 40.5]] } },
        { route, shape_id: "in", shape: { coordinates: [[-75, 40.6], [-72, 40.6]] } },
        { route, shape_id: "missing", shape: null },
        { route: bus, shape_id: "bus", shape: { coordinates: [[-73.7, 40.1], [-73.5, 40.3]] } },
      ] };
    }
    return { rows: [{ data: { id: "fixture:stop", name: "Official station", lat: 40.5, lon: -73.5, type: "rail", routes: [route] } }] };
  }) as any);
  try {
    invalidateNetwork();
    const p = { mode: "live" as const, ...viewport, zoom: 10 };
    const initial = await network(p);
    assert.equal(initial.lines.length, 2);
    assert.equal(new Set(initial.lines.map(l => l.shapeId)).size, 2);
    assert.equal(initial.missingGeometry[0].id, route.id);
    assert.deepEqual(initial.lines.flatMap(l => l.vehicles), []);
    assert.equal(initial.stops.length, 0);
    const detailed = await network({ ...p, zoom: 14 });
    assert.equal(detailed.lines.length, 3);
    assert.equal(detailed.stops[0].name, "Official station");
    assert.equal(reads, 1);
    assert.equal((await network({ ...p, zoom: 14, serviceClass: "express" })).lines[0].route.id, bus.id);
    generation++;
    await network(p);
    assert.equal(reads, 2);
    invalidateNetwork();
    await network(p);
    assert.equal(reads, 3);
    assert.equal((await network({ ...p, routeId: bus.id, zoom: 8 })).lines.length, 1);
  } finally { queries.mock.restore(); invalidateNetwork(); }
});
