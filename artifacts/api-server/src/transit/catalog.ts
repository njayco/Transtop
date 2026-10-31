import { db, pool, routes } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import { allStops } from "./service";
import { activeService, serviceInstant, ZONE } from "./time";
import type { Mode, TransitRoute } from "./types";
import { GetCatalogQueryParams, GetTimetableQueryParams } from "@workspace/api-zod";
import type { z } from "zod";
import { stopTimesMode } from "./generations";
import { intercityCatalog, intercityTimetable } from "./intercity/service";
import { scheduledRunId } from "./amtrak-service";
import { isRetiredResearchId } from "./intercity/retired";
import { isTransitland } from "./transitland/model";
import { discover, unique } from "./transitland/discovery";
import { globalTimetable } from "./transitland/departures";
import * as tfl from "./tfl/service";
import { preferDirect, resultRouteAliases } from "./tfl/crosswalk";
import { isTfl } from "./tfl/model";
import { odptEnabled, odptSource } from "./odpt/registry";
import { isIdfm } from "./idfm/model";
import { findStops as parisStops, findRoutes as parisRoutes, parisTimetable } from "./idfm/queries";
import { isWmata,boarding } from "./wmata/model";
import { recordFor } from "./mobility/registry";
import { enabled as mobilityEnabled } from "./mobility/client";
import { findStops as regionalStops,directStop as mobilityStop,children as mobilityChildren } from "./mobility/queries";
type CatalogParams=z.infer<typeof GetCatalogQueryParams>;
type TimetableParams=z.infer<typeof GetTimetableQueryParams>;

export function patternLabel(trip:Record<string,string>) {
  return `${trip.direction_id||"0"} · ${trip.trip_headsign||`Direction ${trip.direction_id||"0"}`}`;
}
export function matchesPattern(trip:Record<string,string>,value?:string) {
  return !value||patternLabel(trip)===value;
}
/** Keep existing Ride/favorite links compatible with destination-based patterns. */
export function resolvePattern(patterns:string[],requested?:string) {
  const legacy:Record<string,string>={Uptown:"0",Outbound:"0",Downtown:"1",Inbound:"1"};
  return requested&&legacy[requested]?patterns.find(p=>p.startsWith(legacy[requested]+" · "))||requested:requested||patterns[0];
}
export async function catalog(p:CatalogParams) {
  const mode=(p.mode||"live") as Mode, q=(p.q||"").trim().toLowerCase(),offset=p.offset||0,limit=p.limit||20;
  if(mode==="live"&&p.agency==="idfm"){
    const [ss,rr]=await Promise.all([parisStops(p,undefined,limit,offset),parisRoutes(p,limit,offset)]);
    return {routes:rr.routes,stops:ss.stops,totalRoutes:rr.total,totalStops:ss.total,offset,limit,
      message:"Île-de-France Mobilités · published schedules only. Source and Licence Mobilités links accompany results. Stop/route pages are independently paginated."};
  }
  const match=(r:TransitRoute)=> (!p.agency||r.id.split(":")[0]===p.agency||r.agencyId===p.agency)&&
    (!p.type||p.type==="all"||r.type===p.type)&&(!p.serviceClass||p.serviceClass==="all"||r.serviceClass===p.serviceClass);
  if(mode==="live"&&p.agency&&recordFor(p.agency)?.regional){
    const [ss,records]=await Promise.all([regionalStops(p,undefined,limit,offset),
      db.select().from(routes).where(and(eq(routes.mode,"live"),eq(routes.agency,p.agency)))]);
    const rr=records.map(r=>r.data as TransitRoute).filter(r=>match(r)&&(!q||`${r.name} ${r.longName||""} ${r.agency}`.toLowerCase().includes(q)))
      .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    return {routes:rr.slice(offset,offset+limit),stops:ss.stops,totalRoutes:rr.length,totalStops:ss.total,offset,limit,
      message:"Published regional schedules; stops and routes are independently paginated. Source credits accompany each result."};
  }
  const extra=mode==="live"?(await intercityCatalog()).routes:[];
  const importedRoutes=[...(await db.select().from(routes).where(and(eq(routes.mode,mode),ne(routes.agency,"idfm")))).map(r=>r.data as TransitRoute).filter(r=>(!r.odpt||odptEnabled())&&(!r.mobility||mobilityEnabled())),...extra];
  const parisR=mode==="live"?await parisRoutes(p,Math.min(offset+limit,500)):{routes:[],total:0};
  const rr=[...importedRoutes,...parisR.routes]
    .filter(r=>!isRetiredResearchId(r.id)&&match(r)&&(!q||`${r.name} ${r.longName||""} ${r.agency} ${r.searchNames?.join(" ")||""}`.toLowerCase().includes(q)))
    .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const ss=(await allStops(mode)).filter(s=>(!s.parent||s.mobility||isWmata(s.id))&&boarding(s)&&s.routes.some(match)&&
    (!q||`${s.name} ${s.agency} ${s.searchNames?.join(" ")||""}`.toLowerCase().includes(q)||s.routes.some(r=>match(r)&&`${r.name} ${r.longName||""}`.toLowerCase().includes(q))))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const london=mode==="live"&&(q||p.agency?.startsWith("tfl"))?await tfl.discover({...p,q:q||"London"}):undefined;
  const foreign=mode==="live"&&(q||p.agency?.startsWith("tl:"))?await discover({...p,lat:undefined,lon:undefined},importedRoutes,undefined,await allStops(mode)):undefined;
  const paris=mode==="live"?await parisStops(p,undefined,Math.min(offset+limit,500)):{stops:[],total:0};
  const regional=mode==="live"?await regionalStops(p,undefined,Math.min(offset+limit,500)):{stops:[],total:0};
  const combinedStops=preferDirect(unique([...ss,...paris.stops,...regional.stops,...(foreign?.stops||[]),...(london?.stops||[])]));
  const aliases=resultRouteAliases(foreign?.stops||[],london?.stops||[]);
  const combinedRoutes=unique([...rr,...(foreign?.routes||[]).filter(r=>!aliases.has(r.id)),...(london?.routes||[])]);
  return {routes:combinedRoutes.slice(offset,offset+limit),stops:combinedStops.slice(offset,offset+limit),
    totalRoutes:combinedRoutes.length,totalStops:combinedStops.length+Math.max(0,regional.total-regional.stops.length),offset,limit,globalCoverage:foreign?.globalCoverage,tfl:london?.tfl,
    message:[
      paris.total>paris.stops.length||parisR.total>parisR.routes.length?"Paris results are capped in the combined catalog. Select Île-de-France Mobilités for all paginated matching stops/routes.":"",
      regional.total>regional.stops.length?"Regional results are capped in the combined catalog. Select the regional provider for all paginated matching stops/routes.":"",
    ].filter(Boolean).join(" ")||undefined};
}

export async function timetable(p:TimetableParams) {
  const mobility=recordFor((p.stopId||p.routeId||"").split(":")[0]);
  const odpt=odptSource((p.stopId||p.routeId||"").split(":")[0]),zone=mobility?.timezone||(odpt?"Asia/Tokyo":ZONE);
  const date=DateTime.fromISO(p.date,{zone}),from=p.from||"00:00";
  if(!date.isValid||date.toISODate()!==p.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(from))throw new Error("Invalid timetable date or time");
  if(!p.stopId&&!p.routeId)throw new Error("Select a stop or route");
  // Check both identities before any provider dispatch, including mixed old links.
  if(isRetiredResearchId(p.stopId)||isRetiredResearchId(p.routeId))
    return {departures:[],total:0,offset:p.offset||0,limit:p.limit||40,date:p.date,message:"This service is not imported. Check coverage in Settings."};
  if(p.mode!=="demo"&&(isIdfm(p.stopId)||isIdfm(p.routeId)))return parisTimetable(p);
  if(p.mode!=="demo"&&(isTfl(p.stopId)||isTfl(p.routeId)))return {departures:[],total:0,offset:p.offset||0,limit:p.limit||40,date:p.date,
    timezone:"Europe/London",message:"TfL direct data supplies predictions, not dated timetables. Open the stop for fresh official arrivals. No bulk schedules are imported."};
  if(p.mode!=="demo"&&(isTransitland(p.stopId)||isTransitland(p.routeId)))return globalTimetable(p);
  if(p.mode!=="demo"&&[p.stopId,p.routeId].some(id=>id&&/^(martz|transbridge|nj-transit):/.test(id))){
    if(p.stopId&&p.routeId&&p.stopId.split(":")[0]!==p.routeId.split(":")[0])throw new Error("Stop and route must belong to the same operator");
    return intercityTimetable(p);
  }
  const offset=p.offset||0,limit=p.limit||40,serviceDate=date.toFormat("yyyyMMdd");
  const empty={departures:[],total:0,offset,limit,date:p.date,...(odpt||mobility?{timezone:zone}:{}),message:`Published service-day timetable · ${zone}. Overnight departures may fall on the following calendar day; not live predictions.`};
  if((p.stopId||p.routeId||"").startsWith("mobility-")&&(!mobilityEnabled()||!mobility))return {...empty,message:"This Mobility Database feed is disabled or unavailable. No timetable has been substituted."};
  if(odpt&&!odptEnabled())return {...empty,message:"ODPT is disabled. No current departures supplied."};
  if(p.mode==="demo")return {...empty,message:"Published timetables are available in Live mode only. Demo arrivals are illustrative."};
  const agency=(p.stopId||p.routeId)!.split(":")[0];
  if(p.stopId&&p.routeId&&p.routeId.split(":")[0]!==agency)throw new Error("Stop and route must belong to the same operator");
  const {rows:health}=await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`${agency}:static`]);
  const published=health[0]?.data;
  if(published?.serviceEnd&&serviceDate>published.serviceEnd||published?.serviceStart&&serviceDate<published.serviceStart)
    return {...empty,message:`No current timetable for this date: the imported agency feed covers ${published.serviceStart}–${published.serviceEnd}. Check the operator's current schedules and the source link in Settings. Old departure times are never shifted to pretend they are current.`};
  const all=mobility?[]:await allStops("live"), stop=p.stopId?mobility?await mobilityStop(p.stopId):all.find(s=>s.id===p.stopId):undefined;
  if(p.stopId&&!stop)return {...empty,message:"This stop is not imported. Check coverage in Settings."};
  const ids=stop?[stop.id,...(mobility?await mobilityChildren(stop):all.filter(s=>s.parent===stop.rawId&&s.id.startsWith(agency+":"))).map(s=>s.id)]:null;
  const rawRoute=p.routeId?.slice(agency.length+1)||null;
  // Materialize the small route/stop selection before joining the regional
  // stop-times table. A correlated MIN per stop becomes prohibitively expensive
  // on the full multi-million-row bus catalog.
  const selected=ids?`WITH selected_times AS MATERIALIZED (
    SELECT * FROM transit_stop_times WHERE mode=${stopTimesMode("$1::text")} AND stop_id=ANY($3::text[])
  )`:`WITH selected_trips AS MATERIALIZED (
    SELECT * FROM transit_trips WHERE mode='live' AND agency=$1 AND data->>'route_id'=$2
  )`;
  const fromClause=ids?`FROM selected_times st JOIN transit_trips t ON t.mode='live' AND t.id=st.trip_id`:
    `FROM selected_trips t JOIN LATERAL (
      SELECT * FROM transit_stop_times st WHERE st.mode=${stopTimesMode("$1::text")} AND st.trip_id=t.id ORDER BY sequence LIMIT 1
    ) st ON true`;
  const {rows}=await pool.query(`${selected}
    SELECT st.data AS timing,st.departure_seconds,t.id AS trip_id,t.data AS trip,c.data AS calendar,s.data AS stop,r.data AS route
    ${fromClause}
    JOIN transit_stops s ON s.mode='live' AND s.id=st.stop_id
    JOIN transit_routes r ON r.mode=t.mode AND r.id=(t.agency||':'||(t.data->>'route_id'))
    LEFT JOIN transit_calendars c ON c.mode=t.mode AND c.id=(t.agency||':'||(t.data->>'service_id'))
    WHERE t.mode='live' AND t.agency=$1 AND ($2::text IS NULL OR t.data->>'route_id'=$2)
      AND st.departure_seconds>=0 AND (($1 NOT LIKE 'odpt-%' AND $1 NOT LIKE 'mobility-%' AND $1<>'wmata') OR COALESCE(st.data->>'pickup_type','0') NOT IN ('1','2','3')) AND ($1<>'amtrak' OR (COALESCE(st.data->>'pickup_type','0')<>'1'
        AND st.sequence < (SELECT max(last_call.sequence) FROM transit_stop_times last_call
          WHERE last_call.mode=st.mode AND last_call.trip_id=st.trip_id)))`,
    ids?[agency,rawRoute,ids]:[agency,rawRoute]);
  const {rows:ex}=await pool.query("SELECT data FROM transit_calendar_exceptions WHERE mode='live' AND agency=$1 AND data->>'date'=$2",[agency,serviceDate]);
  const exceptions=new Map<string,Record<string,string>[]>();
  for(const {data} of ex){const arr=exceptions.get(data.service_id)||[];arr.push(data);exceptions.set(data.service_id,arr);}
  const fromAt=agency==="amtrak"?serviceInstant(serviceDate,Number(from.slice(0,2))*3600+Number(from.slice(3))*60,ZONE):
    date.set({hour:Number(from.slice(0,2)),minute:Number(from.slice(3))}).toMillis();
  const departures=rows.filter(row=>matchesPattern(row.trip,p.direction)&&activeService(row.calendar,exceptions.get(row.trip.service_id)||[],serviceDate))
    .map(row=>({id:`${row.trip_id}:${serviceDate}:${row.timing.stop_sequence}`,tripId:row.trip_id,stopId:row.stop.id,stopName:row.stop.name,
      routeId:row.route.id,routeName:row.route.name,destination:(odpt||mobility?row.timing.stop_headsign:undefined)||row.trip.trip_headsign||"See route direction",direction:patternLabel(row.trip),
      time:new Date(serviceInstant(serviceDate,row.departure_seconds,row.trip.agency_timezone||ZONE)).toISOString(),
      ...(odpt||mobility?{timezone:zone}:{}),...(agency==="amtrak"?{trainNumber:row.trip.trip_short_name,timezone:row.stop.stop_timezone||row.trip.agency_timezone,
        runId:scheduledRunId(row.trip_id,serviceDate)}:{})}))
    .filter(row=>Date.parse(row.time)>=fromAt)
    .sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.tripId.localeCompare(b.tripId));
  return {...empty,departures:departures.slice(offset,offset+limit),total:departures.length,
    ...(agency==="amtrak"?{message:"Published Amtrak service-day timetable. Date and From use the agency timezone America/New_York; departures display in each station's local timezone with the local date. At western stations a service day's departures can fall on the preceding local date; multi-day runs can depart on later dates. Not live predictions. Shared-operator portions, Thruway buses and other agencies are excluded."}:{})};
}
