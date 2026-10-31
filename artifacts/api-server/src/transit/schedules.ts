import { pool } from "@workspace/db";
import { activeService, serviceDates, serviceInstant } from "./time";
import type { Arrival, TransitStop } from "./types";
import { stopTimesMode } from "./generations";
import { tripIdentity } from "./bus-time";
import { odptEnabled } from "./odpt/registry";
export async function scheduledArrivals(stop:TransitStop,excluded:Set<string>,now=Date.now()):Promise<Arrival[]> {
  const prefix=stop.id.split(":")[0], raw=stop.rawId||stop.id.slice(prefix.length+1);
  if(stop.odpt&&!odptEnabled())return [];
  const children=(prefix==="wmata"&&stop.wmata?.kind==="station"||stop.mobility&&!stop.parent)?
    (await pool.query("SELECT id,data FROM transit_stops WHERE mode='live' AND agency=$1 AND data->>'parent_station'=$2",[prefix,raw])).rows:[];
  const ids=prefix==="wmata"||stop.mobility?[stop.id,...children.map(c=>c.id)]:stop.parent||stop.odpt?[stop.id]:[stop.id,`${prefix}:${raw}N`,`${prefix}:${raw}S`];
  const {rows}=await pool.query(`
    SELECT st.data AS timing, st.arrival_seconds, t.id AS trip_id, t.data AS trip, c.data AS calendar
    FROM transit_stop_times st
    JOIN transit_trips t ON t.mode='live' AND t.id=st.trip_id
    LEFT JOIN transit_calendars c ON c.mode=t.mode AND c.id=($2 || ':' || (t.data->>'service_id'))
    WHERE st.mode=${stopTimesMode("$2::text")} AND st.stop_id=ANY($1::text[])`,[ids,prefix]);
  const {rows:ex}=await pool.query("SELECT data FROM transit_calendar_exceptions WHERE mode='live' AND agency=$1",[prefix]);
  const zone=stop.mobility?.timezone||stop.odpt?.timezone||stop.wmata?.timezone;
  const dates=serviceDates(now,zone), result:Arrival[]=[];
  for(const row of rows) {
    if(row.arrival_seconds<0)continue;
    if((stop.mobility||stop.odpt||prefix==="wmata")&&["1","2","3"].includes(row.timing.pickup_type))continue;
    if(excluded.has(row.trip_id)||excluded.has(`${row.trip_id}|${row.timing.stop_id}`)||
      excluded.has(tripIdentity(row.trip_id)!)||excluded.has(`${tripIdentity(row.trip_id)}|${row.timing.stop_id}`))continue;
    const route=stop.routes.find(r=>r.id===`${prefix}:${row.trip.route_id}`);
    if(!route)continue;
    for(const date of dates) {
      if((prefix==="wmata"||stop.mobility)&&(excluded.has(`${row.trip_id}|date:${date}`)||excluded.has(`${row.trip_id}|${row.timing.stop_id}|date:${date}`)))continue;
      if(stop.odpt&&(date<stop.odpt.validFrom.replaceAll("-","")||date>stop.odpt.validThrough.replaceAll("-","")))continue;
      if(!activeService(row.calendar,ex.map(e=>e.data).filter(e=>e.service_id===row.trip.service_id),date))continue;
      const at=serviceInstant(date,Number(row.timing.departure_time?row.timing.departure_time.split(":").reduce((n:number,v:string)=>n*60+Number(v),0):row.arrival_seconds),zone);
      if(at<now-30000||at>now+2*3600000)continue;
      // Legacy arrival direction values are consumed by Ride's trip selection.
      // Actual destinations remain in destination and full timetable patterns.
      const direction=stop.mobility||stop.odpt||prefix==="wmata"?(row.timing.stop_headsign||row.trip.trip_headsign||`Direction ${row.trip.direction_id||"not supplied"}`):
        stop.type==="rail"?(row.trip.direction_id==="1"?"Inbound":"Outbound"):(row.trip.direction_id==="1"?"Downtown":"Uptown");
      result.push({id:`scheduled:${row.trip_id}:${date}:${row.timing.stop_id}`,routeId:route.id,routeName:route.name,color:route.color,direction,
        destination:(stop.odpt?row.timing.stop_headsign:undefined)||row.trip.trip_headsign||direction,minutes:Math.max(0,Math.ceil((at-now)/60000)),source:"scheduled",
        updatedAt:stop.updatedAt,status:"Scheduled · not a live prediction",scheduledAt:new Date(at).toISOString(),tripId:row.trip_id,
        ...(prefix==="wmata"?{platform:children.find(c=>c.id===`${prefix}:${row.timing.stop_id}`)?.data.name||stop.wmata?.platform}:{}),...(zone?{timezone:zone}:{})});
    }
  }
  return result.sort((a,b)=>a.minutes-b.minutes).slice(0,24);
}
