/** Explicit one-call account check. Never run as part of fixture tests. */
import GtfsRealtime from "gtfs-realtime-bindings";
import { pool } from "@workspace/db";
import { download } from "../src/transit/wmata/client";
import { normalizeVehicles } from "../src/transit/wmata/vehicles";

try {
  const routes=await pool.query("SELECT data FROM transit_routes WHERE mode='live' AND agency='wmata'");
  if(!routes.rows.length)throw new Error("Import WMATA schedules before requesting the live matching check");
  const bytes=await download("bus-vehicles",true);
  const f=GtfsRealtime.transit_realtime.FeedMessage.decode(bytes);
  const observations=f.entity.filter(e=>e.vehicle?.position);
  const trips=await pool.query("SELECT id,data FROM transit_trips WHERE mode='live' AND agency='wmata' AND id=ANY($1::text[])",
    [observations.flatMap(e=>e.vehicle?.trip?.tripId?[`wmata:${e.vehicle.trip.tripId}`]:[])]);
  const normalized=normalizeVehicles(f.entity,{routes:routes.rows.map(r=>r.data),stops:[],
    trips:trips.rows.map(r=>({id:r.id,data:r.data,calls:[],exceptions:[]}))},Number(f.header.timestamp));
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),bytes:bytes.length,
    header:Number(f.header.timestamp),entities:f.entity.length,positions:observations.length,
    matchedFreshGps:normalized.length,sample:normalized.slice(0,2)}));
  if(!normalized.length)throw new Error("No fresh GPS matched current static routes");
} catch {
  console.error("WMATA bounded vehicle check failed; no credentials or upstream body logged");
  process.exitCode=1;
} finally { await pool.end(); }
