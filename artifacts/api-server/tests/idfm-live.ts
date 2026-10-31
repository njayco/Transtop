import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { pool } from "@workspace/db";
import { catalog, timetable } from "../src/transit/catalog";
import { nearby, routeDetail, stopDetail } from "../src/transit/service";
import { network } from "../src/transit/network";
import { GetRouteResponse, GetStopResponse, GetStopsResponse, GetTimetableResponse, GetNetworkResponse } from "@workspace/api-zod";

if(process.env.IDFM_VERIFY_LIVE!=="true")throw new Error("Set IDFM_VERIFY_LIVE=true for the bounded imported official-data smoke check");
// No external API calls, extra downloads, PRIM access or Transitland quota use.
process.env.TRANSITLAND_ENABLED="false";process.env.TFL_ENABLED="false";process.env.PRIM_ENABLED="false";
const date=DateTime.now().setZone("Europe/Paris").toISODate()!;
try{
  const {rows:health}=await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='idfm:static'");
  assert(health[0]?.data?.idfmMethodVersion===1,"Import the current IDFM method first");
  const {rows:inventory}=await pool.query(`SELECT r.data->>'route_type' AS native_type,a.data->>'agency_name' AS network,
    count(*)::int AS count FROM transit_routes r JOIN transit_agencies a ON a.mode='live' AND a.id='idfm:'||(r.data->>'agency_id')
    WHERE r.mode='live' AND r.agency='idfm' GROUP BY 1,2 ORDER BY 1,2`);
  console.log(JSON.stringify({source:health[0].data,inventory}));
  for(const group of ["metro","rer","train","ter","tram","bus"]){
    const type=group==="metro"?"1":group==="tram"?"0":group==="bus"?"3":"2";
    const {rows:candidates}=await pool.query(`SELECT r.id,r.data,a.data->>'agency_name' AS network FROM transit_routes r
      JOIN transit_agencies a ON a.mode='live' AND a.id='idfm:'||(r.data->>'agency_id')
      WHERE r.mode='live' AND r.agency='idfm' AND r.data->>'route_type'=$1
        AND ($2 NOT IN('rer','train','ter') OR upper(a.data->>'agency_name') LIKE
          CASE WHEN $2='rer' THEN '%RER%' WHEN $2='train' THEN '%TRANSILIEN%' ELSE '%TER%' END)
      ORDER BY (a.data->>'agency_name'='RATP') DESC,r.data->>'name' LIMIT 8`,[type,group]);
    assert(candidates.length,`No ${group} routes in this edition`);
    let candidate=candidates[0],table=await timetable({mode:"live",routeId:candidate.id,date,from:"00:00",limit:3,offset:0});
    for(const next of candidates.slice(1)){if(table.total)break;candidate=next;
      table=await timetable({mode:"live",routeId:candidate.id,date,from:"00:00",limit:3,offset:0});}
    assert(table.total,`${group} has no dated timetable among bounded samples`);
    GetTimetableResponse.parse(table);
    assert(table.departures.every(d=>d.timezone==="Europe/Paris"));
    const detail=GetRouteResponse.parse(await routeDetail(candidate.id,"live"));
    assert(detail.stops.length,`${group} ordered stop pattern`);
    const stop=detail.stops[0],near=GetStopsResponse.parse(await nearby({mode:"live",lat:stop.lat,lon:stop.lon,agency:"idfm",type:detail.route.type}));
    assert(near.stops.length,`${group} nearby`);
    const stopPage=GetStopResponse.parse(await stopDetail(stop.id,"live"));
    assert(stopPage.idfm&&stopPage.arrivals.every(a=>a.source==="scheduled"));
    const map=GetNetworkResponse.parse(await network({mode:"live",agency:"idfm",type:detail.route.type,
      lat:stop.lat,lon:stop.lon,zoom:14}));
    assert(map.totalStops,`${group} map stops`);
    assert(map.lines.every(l=>!l.vehicles.length),`${group} never invents vehicles`);
    const search=await catalog({mode:"live",agency:"idfm",q:stop.name,offset:0,limit:3,serviceClass:"all"});
    assert(search.totalStops,`${group} Unicode name search`);
    console.log(JSON.stringify({group,route:candidate.id,name:detail.route.name,network:candidate.network,operator:detail.route.agency,
      sampleDeparture:table.departures[0],totalDepartures:table.total,orderedStops:detail.stops.length,shapePoints:detail.shape.length,
      nearby:near.stops.length,mapStops:map.totalStops,mapPaths:map.lines.length,mapPartial:map.truncated,source:detail.route.idfm}));
  }
  const {rows:others}=await pool.query("SELECT agency,count(*)::int AS stops FROM transit_stops WHERE mode='live' AND agency<>'idfm' GROUP BY agency ORDER BY agency");
  assert(others.length,"Unrelated regions must remain imported");
  console.log(JSON.stringify({unrelatedProvidersRetained:others}));
}finally{await pool.end();}
