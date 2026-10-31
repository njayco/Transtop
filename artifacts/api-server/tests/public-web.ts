import assert from "node:assert/strict";
import { mock, test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { publicPath, sitemapXml, sitemapSize } from "../src/public-web/urls";

const stop = { id: "agency:A&B", name: "Main & First", agency: "Agency", type: "bus", routes: [{ name: "1" }] };
const stopDetail = mock.fn(async (id: string) => {
  if (id === "outage") throw Error("Unavailable");
  if (id === "alias") return stop;
  return id === stop.id ? stop : undefined;
});
const routeDetail = mock.fn(async (id: string) => id === "agency:1" ? { route: { id, name: "1", agency: "Agency", type: "bus" } } : undefined);
const amtrakTrainDetail = mock.fn(async (id: string) => ["run:1", "run:scheduled"].includes(id) ? {
  id: "run:1", trainNumber: "1", routeName: "Regional", destination: "North", serviceDate: "2026-10-31", message: "Published schedule.",
} : undefined);
const paths = ["/", "/search", ...Array.from({ length: sitemapSize }, (_, i) => `/stops/a%3A${i}`)];
mock.module(new URL("../src/transit/service.ts", import.meta.url).href, { exports: { stopDetail, routeDetail } });
mock.module(new URL("../src/public-web/train.ts", import.meta.url).href, { exports: { publicTrain: amtrakTrainDetail } });
mock.module(new URL("../src/public-web/catalog.ts", import.meta.url).href, { exports: { sitemapPaths: async () => paths } });
mock.module(new URL("../src/transit/catalog.ts", import.meta.url).href, { exports: { catalog: async () => ({ stops: [stop], routes: [] }) } });
const { publicWebHandler } = await import("../src/public-web/handler");

const shell = '<!doctype html><html><head><title>Transtop</title></head><body><div id="root"></div></body></html>';

test("route-aware HTTP pages, discovery and status handling", async t => {
  const app = express();
  app.use(publicWebHandler(async () => shell));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, init?: RequestInit) => fetch(base + path, init);
  try {
    for (const path of ["/", "/search", "/stops/agency%3AA%26B", "/routes/agency%3A1", "/trains/run%3A1", "/trains/run%3Ascheduled"]) {
      await t.test(`200 and self-canonical ${path}`, async () => {
        const response = await get(path + "?ignored=1", { headers: { Host: "attacker.example" } });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(html.includes(`rel="canonical" href="https://transtop.app${path}"`));
        assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
        assert.match(html, /<h1>/);
      });
    }
    for (const path of ["/does-not-exist", "/stops/missing", "/routes/missing", "/trains/missing", "/stops/%ZZ", "/stops/a%2Fb", "/assets/missing.js"]) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      assert.match(response.headers.get("x-robots-tag")!, /noindex/);
      const html = await response.text();
      assert.match(html, /End of the line/);
      assert.doesNotMatch(html, /rel="canonical"/);
      assert.doesNotMatch(html, /<script/, "missing pages must not boot the entry gate over the error");
    }
    for (const path of ["/favorites", "/ride", "/settings"]) {
      const response = await get(path);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /noindex/);
      assert.doesNotMatch(html, /rel="canonical"/);
    }
    const redirect = await get("/stops/alias", { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), "/stops/agency%3AA%26B");
    const outage = await get("/stops/outage");
    assert.equal(outage.status, 503);
    assert.equal(outage.headers.get("retry-after"), "60");
    const head = await get("/routes/agency%3A1", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const robots = await get("/robots.txt");
    assert.match(await robots.text(), /Sitemap: https:\/\/transtop.app\/sitemap.xml/);
    const index = await get("/sitemap.xml");
    assert.match(index.headers.get("content-type")!, /xml/);
    assert.match(await index.text(), /<sitemapindex[\s\S]*\/sitemaps\/1.xml[\s\S]*\/sitemaps\/2.xml/);
    const page = await get("/sitemaps/1.xml");
    assert.equal(((await page.text()).match(/<url>/g) || []).length, sitemapSize);
    assert.equal((await get("/sitemaps/3.xml")).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("path normalization, invalid encodings and XML escaping", () => {
  assert.equal(publicPath("/stops/agency:A%26B/")?.path, "/stops/agency%3AA%26B");
  assert.equal(publicPath("/stops/%00"), undefined);
  assert.equal(publicPath("/stops/%ZZ"), undefined);
  assert.equal(publicPath("//external.example"), undefined);
  assert.match(sitemapXml(["/search?a=1&b=2"]), /a=1&amp;b=2/);
});
