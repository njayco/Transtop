import assert from "node:assert/strict";
import { test } from "node:test";
import { accessInfo, schemas, stationCodes, snapshotState, type AccessSnapshots } from "../src/transit/wmata/access-model";
import { locationInfo } from "../src/transit/wmata/model";
import { createClient, sourceUrl, operationFor, WmataError, type Budget } from "../src/transit/wmata/client";
import type { TransitStop } from "../src/transit/types";
import { createAccessService } from "../src/transit/wmata/access";

const now = Date.parse("2026-10-31T16:00:00Z");
const stations = [{ Code: "A01", StationTogether1: "C01", StationTogether2: "" },
  { Code: "C01", StationTogether1: "A01", StationTogether2: "" }, { Code: "B01", StationTogether1: "F01" }];
const parent = "STN_A01_C01";
function stop(id: string, kind: string, stationParent = parent): TransitStop {
  return { id: `wmata:${id}`, rawId: id, parent: kind === "station" ? undefined : stationParent,
    accessible: true, wmata: { ...locationInfo({ location_type: "1" }), kind } } as TransitStop;
}
const outage = { StationCode: "A01", UnitName: "X01", UnitType: "ELEVATOR",
  LocationDescription: "Street to mezzanine", SymptomDescription: "Maintenance",
  DateOutOfServ: "2026-10-01T07:00:00", DateUpdated: "2026-10-30T11:30:00",
  EstimatedReturnToService: "2026-10-31T13:00:00" };
function feeds(): AccessSnapshots {
  return {
    "station-list": { checkedAt: now, state: "fresh", nextPoll: now + 86400000, data: { Stations: stations } },
    "station-entrances": { checkedAt: now, state: "fresh", nextPoll: now + 86400000, data: { Entrances: [
      { ID: "deprecated-not-a-GTFS-id", Name: "Official entrance", Description: "Street entrance",
        StationCode1: "A01", StationCode2: "C01", Lat: 38.9, Lon: -77 },
      { Name: "Wrong station", Description: "Same name nearby", StationCode1: "B01", Lat: 38.9, Lon: -77 },
    ] } },
    "equipment-outages": { checkedAt: now, state: "fresh", nextPoll: now + 120000,
      data: { ElevatorIncidents: [outage, { ...outage, StationCode: "C01", UnitType: "ESCALATOR" },
        { ...outage, StationCode: "B01" }] } },
  };
}
test("exact complete station code crosswalk preserves parent, platform and entrance identities", () => {
  for (const s of [stop(parent, "station"), stop("PF_A01_1", "platform"), stop("PF_C01_2", "platform"), stop("PF_A01_C", "platform"), stop("ENT_123", "entrance")]) {
    const before = JSON.stringify(s), info = accessInfo(s, feeds(), now);
    assert.deepEqual(info.stationCodes, ["A01", "C01"]); assert.equal(info.entrances.length, 1);
    assert.equal(info.outages.length, 2); assert.equal(JSON.stringify(s), before);
    assert(!("id" in info.entrances[0])); assert.match(info.scope, /unknown/);
  }
  for (const s of [stop("PF_B01_1", "platform"), stop("PF_A01_guess", "platform"),
    stop("ENT_123", "entrance", "STN_A01")]) {
    const info = accessInfo(s, feeds(), now);
    assert.equal(info.mappingStatus, "unknown station crosswalk");
    assert.equal(info.entrances.length + info.outages.length, 0);
  }
  assert.deepEqual(stationCodes(stop(parent, "station"), stations.filter(s => s.Code !== "C01")), []);
  assert.deepEqual(stationCodes(stop("unpublished", "station"), stations), []);
});
test("outage freshness is independent of entrances, predictions, and old incident update dates", () => {
  const f = feeds();
  assert.equal(accessInfo(stop(parent, "station"), f, now).outages[0].updatedAt, "2026-10-30T15:30:00.000Z");
  f["equipment-outages"]!.checkedAt = now - 180001;
  let info = accessInfo(stop(parent, "station"), f, now);
  assert.equal(info.outagesStatus, "stale"); assert.equal(info.outages.length, 0); assert.equal(info.entrances.length, 1);
  f["equipment-outages"]!.checkedAt = now;
  f["station-entrances"]!.checkedAt = now - 86400001;
  info = accessInfo(stop(parent, "station"), f, now);
  assert.equal(info.entrancesStatus, "stale"); assert.equal(info.entrances.length, 0); assert.equal(info.outages.length, 2);
  f["station-list"]!.checkedAt = now - 86400001;
  info = accessInfo(stop(parent, "station"), f, now);
  assert.equal(info.mappingStatus, "stale"); assert.equal(info.outages.length, 0);
});
test("estimated return is not outage expiry and an expired snapshot never proves recovery", () => {
  const f = feeds();
  (f["equipment-outages"]!.data as any).ElevatorIncidents[0].EstimatedReturnToService = "2026-10-01T12:00:00";
  const info = accessInfo(stop(parent, "station"), f, now);
  assert.match(info.outages[0].status, /repair unconfirmed/);
  assert.equal(info.outages.length, 2);
  f["equipment-outages"]!.data = { ElevatorIncidents: [] };
  assert.equal(accessInfo(stop(parent, "station"), f, now).outagesStatus, "fresh");
  assert.equal(accessInfo(stop(parent, "station"), f, now).outages.length, 0);
  // Persisted snapshots do not get a renewed lifetime on process restart.
  const restored = JSON.parse(JSON.stringify(f));
  assert.equal(snapshotState("equipment-outages", restored["equipment-outages"], now + 180001), "stale");
});
test("denied, disabled, limited and missing products remain explicit, never healthy empty", () => {
  for (const state of ["access denied", "throttled", "limited", "unavailable", "invalid response"]) {
    const f = feeds(); f["equipment-outages"]!.state = state;
    const info = accessInfo(stop(parent, "station"), f, now);
    assert.equal(info.outagesStatus, state); assert.equal(info.outages.length, 0); assert.equal(info.entrances.length, 1);
  }
  for (const setup of ["disabled", "credential required", "quota confirmation required"]) {
    const info = accessInfo(stop(parent, "station"), feeds(), now, setup);
    assert.equal(info.outagesStatus, setup); assert.equal(info.outages.length + info.entrances.length, 0);
  }
  assert.equal(accessInfo(stop(parent, "station"), {}, now).outagesStatus, "not checked");
});
test("bounded response validation and source-date uncertainty", () => {
  assert(!schemas["equipment-outages"].safeParse({ ElevatorIncidents: [{ ...outage, DateUpdated: "nonsense" }] }).success);
  assert(!schemas["equipment-outages"].safeParse({}).success);
  assert(!schemas["station-entrances"].safeParse({ Entrances: [{ StationCode1: "guessed" }] }).success);
  const f = feeds();
  (f["equipment-outages"]!.data as any).ElevatorIncidents[0].DateUpdated = "2026-11-01T13:00:00";
  assert.equal(accessInfo(stop(parent, "station"), f, now).outages[0].status, "source dates uncertain");
  f["equipment-outages"]!.checkedAt = now + 30001;
  assert.equal(accessInfo(stop(parent, "station"), f, now).outagesStatus, "stale");
  f["station-list"]!.data = {};
  assert.equal(accessInfo(stop(parent, "station"), f, now).mappingStatus, "invalid response");
});
test("shared access snapshots coalesce, survive restart, expire independently and fail closed", async () => {
  const rows = new Map<string, any>(), locks = new Set<string>();
  let time = now, calls = 0, denied = false, broken = false;
  const store = {
    read: async (key: string) => { if (broken) throw new Error("DB offline"); return rows.get(key); },
    lock: async (key: string) => { if (locks.has(key)) return false; locks.add(key); return true; },
    save: async (key: string, value: any) => { rows.set(key, JSON.parse(JSON.stringify(value))); },
    release: async (key: string) => { locks.delete(key); },
  };
  const deps = { store, setup: () => "configured" as const, now: () => time, download: async (op: any) => {
    calls++;
    if (denied && op === "equipment-outages") throw new WmataError("access denied", "Denied");
    await new Promise(resolve => setTimeout(resolve, 1));
    return Buffer.from(JSON.stringify(feeds()[op as keyof AccessSnapshots]!.data));
  } };
  const a = createAccessService(deps);
  const [one, two] = await Promise.all([a.stationAccess(stop(parent, "station")), a.stationAccess(stop("PF_A01_1", "platform"))]);
  assert.equal(calls, 3); assert.equal(one.outages.length, 2); assert.deepEqual(two.stationCodes, one.stationCodes);
  await createAccessService(deps).stationAccess(stop(parent, "station"));
  assert.equal(calls, 3);
  time += 180001; denied = true;
  let result = await a.stationAccess(stop(parent, "station"));
  assert.equal(calls, 4); assert.equal(result.outagesStatus, "access denied"); assert.equal(result.outages.length, 0);
  assert.equal(result.entrances.length, 1);
  await createAccessService(deps).stationAccess(stop(parent, "station")); assert.equal(calls, 4);
  broken = true; result = await a.stationAccess(stop(parent, "station"));
  assert.equal(calls, 4); assert.equal(result.mappingStatus, "unavailable");
  assert.equal(result.outages.length + result.entrances.length, 0); assert.equal(locks.size, 0);
});
test("new JSON operations use the secure shared client, fixed allowlist and product backoff", async () => {
  const reserved: string[] = [], blocks: string[] = [];
  const budget: Budget = { reserve: async op => { reserved.push(op); return true; }, block: async op => { blocks.push(op); } };
  let requests = 0;
  const client = createClient({ key: () => "fixture-only-access-key", now: () => now, enabled: () => true,
    limit: () => 500, budget, fetch: async (url, options) => {
      requests++; assert.equal(options?.redirect, "error"); assert.equal((options?.headers as any).api_key, "fixture-only-access-key");
      assert(!String(url).includes("?")); return new Response('{"Stations":[]}');
    } });
  for (const op of ["station-list", "station-entrances", "equipment-outages"] as const) {
    await Promise.all([client.download(op), client.download(op)]);
    assert.equal(operationFor(sourceUrl(op)), op); assert(!sourceUrl(op).includes("/gtfs/"));
  }
  assert.equal(requests, 3); assert.equal(reserved.length, 3);
  const denied = createClient({ key: () => "fixture-key", now: () => now, enabled: () => true, limit: () => 500,
    budget, fetch: async () => new Response(null, { status: 403 }) });
  await assert.rejects(denied.download("equipment-outages"), e => e instanceof WmataError && e.state === "access denied");
  assert.deepEqual(blocks, ["equipment-outages"]);
});
