import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as react from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile(new URL("../src/components/wmata-access.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const context = vm.createContext({ Date });
const runtime = new vm.SyntheticModule(Object.keys(jsx), function () {
  for (const key of Object.keys(jsx)) this.setExport(key, jsx[key]);
}, { context });
const hooks = new vm.SyntheticModule(Object.keys(react), function () {
  for (const key of Object.keys(react)) this.setExport(key, react[key]);
}, { context });
const mod = new vm.SourceTextModule(code, { context });
await mod.link(name => { if (name === "react") return hooks; assert.equal(name, "react/jsx-runtime"); return runtime; });
await mod.evaluate();
const now = Date.parse("2026-10-31T16:00:00Z");
const render = (access, time = now) => renderToStaticMarkup(jsx.jsx(mod.namespace.WmataAccess, { access, now: time }));
const base = { stationCodes: ["A01", "C01"], mappingStatus: "fresh", scope: "Station-wide; exact paths unknown",
  entrancesStatus: "fresh", outagesStatus: "fresh", entrances: [], outages: [], url: "https://developer.wmata.com/",
  outageUrl: "https://developer.wmata.com/", outagesCheckedAt: "2026-10-31T16:00:00Z",
  mappingCheckedAt: "2026-10-31T16:00:00Z", entrancesCheckedAt: "2026-10-31T16:00:00Z" };
test("access panel never equates an empty official result with certified step-free travel", () => {
  const html = render(base);
  assert.match(html, /Step-free route: not verified/);
  assert.match(html, /no reported outages/);
  assert.match(html, /not a working-elevator guarantee/);
  assert.match(html, /Wheelchair flags/);
  assert.match(html, /no full-list update time/);
});
test("stale, missing and denied products keep explicit warnings and withhold empty-success text", () => {
  for (const state of ["stale", "access denied", "unavailable", "not checked", "limited"]) {
    const html = render({ ...base, outagesStatus: state });
    assert.match(html, /Current equipment condition is unknown/);
    assert(!html.includes("WMATA returned no reported outages"));
    assert(html.includes(state));
  }
  const unknown = render({ ...base, mappingStatus: "unknown station crosswalk", stationCodes: [] });
  assert.match(unknown, /No entrance or equipment assignments have been guessed/);
  const expired = render(base, now + 180001);
  assert.match(expired, /Current equipment condition is unknown/);
  assert(!expired.includes("WMATA returned no reported outages"));
  const expiredMapping = render(base, now + 86400001);
  assert.match(expiredMapping, /No entrance or equipment assignments have been guessed/);
});
test("official entrance and typed equipment descriptions retain attribution and return uncertainty", () => {
  const html = render({ ...base, entrances: [{ name: "Street <script>entry</script>", description: "Entrance",
    stationCodes: ["A01", "C01"], lat: 38.9, lon: -77 }],
    outages: [{ equipmentId: "X01", equipmentType: "ELEVATOR", stationCode: "A01", location: "Street to mezzanine",
      symptom: "Maintenance", status: "reported impaired; estimated return has passed, repair unconfirmed",
      reportedAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-31T11:00:00Z",
      estimatedReturn: "2026-10-30T12:00:00Z" }] });
  assert.match(html, /repair unconfirmed/); assert.match(html, /Elevator.*X01/);
  assert.match(html, /not verified elevator entrances/); assert.match(html, /Source: WMATA/);
  assert(!html.includes("<script>")); assert.match(html, /not confirmation of repair/);
});
test("WMATA station header does not certify accessibility from its GTFS flag", async () => {
  const page = await readFile(new URL("../src/pages/stop.tsx", import.meta.url), "utf8");
  assert.match(page, /stop\.wmata \?[\s\S]*?Step-free access not verified[\s\S]*?: stop\.accessible/);
  assert.match(page, /href="#wmata-station-access"/);
});
