// Bounded, explicit entitlement check. Never print credentials or response bodies.
import { download, WmataError } from "../src/transit/wmata/client";
import { pool } from "@workspace/db";
import { schemas } from "../src/transit/wmata/access-model";
import { stationCodes } from "../src/transit/wmata/access-model";
import { locationInfo } from "../src/transit/wmata/model";
import { validateArchive } from "../src/transit/wmata/archive";
import { Open } from "unzipper";
import { parse } from "csv-parse";
import type { TransitStop } from "../src/transit/types";

try {
  let stations: ReturnType<typeof schemas["station-list"]["parse"]> | undefined;
  for (const [op, field] of [
    ["station-list", "Stations"], ["station-entrances", "Entrances"],
    ["equipment-outages", "ElevatorIncidents"],
  ] as const) {
    try {
      const data = JSON.parse((await download(op)).toString());
      if (!Array.isArray(data[field])) throw new Error("Invalid shape");
      const validated = schemas[op].safeParse(data);
      if (op === "station-list") stations = schemas["station-list"].parse(data);
      console.log(JSON.stringify({ operation: op, authorized: true, records: data[field].length,
        fields: Object.keys(data[field][0] || {}), schemaValid: validated.success,
        ...(!validated.success ? { invalidFields: validated.error.issues.map(i => i.path.join(".")) } : {}) }));
      if (op === "station-list") console.log(JSON.stringify({ metroCenterCodes: data.Stations
        .filter((s: any) => ["A01", "C01"].includes(s.Code))
        .map((s: any) => ({ code: s.Code, together1: s.StationTogether1, together2: s.StationTogether2 })) }));
    } catch (error) {
      console.log(JSON.stringify({ operation: op, authorized: false,
        state: error instanceof WmataError ? error.state : "invalid response" }));
    }
  }
  if (process.argv.includes("--static-identity") && stations) {
    const zip = await Open.buffer(await download("static"));
    validateArchive(zip);
    const file = zip.files.find(f => f.path === "stops.txt");
    if (!file) throw new Error("Missing stops");
    let total = 0, matched = 0;
    const unresolved: string[] = [];
    for await (const r of file.stream().pipe(parse({ columns: true, bom: true }))) {
      if (!["1", "2", "3", "4"].includes(r.location_type) && !r.parent_station) continue;
      total++;
      const s = { rawId: r.stop_id, parent: r.parent_station, wmata: locationInfo(r) } as TransitStop;
      if (stationCodes(s, stations.Stations).length) matched++;
      else if (unresolved.length < 20) unresolved.push(r.stop_id);
    }
    console.log(JSON.stringify({ officialStaticLocations: total, exactStationCodeMatches: matched, unresolvedSample: unresolved }));
  }
} finally { await pool.end(); }
