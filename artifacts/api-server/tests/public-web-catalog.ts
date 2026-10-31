import assert from "node:assert/strict";
import { mock, test } from "node:test";

const route = { id: "agency:1", name: "1", type: "bus" };
const stop = { id: "agency:A", name: "Main", routes: [route] };
const records = [
  { kind: "routes", data: route },
  { kind: "stops", data: stop },
  { kind: "stops", data: { ...stop, id: "agency:platform", parent: "A" } },
  { kind: "stops", data: { ...stop, id: "wmata:entrance", location_type: "2" } },
  { kind: "stops", data: { ...stop, id: "wmata:platform", parent: "A" } },
  { kind: "stops", data: { ...stop, id: "agency:empty", routes: [] } },
  { kind: "routes", data: { ...route, id: "ibg:retired" } },
  { kind: "routes", data: { ...route, id: "idfm:disabled" } },
  { kind: "routes", data: { ...route, id: "odpt:disabled", odpt: {} } },
];
const query = mock.fn(async () => ({ rows: records }));
mock.module("@workspace/db", { exports: { pool: { query } } });
mock.module(new URL("../src/transit/intercity/service.ts", import.meta.url).href, {
  exports: { intercityCatalog: async () => ({ routes: [{ ...route, id: "martz:R" }, route], stops: [] }) },
});
mock.module(new URL("../src/transit/odpt/registry.ts", import.meta.url).href, { exports: { odptEnabled: () => false } });
mock.module(new URL("../src/transit/idfm/model.ts", import.meta.url).href, { exports: { idfmEnabled: () => false } });
const { sitemapPaths } = await import("../src/public-web/catalog");

test("sitemap uses public live catalog rows, de-duplicates and filters unavailable/nonboarding records", async () => {
  const paths = await sitemapPaths();
  assert.deepEqual(paths, ["/", "/routes/agency%3A1", "/routes/martz%3AR", "/search", "/stops/agency%3AA", "/stops/wmata%3Aplatform"]);
  assert.match(query.mock.calls[0].arguments[0], /WHERE mode='live'/);
  await sitemapPaths();
  assert.equal(query.mock.callCount(), 1, "bounded cache avoids rebuilding the catalog per sitemap part");
});
