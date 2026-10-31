import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { pool } from "@workspace/db";
import { odptRegistry } from "../src/transit/odpt/registry";
import { resolveEdition } from "../src/transit/odpt/client";
import { nearby,allStops,routeDetail } from "../src/transit/service";
import { timetable,catalog } from "../src/transit/catalog";
import { network } from "../src/transit/network";
import { pollFeed,feedsFor,fresh,mapVehicles } from "../src/transit/realtime";
import { adapter } from "../src/transit/adapters";

if(process.env.ODPT_VERIFY_LIVE!=="true")throw new Error("Set ODPT_VERIFY_LIVE=true for bounded real public-source checks");
// This check never calls Transitland or TfL or changes their approved budgets.
process.env.TRANSITLAND_ENABLED="false";process.env.TFL_ENABLED="false";
try{
  const date=DateTime.now().setZone("Asia/Tokyo").toISODate()!;
  const all=await allStops("live");
  for(const s of odptRegistry){
    const edition=await resolveEdition(s);
    const stops=all.filter(x=>x.id.startsWith(s.id+":")&&x.routes.length&&!x.parent);
    assert(stops.length,`${s.id} must be imported`);
    let stop=stops[0],route=stop.routes[0];
    let table=await timetable({mode:"live",routeId:route.id,date,from:"00:00",offset:0,limit:3});
    // Some route variants are weekday-only, or contain only drop-off calls.
    const candidates=[...new Map(stops.flatMap(x=>x.routes.map(r=>[r.id,{stop:x,route:r}] as const))).values()];
    for(const candidate of candidates.slice(0,30)){
      if(table.total)break;
      stop=candidate.stop;route=candidate.route;
      table=await timetable({mode:"live",routeId:route.id,date,from:"00:00",offset:0,limit:3});
    }
    assert(table.total>0,`${s.id} current dated departures`);
    assert(table.departures.every(d=>d.timezone==="Asia/Tokyo"));
    const detail=await routeDetail(route.id,"live");
    const near=await nearby({mode:"live",lat:stop.lat,lon:stop.lon,agency:s.id});
    const map=await network({mode:"live",lat:stop.lat,lon:stop.lon,zoom:14,agency:s.id});
    const search=await catalog({mode:"live",q:stop.name.split(" / ")[0],agency:s.id,offset:0,limit:3});
    assert(detail?.stops.length&&near.stops.length&&map.totalStops&&search.totalStops);
    console.log(JSON.stringify({operator:s.name,edition:edition.feed_version,validThrough:edition.feed_end_date,
      stops:stops.length,route:route.id,timetableRows:table.total,sample:table.departures[0],
      orderedStops:detail.stops.length,shapePoints:detail.shape.length,mapStops:map.totalStops,search:search.totalStops}));
  }
  for(const url of adapter("odpt-sendai").realtimeUrls)await pollFeed(url,"odpt-sendai");
  const feeds=feedsFor("odpt-sendai"),vehicles=mapVehicles().filter(v=>v.agencyId==="odpt-sendai");
  console.log(JSON.stringify({sendaiRealtime:feeds.map(f=>({fresh:fresh(f),timestamp:f.timestamp,
    matchedEntities:f.entities.length,updates:f.entities.filter(e=>e.tripUpdate).length,
    positions:f.entities.filter(e=>e.vehicle).length,alerts:f.entities.filter(e=>e.alert).length,error:f.error})),freshVehicles:vehicles.length}));
  assert.equal(feeds.length,3);
  assert(feeds.every(f=>!f.error),"Document availability failures rather than claiming verified realtime");
}finally{await pool.end();}
