import { pool } from "@workspace/db";
import type { TransitRoute, TransitStop, RouteDetail } from "../types";
import { idfmEnabled, IDFM_ZONE, isIdfm, expiredEdition } from "./model";
import { serviceInstant } from "../time";
import { DateTime } from "luxon";
import type { Bounds } from "../map-geometry";
import { simplify } from "../map-geometry";
import { stopTimesMode } from "../generations";

type Filters={q?:string;type?:string;agency?:string;serviceClass?:string;lat?:number;lon?:number;routeId?:string};
const routeFilter=`($2::text IS NULL OR r->>'type'=$2) AND ($3::text IS NULL OR r->>'serviceClass'=$3)`;
export function enabledFor(p:Filters){return idfmEnabled()&&(!p.agency||p.agency==="idfm");}
export function filterArgs(p:Filters){return [p.q?.trim().toLowerCase()||"",p.type&&p.type!=="all"?p.type:null,p.serviceClass&&p.serviceClass!=="all"?p.serviceClass:null];}
export async function findStops(p:Filters,bounds?:Bounds,limit=80,offset=0){
  if(!enabledFor(p))return {stops:[] as TransitStop[],total:0};
  const args=filterArgs(p);
  const {rows}=await pool.query(`SELECT data,count(*) OVER()::int AS total FROM transit_stops s
    WHERE mode='live' AND agency='idfm' AND COALESCE(data->>'location_type','') IN ('0','1','')
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'routes') r WHERE ${routeFilter} AND ($12::text IS NULL OR r->>'id'=$12))
      AND ($1='' OR lower(data->>'name') LIKE '%'||$1||'%' OR EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(data->'searchNames','[]')) n WHERE lower(n) LIKE '%'||$1||'%') OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(data->'routes') r WHERE lower(r->>'name')=$1 OR lower(r->>'longName') LIKE '%'||$1||'%'))
      AND ($4::float IS NULL OR (data->>'lat')::float BETWEEN $4 AND $5 AND (data->>'lon')::float BETWEEN $6 AND $7)
    ORDER BY CASE WHEN $8::float IS NOT NULL THEN ((data->>'lat')::float-$8)^2+((data->>'lon')::float-$9)^2 END,
      data->>'name',id LIMIT $10 OFFSET $11`,
    [...args,bounds?.south??null,bounds?.north??null,bounds?.west??null,bounds?.east??null,p.lat??null,p.lon??null,Math.min(limit,500),offset,p.routeId||null]);
  return {stops:rows.map(r=>r.data as TransitStop),total:rows[0]?.total||0};
}
export async function findRoutes(p:Filters,limit=80,offset=0){
  if(!enabledFor(p))return {routes:[] as TransitRoute[],total:0};
  const {rows}=await pool.query(`SELECT data,count(*) OVER()::int AS total FROM transit_routes
    WHERE mode='live' AND agency='idfm' AND ($1='' OR lower(data->>'name') LIKE '%'||$1||'%' OR lower(data->>'longName') LIKE '%'||$1||'%'
      OR lower(data->>'agency') LIKE '%'||$1||'%' OR EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(data->'searchNames','[]')) n WHERE lower(n) LIKE '%'||$1||'%'))
    AND ($2::text IS NULL OR data->>'type'=$2) AND ($3::text IS NULL OR data->>'serviceClass'=$3)
    ORDER BY data->>'name',id LIMIT $4 OFFSET $5`,[...filterArgs(p),Math.min(limit,500),offset]);
  return {routes:rows.map(r=>r.data as TransitRoute),total:rows[0]?.total||0};
}
export async function directStop(id:string){
  if(!idfmEnabled()||!isIdfm(id))return;
  return (await pool.query("SELECT data FROM transit_stops WHERE mode='live' AND id=$1",[id])).rows[0]?.data as TransitStop|undefined;
}
// Never load IDFM shapes or stops into the legacy whole-network geometry cache.
const geometryCache=new Map<string,{at:number;shapes:{id:string;coordinates:number[][]}[]}>();
export async function routeShapes(routeId:string){
  const version=(await pool.query("SELECT data->>'stopTimesMode' AS version FROM transit_feed_snapshots WHERE mode='live' AND id='idfm:static'")).rows[0]?.version;
  const key=`${version}:${routeId}`,cached=geometryCache.get(key);
  if(cached&&Date.now()-cached.at<300_000)return cached.shapes;
  const {rows}=await pool.query(`WITH candidates AS MATERIALIZED(
    SELECT s.id,s.data->'coordinates' AS coordinates FROM transit_shapes s WHERE mode='live'
      AND id IN (SELECT DISTINCT 'idfm:'||(data->>'shape_id') FROM transit_trips
        WHERE mode='live' AND agency='idfm' AND data->>'route_id'=$1 AND data->>'shape_id'<>'') ORDER BY s.id LIMIT 64
    ), bounded AS(SELECT *,sum(jsonb_array_length(coordinates)) OVER(ORDER BY id) AS points FROM candidates)
    SELECT id,coordinates FROM bounded WHERE points<=120000 ORDER BY id`,[routeId.slice(5)]);
  const result=rows as {id:string;coordinates:number[][]}[];
  const cachedPoints=()=>[...geometryCache.values()].reduce((n,v)=>n+v.shapes.reduce((sum,s)=>sum+s.coordinates.length,0),0);
  const newPoints=result.reduce((sum,s)=>sum+s.coordinates.length,0);
  while(geometryCache.size&&(geometryCache.size>=64||cachedPoints()+newPoints>300000))geometryCache.delete(geometryCache.keys().next().value!);
  geometryCache.set(key,{at:Date.now(),shapes:result});return result;
}
export async function mapPage(p:Filters&{routeId?:string;zoom?:number},b:Bounds){
  const empty={lines:[] as {route:TransitRoute;shape:number[][];shapeId:string;vehicles:never[]}[],stops:[] as TransitStop[],
    missing:[] as TransitRoute[],truncated:false,totalStops:0};
  if(!enabledFor(p)||p.routeId&&!isIdfm(p.routeId))return empty;
  // Avoid even querying this regional source for unrelated world viewports.
  // This is a conservative regional envelope, not a stop-to-network identity rule.
  if(!p.routeId&&(b.east< -6||b.west>10||b.north<41||b.south>52))return empty;
  if(!p.routeId&&(b.east-b.west>2||b.north-b.south>2||(p.zoom??0)<11))return empty;
  const page=await findStops({...p,q:undefined},p.routeId?undefined:b,500);
  const candidates=p.routeId?(await pool.query("SELECT data FROM transit_routes WHERE mode='live' AND id=$1",[p.routeId])).rows.map(r=>r.data as TransitRoute):
    [...new Map(page.stops.flatMap(s=>s.routes).filter(r=>(!p.type||p.type==="all"||r.type===p.type)&&
      (!p.serviceClass||p.serviceClass==="all"||r.serviceClass===p.serviceClass)).map(r=>[r.id,r])).values()];
  let points=0;
  for(const r of candidates.slice(0,12)){
    const paths=await routeShapes(r.id);
    if(paths.length>=64||paths.reduce((n,s)=>n+s.coordinates.length,0)>=100000)empty.truncated=true;
    if(!paths.length)empty.missing.push(r);
    for(const path of paths){
      const shape=simplify(path.coordinates,.00002*2**Math.max(0,14-(p.zoom??14)));
      if(points+shape.length>40000||empty.lines.length>=64){empty.truncated=true;continue;}
      points+=shape.length;empty.lines.push({route:r,shape,shapeId:path.id,vehicles:[]});
    }
  }
  empty.stops=page.stops.filter(s=>!p.routeId||s.routes.some(r=>r.id===p.routeId));
  empty.totalStops=page.total;
  empty.truncated ||=page.total>500||candidates.length>12;
  return empty;
}

/** SQL calendar/exception selection precedes result transfer. All clocks are service-day based. */
export function servicePredicate(dateParam:string,weekdayParam:string){
  return `EXISTS(SELECT 1 FROM transit_calendar_exceptions e WHERE e.mode='live' AND e.agency='idfm'
      AND e.data->>'service_id'=t.data->>'service_id' AND e.data->>'date'=${dateParam} AND e.data->>'exception_type'='1')
    OR (EXISTS(SELECT 1 FROM transit_calendars c WHERE c.mode='live' AND c.id='idfm:'||(t.data->>'service_id')
      AND c.data->>'start_date'<=${dateParam} AND c.data->>'end_date'>=${dateParam} AND c.data->>${weekdayParam}='1')
    AND NOT EXISTS(SELECT 1 FROM transit_calendar_exceptions e WHERE e.mode='live' AND e.agency='idfm'
      AND e.data->>'service_id'=t.data->>'service_id' AND e.data->>'date'=${dateParam} AND e.data->>'exception_type'='2'))`;
}
type TimetableQuery={date:string;from?:string;stopId?:string;routeId?:string;direction?:string;offset?:number;limit?:number;afterMs?:number};
export async function parisTimetable(p:TimetableQuery){
  if(!p.stopId&&!p.routeId)throw new Error("A stop or route is required");
  const offset=p.offset||0,limit=p.limit||40,zone=IDFM_ZONE;
  const day=DateTime.fromISO(p.date,{zone}),from=p.from||"00:00";
  if(!day.isValid||day.toISODate()!==p.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(from))throw new Error("Invalid timetable date or time");
  if(p.stopId&&!isIdfm(p.stopId)||p.routeId&&!isIdfm(p.routeId))throw new Error("Stop and route must belong to the same operator");
  const date=day.toFormat("yyyyMMdd"),weekday=day.setLocale("en").toFormat("cccc").toLowerCase();
  const empty={departures:[] as {id:string;tripId:string;stopId:string;stopName:string;routeId:string;routeName:string;destination:string;direction:string;time:string;timezone:string}[],
    total:0,offset,limit,date:p.date,timezone:zone,message:`Published schedules only · ${zone}. GTFS service date; overnight calls can fall on the following day. Untimed, restricted and frequency-template clocks are withheld.`};
  if(!idfmEnabled())return {...empty,message:"IDFM is disabled or public-use compliance awaits owner confirmation."};
  const health=(await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='idfm:static'")).rows[0]?.data;
  if(!health||expiredEdition(health)||date<health.serviceStart||date>health.serviceEnd)
    return {...empty,message:`No current IDFM timetable for this date. Imported service window: ${health?.serviceStart||"unknown"}–${health?.serviceEnd||"unknown"}. Expired feeds never supply current clocks.`};
  const base=serviceInstant(date,0,zone),fromAt=p.afterMs??day.set({hour:Number(from.slice(0,2)),minute:Number(from.slice(3)),second:0,millisecond:0}).toMillis();
  const selection=p.stopId?`WITH selected AS MATERIALIZED(
      SELECT st.* FROM transit_idfm_stop_times st WHERE st.mode=${stopTimesMode("$1::text")} AND st.stop_id IN(
        SELECT id FROM transit_stops WHERE mode='live' AND agency='idfm' AND
          (id=$2 OR data->>'parent'=substring($2 from 6)))
          AND st.departure_seconds >= $6 AND st.departure_seconds <= $10)
      SELECT st.*,t.data AS trip,r.data AS route,s.data AS stop,count(*) OVER()::int AS total FROM selected st
      JOIN transit_trips t ON t.mode='live' AND t.id=st.trip_id`:
    `SELECT st.*,t.data AS trip,r.data AS route,s.data AS stop,count(*) OVER()::int AS total
      FROM transit_trips t JOIN LATERAL(SELECT * FROM transit_idfm_stop_times st
        WHERE $2::text IS NULL AND st.mode=${stopTimesMode("$1::text")} AND st.trip_id=t.id ORDER BY sequence LIMIT 1) st ON true`;
  const {rows}=await pool.query(`${selection}
    JOIN transit_routes r ON r.mode='live' AND r.id='idfm:'||(t.data->>'route_id')
    JOIN transit_stops s ON s.mode='live' AND s.id=st.stop_id
    WHERE t.mode='live' AND t.agency='idfm' AND ($3::text IS NULL OR t.data->>'route_id'=$3)
      AND (${servicePredicate("$4","$5")}) AND NOT(t.data ? 'frequencies')
      AND st.departure_seconds >= $6 AND st.departure_seconds>=0 AND st.departure_seconds <= $10
      AND COALESCE(st.data->>'pickup_type','0')='0' AND COALESCE(st.data->>'timepoint','1')<>'0'
      AND COALESCE(st.data->>'start_pickup_drop_off_window','')=''
      AND ($7::text IS NULL OR COALESCE(NULLIF(t.data->>'direction_id',''),'?')||' · '||
        COALESCE(NULLIF(t.data->>'trip_headsign',''),'Direction unspecified')=$7)
    ORDER BY st.departure_seconds,t.id,st.sequence LIMIT $8 OFFSET $9`,
    ["idfm",p.stopId||null,p.routeId?.slice(5)||null,date,weekday,Math.ceil((fromAt-base)/1000),p.direction||null,limit,offset,
      p.afterMs?Math.ceil((p.afterMs+2*3600_000-base)/1000):72*3600]);
  empty.departures=rows.map(r=>({id:`${r.trip_id}:${date}:${r.sequence}`,tripId:r.trip_id,stopId:r.stop.id,stopName:r.stop.name,
    routeId:r.route.id,routeName:r.route.name,destination:r.data.stop_headsign||r.trip.trip_headsign||"Destination not supplied",
    direction:`${r.trip.direction_id||"?"} · ${r.trip.trip_headsign||"Direction unspecified"}`,
    time:new Date(base+r.departure_seconds*1000).toISOString(),timezone:zone}));
  empty.total=rows[0]?.total||0;
  if(health.frequencyRows){
    const {rows:windows}=await pool.query(`SELECT data->>'trip_headsign' AS headsign,data->'frequencies' AS frequency FROM transit_trips t
      WHERE mode='live' AND agency='idfm' AND data ? 'frequencies' AND ($1::text IS NULL OR data->>'route_id'=$1)
      AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM transit_idfm_stop_times st WHERE st.mode=${stopTimesMode("$3::text")} AND st.trip_id=t.id AND st.stop_id=$2))
      AND (${servicePredicate("$4","$5")}) LIMIT 20`,[p.routeId?.slice(5)||null,p.stopId||null,"idfm",date,weekday]);
    empty.message+=" "+windows.map(w=>`${w.headsign||"Frequency service"}: ${w.frequency.map((f:any)=>
      `${f.start_time}–${f.end_time}, every ${f.headway_secs} seconds (${f.exact_times==="1"?"exact repeating service":"approximate headway"} at trip origin; no invented stop clocks)`).join("; ")}`).join(". ");
  }
  return empty;
}
export async function parisArrivals(stop:TransitStop,now=Date.now()){
  const day=DateTime.fromMillis(now,{zone:IDFM_ZONE});
  const health=(await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='idfm:static'")).rows[0]?.data;
  const days=Math.min(3,Math.max(1,Math.floor((health?.maxDepartureSeconds||86400)/86400)));
  const tables=await Promise.all(Array.from({length:days+1},(_,i)=>i-days).map(d=>parisTimetable({stopId:stop.id,date:day.plus({days:d}).toISODate()!,afterMs:now-30000,limit:100})));
  return tables.flatMap(t=>t.departures).filter(d=>Date.parse(d.time)>=now-30000&&Date.parse(d.time)<=now+2*3600_000).map(d=>{
    const r=stop.routes.find(r=>r.id===d.routeId)!;
    return {id:"scheduled:"+d.id,routeId:d.routeId,routeName:d.routeName,color:r?.color||"#468AC4",direction:d.direction,destination:d.destination,
      minutes:Math.max(0,Math.ceil((Date.parse(d.time)-now)/60000)),source:"scheduled" as const,updatedAt:stop.updatedAt,
      status:"Scheduled · not a live prediction",scheduledAt:d.time,tripId:d.tripId,timezone:IDFM_ZONE,platform:stop.idfm?.platform};
  }).sort((a,b)=>a.minutes-b.minutes).slice(0,24);
}
export async function parisRoute(id:string,direction?:string):Promise<RouteDetail|undefined>{
  if(!idfmEnabled())return;
  const route=(await pool.query("SELECT data FROM transit_routes WHERE mode='live' AND id=$1",[id])).rows[0]?.data as TransitRoute|undefined;
  if(!route)return;
  const {rows:patterns}=await pool.query(`SELECT DISTINCT COALESCE(NULLIF(data->>'direction_id',''),'?')||' · '||
    COALESCE(NULLIF(data->>'trip_headsign',''),'Direction unspecified') AS label
    FROM transit_trips WHERE mode='live' AND agency='idfm' AND data->>'route_id'=$1 ORDER BY label LIMIT 80`,[id.slice(5)]);
  const directions=patterns.map(r=>r.label as string),selected=direction||directions[0];
  const {rows}=await pool.query(`SELECT t.id,t.data FROM transit_trips t WHERE mode='live' AND agency='idfm' AND data->>'route_id'=$1
    AND COALESCE(NULLIF(data->>'direction_id',''),'?')||' · '||
    COALESCE(NULLIF(data->>'trip_headsign',''),'Direction unspecified')=$2 ORDER BY id LIMIT 1`,[id.slice(5),selected]);
  const calls=rows[0]?(await pool.query(`SELECT s.data FROM transit_idfm_stop_times st JOIN transit_stops s ON s.mode='live' AND s.id=st.stop_id
    WHERE st.mode=${stopTimesMode("$1::text")} AND st.trip_id=$2 ORDER BY st.sequence LIMIT 501`,["idfm",rows[0].id])).rows:[];
  const shape=rows[0]?.data.shape_id?(await pool.query("SELECT data->'coordinates' AS points FROM transit_shapes WHERE mode='live' AND id=$1",
    ["idfm:"+rows[0].data.shape_id])).rows[0]?.points||[]:[];
  return {route:{...route,scheduleNotes:[...(route.scheduleNotes||[]),
    "One supplied trip pattern, at most 80 destination patterns and 500 calls. Other branches may exist. Missing geometry remains unknown."]},
    stops:calls.slice(0,500).map(r=>r.data),shape,vehicles:[],alerts:[],directions};
}
