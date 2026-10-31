import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  createCountryLookup, databasePath, ingressClientAddress, loadCountryReader,
  normalizedAddress, publicAddress, stylingCountry,
} from "../src/lib/entry-country";
import { createEntryRouter } from "../src/routes/entry";

test("supported country mapping rejects untrusted values", () => {
  for (const code of ["US", "GB", "FR", "JP"]) assert.equal(stylingCountry(code), code);
  for (const value of ["DE", "UK", "gb", "", null, undefined, "GB<script>", {}]) assert.equal(stylingCountry(value), null);
});

test("strict public IPv4/IPv6 normalization, including mapped addresses", () => {
  assert.equal(publicAddress("::ffff:8.8.8.8"), "8.8.8.8");
  assert.equal(publicAddress("2001:4860:4860::8888"), "2001:4860:4860::8888");
  for (const address of [
    undefined, "", "127.0.0.1", "::1", "::", "0.0.0.0", "10.0.0.1",
    "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "224.0.0.1",
    "255.255.255.255", "192.0.2.1", "198.51.100.3", "203.0.113.2",
    "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1",
    "2002:0808:0808::1", "64:ff9b::808:808", "2001::1",
    "8.8.8.8:80", "[2001:4860::1]", "fe80::1%eth0", "127.1",
    "010.0.0.1", "0x08080808", "8.8.8.8\n", "not-an-ip",
  ]) assert.equal(publicAddress(address), null, address);
  assert.equal(normalizedAddress("::ffff:127.0.0.1")?.range(), "loopback");
});

test("only verified ingress chain is trusted, not arbitrary metadata", () => {
  const req = (peer: string, forwarded?: string | string[]) => ({
    socket: { remoteAddress: peer }, headers: { "x-forwarded-for": forwarded, "x-country-code": "JP", "cf-ipcountry": "FR", "x-real-ip": "81.2.69.142" },
  });
  assert.equal(ingressClientAddress(req("::ffff:127.0.0.1", "81.2.69.142, 10.0.0.4, 127.0.0.1")), "81.2.69.142");
  assert.equal(ingressClientAddress(req("::1", "2001:4860:4860::8888, 10.0.0.4, ::1")), "2001:4860:4860::8888");
  assert.equal(ingressClientAddress(req("8.8.8.8", "81.2.69.142, 10.0.0.4, 127.0.0.1")), "8.8.8.8");
  for (const forwarded of [
    undefined, "81.2.69.142", "81.2.69.142, 127.0.0.1", "81.2.69.142, 8.8.8.8, 127.0.0.1",
    "81.2.69.142, 10.0.0.4, 8.8.8.8", "8.8.8.8, 81.2.69.142, 10.0.0.4, 127.0.0.1",
    "127.0.0.1, 10.0.0.4, 127.0.0.1", ["81.2.69.142"], "x".repeat(181),
  ]) assert.equal(ingressClientAddress(req("127.0.0.1", forwarded)), null);
  assert.equal(ingressClientAddress(req("10.0.0.1", "81.2.69.142, 10.0.0.4, 127.0.0.1")), null);
});

test("lookup failures and missing data remain unknown without leaking exceptions", async () => {
  assert.equal(await loadCountryReader("/not-a-real-country-database"), null);
  assert.equal(await createCountryLookup(Promise.resolve(null))("8.8.8.8"), null);
  assert.equal(await createCountryLookup(Promise.resolve({ get() { throw new Error("sensitive IP"); } }))("8.8.8.8"), null);
  assert.equal(await createCountryLookup(Promise.resolve({ get() { return { country: { iso_code: "DE" } }; } }))("8.8.8.8"), null);
  let calls = 0;
  const lookup = createCountryLookup(Promise.resolve({ get() { calls++; return null; } }));
  assert.equal(await lookup(null), null);
  assert.equal(calls, 0);
});

test("packaged licensed snapshot covers all four countries and IPv6", async () => {
  const reader = await loadCountryReader(databasePath);
  assert.ok(reader, "Run prepare:entry-country first to package the pinned database");
  const lookup = createCountryLookup(Promise.resolve(reader));
  for (const [address, country] of [
    ["8.8.8.8", "US"], ["81.2.69.142", "GB"], ["80.12.0.1", "FR"], ["133.242.0.1", "JP"],
    ["2404:7a80::1", "JP"], ["2001:4860:4860::8888", null],
  ]) assert.equal(await lookup(address), country, address);
});

test("endpoint is bounded, private, country-only; input country/IP values are ignored", async () => {
  const app = express();
  const expected: Record<string, "US" | "GB" | "FR" | "JP"> = { "8.8.8.8": "US", "81.2.69.142": "GB", "80.12.0.1": "FR", "133.242.0.1": "JP" };
  app.use("/api", createEntryRouter(async address => address ? expected[address] ?? null : null));
  app.use("/slow", createEntryRouter(() => new Promise(() => {})));
  app.use("/fail", createEntryRouter(async () => { throw new Error("raw visitor address"); }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [address, country] of Object.entries(expected)) {
      const response = await fetch(`${base}/api/entry/country?ip=133.242.0.1&country=JP`, {
        headers: { "x-forwarded-for": `${address}, 10.0.0.4, 127.0.0.1`, "cf-ipcountry": "FR" },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control")!, /private.*no-store/);
      assert.equal(response.headers.get("cdn-cache-control"), "no-store");
      assert.equal(response.headers.get("surrogate-control"), "no-store");
      assert.equal(response.headers.get("vary"), "*");
      assert.deepEqual(await response.json(), { country });
    }
    assert.deepEqual(await (await fetch(`${base}/api/entry/country?ip=81.2.69.142`, { headers: { "cf-ipcountry": "GB", "x-real-ip": "81.2.69.142" } })).json(), { country: null });
    const started = Date.now();
    assert.deepEqual(await (await fetch(`${base}/slow/entry/country`)).json(), { country: null });
    assert.ok(Date.now() - started < 1500);
    assert.deepEqual(await (await fetch(`${base}/fail/entry/country`)).json(), { country: null });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
