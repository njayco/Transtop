import { pool } from "@workspace/db";
import { discover, globalRoute, globalStop } from "../src/transit/transitland/discovery";
import { globalEnrich, globalTimetable } from "../src/transit/transitland/departures";
import { usage } from "../src/transit/transitland/client";
import { DateTime } from "luxon";

// Explicit opt-in check: real quota consumption, never run as part of the fixture suite.
if(process.env.TRANSITLAND_VERIFY_LIVE!=="true")throw new Error("Set TRANSITLAND_VERIFY_LIVE=true to approve real API verification calls");
try{
  for(const [name,lat,lon] of [["Sydney",-33.8688,151.2093],["Paris",48.8566,2.3522],["San Francisco",37.789,-122.401]] as const){
    const page=await discover({lat,lon},[]);
    console.log(JSON.stringify({name,stops:page.stops.length,routes:page.routes.length,modes:[...new Set(page.routes.map(r=>r.type))],coverage:page.globalCoverage}));
    if(!page.stops.length)continue;
    const stop=await globalStop(page.stops[0].id);
    if(!stop)continue;
    const enriched=await globalEnrich(stop),route=await globalRoute(stop.routes[0].id);
    const zone=enriched.transitland?.timezone;
    const date=DateTime.now().setZone(zone||"UTC").toISODate()!;
    const table=await globalTimetable({stopId:stop.id,date,from:"00:00",limit:3});
    console.log(JSON.stringify({name,stopId:stop.id,stop:stop.name,zone,arrivals:enriched.arrivals.length,
      routeId:route?.route.id,shapePoints:route?.shape.length,orderedStops:route?.stops.length,timetableRows:table.departures.length,date,message:table.message}));
  }
  console.log("APP BUDGET",await usage());
}finally{await pool.end();}
