import { pool } from "@workspace/db";
import { DateTime } from "luxon";
import { activeService } from "../time";
import { stopTimesMode } from "../generations";
import { odptEnabled } from "./registry";

export function observationFresh(value:unknown,now=Date.now()){
  const at=Number(value)*1000;
  return Number.isFinite(at)&&at>0&&at<=now+30000&&now-at<=60000;
}
/** No fuzzy IDs or route-name joins. Incompatible companions are withheld. */
export async function matchOdptRealtime(entities:any[],agency:string,now=Date.now(),version?:string){
  if(!odptEnabled())return [];
  const {rows:health}=await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`${agency}:static`]);
  const snapshot=health[0]?.data,today=DateTime.fromMillis(now,{zone:"Asia/Tokyo"}).toFormat("yyyyMMdd");
  if(!snapshot?.odpt||version&&version!==snapshot.odpt.version||today<snapshot.serviceStart||today>snapshot.serviceEnd)return [];
  const ids=[...new Set(entities.map(e=>e.tripUpdate?.trip?.tripId||e.vehicle?.trip?.tripId).filter(Boolean))].map(id=>`${agency}:${id}`);
  const [{rows:trips},{rows:timings},{rows:exceptions},{rows:routes}]=await Promise.all([
    pool.query(`SELECT t.id,t.data,c.data AS calendar FROM transit_trips t LEFT JOIN transit_calendars c
      ON c.mode='live' AND c.id=t.agency||':'||(t.data->>'service_id') WHERE t.mode='live' AND t.id=ANY($1::text[])`,[ids]),
    pool.query(`SELECT trip_id,sequence,data FROM transit_stop_times WHERE mode=${stopTimesMode("$2::text")} AND trip_id=ANY($1::text[])`,[ids,agency]),
    pool.query("SELECT data FROM transit_calendar_exceptions WHERE mode='live' AND agency=$1",[agency]),
    pool.query("SELECT id FROM transit_routes WHERE mode='live' AND agency=$1",[agency]),
  ]);
  const tripMap=new Map(trips.map(t=>[t.id,t])),routeIds=new Set(routes.map(r=>r.id));
  const timingMap=new Map(timings.map(t=>[`${t.trip_id}|${t.data.stop_id}|${t.sequence}`,t.data]));
  const output=[];
  for(const e of entities.slice(0,5000)){
    if(e.alert){
      // Empty feeds are valid; notices must identify an approved static route.
      const selectors=e.alert.informedEntity||[];
      const matched=selectors.filter((v:any)=>v.routeId&&routeIds.has(`${agency}:${v.routeId}`));
      if(matched.length)output.push({...e,alert:{...e.alert,informedEntity:matched}});
      continue;
    }
    const item=e.tripUpdate||e.vehicle,trip=item?.trip,record=tripMap.get(`${agency}:${trip?.tripId}`);
    if(!trip||!record||trip.routeId!==record.data.route_id||!observationFresh(item.timestamp,now)||
      !/^\d{8}$/.test(trip.startDate||"")||trip.startDate<snapshot.serviceStart||trip.startDate>snapshot.serviceEnd||
      !activeService(record.calendar,exceptions.map(x=>x.data).filter(x=>x.service_id===record.data.service_id),trip.startDate))continue;
    if(e.tripUpdate){
      // Absolute event instants only. Delays without a matching published call are not predictions.
      const stopTimeUpdate=(item.stopTimeUpdate||[]).flatMap((st:any)=>{
        const timing=timingMap.get(`${record.id}|${st.stopId}|${st.stopSequence}`);
        if(!timing||timing.pickup_type==="1")return [];
        return [{...st,transtopHeadsign:timing.stop_headsign||record.data.trip_headsign}];
      });
      output.push({...e,tripUpdate:{...item,stopTimeUpdate,transtopHeadsign:record.data.trip_headsign}});
    }else{
      if(!timingMap.has(`${record.id}|${item.stopId}|${item.currentStopSequence}`))continue;
      output.push(e);
    }
  }
  const {rows:after}=await pool.query("SELECT data->>'stopTimesMode' AS generation FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`${agency}:static`]);
  return after[0]?.generation===snapshot.stopTimesMode?output:[];
}
