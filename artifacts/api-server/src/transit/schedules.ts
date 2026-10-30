import { pool } from "@workspace/db";
import { activeService, serviceDates, serviceInstant } from "./time";
import type { Arrival, TransitStop } from "./types";
import { stopTimesMode } from "./generations";
export async function scheduledArrivals(stop:TransitStop,excluded:Set<string>,now=Date.now()):Promise<Arrival[]> {
  const prefix=stop.id.split(":")[0], raw=stop.rawId||stop.id.slice(prefix.length+1);
  const ids=stop.parent?[stop.id]:[stop.id,`${prefix}:${raw}N`,`${prefix}:${raw}S`];
  const {rows}=await pool.query(`
    SELECT st.data AS timing, st.arrival_seconds, t.id AS trip_id, t.data AS trip, c.data AS calendar
    FROM transit_stop_times st
    JOIN transit_trips t ON t.mode='live' AND t.id=st.trip_id
    LEFT JOIN transit_calendars c ON c.mode=t.mode AND c.id=($2 || ':' || (t.data->>'service_id'))
    WHERE st.mode=${stopTimesMode("$2::text")} AND st.stop_id=ANY($1::text[])`,[ids,prefix]);
  const {rows:ex}=await pool.query("SELECT data FROM transit_calendar_exceptions WHERE mode='live' AND agency=$1",[prefix]);
  const dates=serviceDates(now), result:Arrival[]=[];
  for(const row of rows) {
    if(row.arrival_seconds<0)continue;
    if(excluded.has(row.trip_id)||excluded.has(`${row.trip_id}|${row.timing.stop_id}`))continue;
    const route=stop.routes.find(r=>r.id===`${prefix}:${row.trip.route_id}`);
    if(!route)continue;
    for(const date of dates) {
      if(!activeService(row.calendar,ex.map(e=>e.data).filter(e=>e.service_id===row.trip.service_id),date))continue;
      const at=serviceInstant(date,Number(row.timing.departure_time?row.timing.departure_time.split(":").reduce((n:number,v:string)=>n*60+Number(v),0):row.arrival_seconds));
      if(at<now-30000||at>now+2*3600000)continue;
      // Legacy arrival direction values are consumed by Ride's trip selection.
      // Actual destinations remain in destination and full timetable patterns.
      const direction=stop.type==="rail"?(row.trip.direction_id==="1"?"Inbound":"Outbound"):(row.trip.direction_id==="1"?"Downtown":"Uptown");
      result.push({id:`scheduled:${row.trip_id}:${date}:${row.timing.stop_id}`,routeId:route.id,routeName:route.name,color:route.color,direction,
        destination:row.trip.trip_headsign||direction,minutes:Math.max(0,Math.ceil((at-now)/60000)),source:"scheduled",
        updatedAt:stop.updatedAt,status:"Scheduled · not a live prediction",scheduledAt:new Date(at).toISOString(),tripId:row.trip_id});
    }
  }
  return result.sort((a,b)=>a.minutes-b.minutes).slice(0,24);
}
