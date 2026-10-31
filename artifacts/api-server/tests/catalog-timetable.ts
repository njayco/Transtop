import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { GetTimetableQueryParams } from "@workspace/api-zod";
import { identity } from "../src/transit/transitland/model";
import type { timetable as dispatch } from "../src/transit/catalog";

// Install mocks before importing the public dispatcher. No database connection,
// provider cache, credentials or external requests are needed by this suite.
const unexpected = (name: string) => mock.fn(() => {
  throw new Error(`Unexpected provider access: ${name}`);
});
const query = unexpected("database query");
const select = unexpected("database select");
const allStops = unexpected("regional stops");
const intercityTimetable = unexpected("intercity timetable");
const intercityCatalog = unexpected("intercity catalog");
const discover = unexpected("Transitland discovery");
const globalTimetable = mock.fn(async (_params: Parameters<typeof dispatch>[0]) => ({
  departures: [], total: 0, offset: 3, limit: 9, date: "2026-11-02",
  message: "Transitland fixture reached",
}));
const providers = [query, select, allStops, intercityTimetable, intercityCatalog, discover, globalTimetable];

mock.module("@workspace/db", {
  exports: { db: { select }, pool: { query }, routes: {} },
});
for (const [path, exports] of [
  ["../src/transit/service.ts", { allStops }],
  ["../src/transit/intercity/service.ts", { intercityCatalog, intercityTimetable }],
  ["../src/transit/transitland/discovery.ts", { discover, unique: unexpected("discovery deduplication") }],
  ["../src/transit/transitland/departures.ts", { globalTimetable }],
  ["../src/transit/amtrak-service.ts", { scheduledRunId: unexpected("Amtrak run") }],
  ["../src/transit/generations.ts", { stopTimesMode: unexpected("regional schedules") }],
  ["../src/transit/tfl/service.ts", { discover: unexpected("TfL discovery") }],
] as const) {
  mock.module(new URL(path, import.meta.url).href, { exports });
}
const fetch = mock.method(globalThis, "fetch", unexpected("network"));
after(() => mock.restoreAll());
const { timetable } = await import("../src/transit/catalog");

const params = { mode: "live" as const, date: "2026-11-02", from: "08:00" };
const retiredStop = "ibg:stop:archived-boarding";
const retiredRoute = "ibg:route:archived-route";
const transitlandStop = identity("f-catalog-test", "boarding");
const transitlandRoute = identity("f-catalog-test", "route");

test("retired identities return the unavailable notice before any provider dispatch", async t => {
  const selections = [
    { name: "retired stop only", stopId: retiredStop },
    { name: "retired route only", routeId: retiredRoute },
    { name: "both retired", stopId: retiredStop, routeId: retiredRoute },
    { name: "retired stop with Transitland route", stopId: retiredStop, routeId: transitlandRoute },
    { name: "Transitland stop with retired route", stopId: transitlandStop, routeId: retiredRoute },
  ];
  for (const { name, ...selection } of selections) {
    for (const pagination of [{}, { offset: 7, limit: 12 }]) {
      await t.test(`${name}, ${"offset" in pagination ? "explicit" : "default"} pagination`, async () => {
        for (const provider of providers) provider.mock.resetCalls();
        fetch.mock.resetCalls();
        const request = GetTimetableQueryParams.parse({ ...params, ...selection, ...pagination });
        const result = await timetable(request);
        assert.deepEqual(result, {
          departures: [], total: 0, offset: pagination.offset ?? 0,
          limit: pagination.limit ?? 40, date: params.date,
          message: "This service is not imported. Check coverage in Settings.",
        });
        for (const provider of providers) assert.equal(provider.mock.callCount(), 0);
        assert.equal(fetch.mock.callCount(), 0);
      });
    }
  }
});

test("non-retired Transitland selections really reach the provider fixture", async () => {
  // A positive control prevents a broken fixture or blanket empty response from
  // making the retired-link assertions pass without exercising dispatch.
  for (const selection of [
    { stopId: transitlandStop }, { routeId: transitlandRoute },
    { stopId: transitlandStop, routeId: transitlandRoute },
  ]) {
    for (const provider of providers) provider.mock.resetCalls();
    const request = { ...params, ...selection, offset: 3, limit: 9 };
    const result = await timetable(request);
    assert.equal(result.message, "Transitland fixture reached");
    assert.equal(globalTimetable.mock.callCount(), 1);
    assert.deepEqual(globalTimetable.mock.calls[0].arguments, [request]);
    for (const provider of providers.filter(p => p !== globalTimetable)) {
      assert.equal(provider.mock.callCount(), 0);
    }
    assert.equal(fetch.mock.callCount(), 0);
  }
});
