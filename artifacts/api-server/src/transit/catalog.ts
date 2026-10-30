import { db, pool, routes } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { allStops } from "./service";
import { activeService, serviceInstant, ZONE } from "./time";
import type { Mode, TransitRoute } from "./types";
import { GetCatalogQueryParams, GetTimetableQueryParams } from "@workspace/api-zod";
import type { z } from "zod";
import { stopTimesMode } from "./generations";
import { intercityCatalog, intercityTimetable } from "./intercity/service";
import { scheduledRunId } from "./amtrak-service";
import { isIbgId } from "./intercity/ibg-model";
import { ibgTimetable } from "./intercity/ibg-browse";
import { isTransitland } from "./transitland/model";
import { discover, unique } from "./transitland/discovery";
import { globalTimetable } from "./transitland/departures";
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
  const match=(r:TransitRoute)=> (!p.agency||r.id.split(":")[0]===p.agency||r.agencyId===p.agency)&&
    (!p.type||p.type==="all"||r.type===p.type)&&(!p.serviceClass||p.serviceClass==="all"||r.serviceClass===p.serviceClass);
  const extra=mode==="live"?(await intercityCatalog()).routes:[];
  const importedRoutes=[...(await db.select().from(routes).where(eq(routes.mode,mode))).map(r=>r.data as TransitRoute),...extra];
  const rr=importedRoutes
    .filter(r=>match(r)&&(!q||`${r.name} ${r.longName||""} ${r.agency}`.toLowerCase().includes(q)))
    .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const ss=(await allStops(mode)).filter(s=>!s.parent&&s.routes.some(match)&&
    (!q||s.name.toLowerCase().includes(q)||s.routes.some(r=>match(r)&&`${r.name} ${r.longName||""}`.toLowerCase().includes(q))))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const foreign=mode==="live"&&(q||p.agency?.startsWith("tl:"))?await discover({...p,lat:undefined,lon:undefined},importedRoutes):undefined;
  const combinedRoutes=unique([...rr,...(foreign?.routes||[])]),combinedStops=unique([...ss,...(foreign?.stops||[])]);
  return {routes:combinedRoutes.slice(offset,offset+limit),stops:combinedStops.slice(offset,offset+limit),
    totalRoutes:combinedRoutes.length,totalStops:combinedStops.length,offset,limit,globalCoverage:foreign?.globalCoverage};
}

export async function timetable(p:TimetableParams) {
  const date=DateTime.fromISO(p.date,{zone:ZONE}),from=p.from||"00:00";
  if(!date.isValid||date.toISODate()!==p.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(from))throw new Error("Invalid timetable date or time");
  if(!p.stopId&&!p.routeId)throw new Error("Select a stop or route");
  if(p.mode!=="demo"&&(isTransitland(p.stopId)||isTransitland(p.routeId)))return globalTimetable(p);
  if(p.mode!=="demo"&&(isIbgId(p.stopId)||isIbgId(p.routeId))){
    if(p.stopId&&p.routeId&&(!isIbgId(p.stopId)||!isIbgId(p.routeId)||p.stopId.split(":")[1]!==p.routeId.split(":")[1]))
      throw new Error("Stop and route must belong to the same operator");
    return ibgTimetable(p);
  }
  if(p.mode!=="demo"&&[p.stopId,p.routeId].some(id=>id&&/^(martz|transbridge|nj-transit):/.test(id))){
    if(p.stopId&&p.routeId&&p.stopId.split(":")[0]!==p.routeId.split(":")[0])throw new Error("Stop and route must belong to the same operator");
    return intercityTimetable(p);
  }
  const offset=p.offset||0,limit=p.limit||40,serviceDate=date.toFormat("yyyyMMdd");
  const empty={departures:[],total:0,offset,limit,date:p.date,message:"Published service-day timetable · America/New_York. Overnight departures may fall on the following calendar day; not live predictions."};
  if(p.mode==="demo")return {...empty,message:"Published timetables are available in Live mode only. Demo arrivals are illustrative."};
  const agency=(p.stopId||p.routeId)!.split(":")[0];
  if(p.stopId&&p.routeId&&p.routeId.split(":")[0]!==agency)throw new Error("Stop and route must belong to the same operator");
  const {rows:health}=await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`${agency}:static`]);
  const published=health[0]?.data;
  if(published?.serviceEnd&&serviceDate>published.serviceEnd||published?.serviceStart&&serviceDate<published.serviceStart)
    return {...empty,message:`No current timetable for this date: the imported agency feed covers ${published.serviceStart}–${published.serviceEnd}. Check the operator's current schedules and the source link in Settings. Old departure times are never shifted to pretend they are current.`};
  const all=await allStops("live"), stop=p.stopId?all.find(s=>s.id===p.stopId):undefined;
  if(p.stopId&&!stop)return {...empty,message:"This stop is not imported. Check coverage in Settings."};
  const ids=stop?[stop.id,...all.filter(s=>s.parent===stop.rawId&&s.id.startsWith(agency+":")).map(s=>s.id)]:null;
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
      AND st.departure_seconds>=0 AND ($1<>'amtrak' OR (COALESCE(st.data->>'pickup_type','0')<>'1'
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
      routeId:row.route.id,routeName:row.route.name,destination:row.trip.trip_headsign||"See route direction",direction:patternLabel(row.trip),
      time:new Date(serviceInstant(serviceDate,row.departure_seconds,row.trip.agency_timezone||ZONE)).toISOString(),
      ...(agency==="amtrak"?{trainNumber:row.trip.trip_short_name,timezone:row.stop.stop_timezone||row.trip.agency_timezone,
        runId:scheduledRunId(row.trip_id,serviceDate)}:{})}))
    .filter(row=>Date.parse(row.time)>=fromAt)
    .sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.tripId.localeCompare(b.tripId));
  return {...empty,departures:departures.slice(offset,offset+limit),total:departures.length,
    ...(agency==="amtrak"?{message:"Published Amtrak service-day timetable. Date and From use the agency timezone America/New_York; departures display in each station's local timezone with the local date. At western stations a service day's departures can fall on the preceding local date; multi-day runs can depart on later dates. Not live predictions. Shared-operator portions, Thruway buses and other agencies are excluded."}:{})};
}
