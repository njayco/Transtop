// Read-only acceptance check through the managed preview proxy.
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { mkdir,writeFile } from "node:fs/promises";
const agency="mobility-mdb-3233",report:Record<string,unknown>={requests:[]};
const requests=report.requests as Record<string,unknown>[];
async function get(path:string,params:Record<string,string|number>={}) {
  const url=new URL("http://localhost:80/api/transit/"+path);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const start=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,url.pathname);
  const body=await response.json();
  requests.push({path:url.pathname,params,elapsedMs:Date.now()-start});
  console.log(`${url.pathname}: ${Date.now()-start}ms`);
  return body;
}
try{
  const {rows}=await pool.query(`SELECT data FROM transit_stops WHERE mode='live' AND agency=$1
    AND data->>'name' ILIKE '%Alexanderplatz%' AND EXISTS(
      SELECT 1 FROM jsonb_array_elements(data->'routes') r WHERE r->>'name'='U2')
    ORDER BY id LIMIT 1`,[agency]);
  const stop=rows[0]?.data;
  assert(stop,"Import Berlin-Brandenburg first");
  const route=stop.routes.find((r:any)=>r.name==="U2");
  const catalog=await get("catalog",{mode:"live",agency,q:"Alexanderplatz",limit:10});
  assert(catalog.stops.some((s:any)=>s.id===stop.id));
  const nearby=await get("stops",{mode:"live",agency,lat:stop.lat,lon:stop.lon});
  assert(nearby.stops.some((s:any)=>s.mobility?.feedId==="mdb-3233"));
  const detail=await get("stops/"+encodeURIComponent(stop.id),{mode:"live"});
  assert.equal(detail.mobility.license,"CC-BY-4.0");assert.equal(detail.mobility.timezone,"Europe/Berlin");
  const timetable=await get("timetable",{mode:"live",stopId:stop.id,routeId:route.id,date:"2026-10-31",from:"00:00",limit:10});
  assert(timetable.departures.length>0);
  assert.equal(timetable.timezone,"Europe/Berlin");
  const future=await get("timetable",{mode:"live",stopId:stop.id,date:"2030-01-01",from:"00:00",limit:10});
  assert.equal(future.departures.length,0);
  const geometry=await get("network",{mode:"live",agency,routeId:route.id,zoom:14});
  assert(geometry.lines.some((l:any)=>l.route.id===route.id&&l.shape.length>2));
  const routeDetail=await get("routes/"+encodeURIComponent(route.id),{mode:"live"});
  assert(routeDetail.stops.length>2);assert(routeDetail.shape.length>2);
  assert.equal(routeDetail.route.mobility.datasetId,stop.mobility.datasetId);
  const sources=await get("sources");
  const source=sources.find((s:any)=>s.id===agency);
  assert(source);assert(source.description.includes("https://creativecommons.org/licenses/by/4.0/"));
  // A previously saved source identity still resolves without rewriting IDs.
  const canberra=await get("catalog",{mode:"live",agency:"mobility-mdb-935",limit:1});
  assert(canberra.stops.length>0);
  const saved=await get("stops/"+encodeURIComponent(canberra.stops[0].id),{mode:"live"});
  assert.equal(saved.id,canberra.stops[0].id);
  await get("catalog",{mode:"live",agency:"mta-subway",limit:2});
  report.stopId=stop.id;report.routeId=route.id;report.datasetId=stop.mobility.datasetId;
  report.departures=timetable.departures.slice(0,2);report.mapLines=geometry.lines.length;
  report.routeShapePoints=routeDetail.shape.length;report.routeStops=routeDetail.stops.length;
  report.source=source;report.previousSavedId=saved.id;
  report.database=(await pool.query("SELECT pg_database_size(current_database()) bytes")).rows[0];
  report.edition=(await pool.query(`SELECT g.data->>'stage' stage,pg_total_relation_size(
    'mobility_data.edition_'||replace(substring(g.data->>'stage' from 8),'-','')) bytes
    FROM transit_feed_snapshots g JOIN transit_feed_snapshots s
      ON s.mode='live' AND s.id=$1||':static' AND g.data->>'stage'=s.data->>'stopTimesMode'
    WHERE g.mode='live' AND g.agency=$1 AND g.data->>'storage'='mobility-edition'`,[agency])).rows[0];
  const stage=(report.edition as any).stage;
  report.stopPlan=(await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM transit_stop_times
    WHERE mode=$1 AND stop_id=$2`,[stage,stop.id])).rows;
  report.tripPlan=(await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM transit_stop_times
    WHERE mode=$1 AND trip_id=$2 ORDER BY sequence LIMIT 1`,[stage,timetable.departures[0].tripId])).rows;
  await mkdir(new URL("../../../generated-artifacts/mobility/",import.meta.url),{recursive:true});
  await writeFile(new URL("../../../generated-artifacts/mobility/regional-live.json",import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await pool.end();}
