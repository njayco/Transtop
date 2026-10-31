import assert from "node:assert/strict";
import { test } from "node:test";
import { globalTimetable, normalizeDeparture } from "../src/transit/transitland/departures";
import { identity, normalizeRoute, normalizeStop } from "../src/transit/transitland/model";

const date = "2026-11-02";
const info = {
  feedId: "f-timetable-test", fetchedAt: "2026-11-01T00:00:00Z",
  license: "CC-BY-4.0", attribution: "Test agency",
  url: "https://www.transit.land/terms", timezone: "Asia/Tokyo",
};
const rawRoute = { route_id: "R", route_short_name: "R", route_type: 1, agency: { agency_name: "Test agency" } };
const route = normalizeRoute(rawRoute, info)!;
const makeStop = (id: string) => normalizeStop({
  stop_id: id, stop_name: id, geometry: { type: "Point", coordinates: [139, 35] },
}, [route], info)!;
const selected = makeStop("selected"), first = makeStop("first");
const missing = identity(info.feedId, "missing");
const message = "Transitland published service-day timetable · Asia/Tokyo. More departures exist; advance the page.";

function fixture(options: { missing?: boolean; warning?: string } = {}) {
  const calls = { stops: [] as string[], routes: [] as string[], departures: [] as string[] };
  const source: Parameters<typeof globalTimetable>[1] = {
    async globalStop(id) {
      calls.stops.push(id);
      return options.missing ? undefined : selected;
    },
    async globalRoute(id, direction) {
      calls.routes.push(id);
      assert.equal(direction, "0 · Central");
      return { route, stops: [first], shape: [], vehicles: [], alerts: [], directions: ["0 · Central"] };
    },
    async stopDepartures(stop, day, from) {
      calls.departures.push(stop.id);
      assert.equal(day, date);
      assert.equal(from, "08:00");
      // Exercise the real normalizer, including the selected boarding identity.
      const row = normalizeDeparture({
        service_date: date, departure_time: "09:00:00", stop_sequence: 1,
        trip: { trip_id: "trip", route: rawRoute, direction_id: 0, trip_headsign: "Central" },
      }, stop, date, info.timezone)!;
      return { rows: options.warning ? [] : [row], zone: info.timezone,
        message: options.warning || message, hasMore: !options.warning, after: "next", rawAlerts: [] };
    },
  };
  return { calls, source };
}
const params = { date, from: "08:00", direction: "0 · Central", limit: 1 };

test("stop-only and mixed valid requests keep the selected boarding stop and source notices", async () => {
  for (const routeId of [undefined, route.id]) {
    const { calls, source } = fixture();
    const result = await globalTimetable({ ...params, stopId: selected.id, routeId }, source);
    assert.equal(result.departures[0].stopId, selected.id);
    assert.deepEqual(calls, { stops: [selected.id], routes: [], departures: [selected.id] });
    assert.match(result.message, /Transitland published service-day timetable/);
    assert.match(result.message, /Total counts loaded rows only/);
    assert.ok("globalCoverage" in result);
    assert.equal(result.globalCoverage?.hasMore, true);
    assert.match(result.globalCoverage!.message, /More departures exist/);
  }
});

test("route-only requests still use the first supplied stop and preserve partial-source notices", async () => {
  const { calls, source } = fixture();
  const result = await globalTimetable({ ...params, routeId: route.id }, source);
  assert.equal(result.departures[0].stopId, first.id);
  assert.deepEqual(calls, { stops: [], routes: [route.id], departures: [first.id] });
  assert.match(result.message, /Transitland.*More departures exist/);
  assert.ok("globalCoverage" in result);
  assert.equal(result.globalCoverage?.hasMore, true);
});

test("missing stop-only and mixed valid-route/missing-stop requests return empty without substitution", async () => {
  for (const routeId of [undefined, route.id]) {
    const { calls, source } = fixture({ missing: true });
    const result = await globalTimetable({ ...params, stopId: missing, routeId, offset: 7, limit: 12 }, source);
    assert.deepEqual(result.departures, []);
    assert.equal(result.total, 0);
    assert.equal(result.offset, 7);
    assert.equal(result.limit, 12);
    assert.equal(result.date, date);
    assert.match(result.message, /No supplied boarding stop pattern/);
    assert.deepEqual(calls, { stops: [missing], routes: [], departures: [] });
  }
});

test("withheld source warnings remain visible for both explicit stops and route-only requests", async () => {
  for (const warning of [
    "This source snapshot is older than 45 days. Current departures are withheld.",
    "Agency timezone is unavailable. Timetable clocks are withheld.",
  ]) for (const selection of [{ stopId: selected.id }, { routeId: route.id }]) {
    const { source } = fixture({ warning });
    const result = await globalTimetable({ ...params, ...selection }, source);
    assert.deepEqual(result.departures, []);
    assert.equal(result.message, warning);
    assert.ok("globalCoverage" in result);
    assert.match(result.globalCoverage!.message, new RegExp(warning));
    assert.equal(result.globalCoverage?.hasMore, false);
  }
});
