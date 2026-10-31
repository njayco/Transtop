import { randomUUID } from "node:crypto";
import GtfsRealtime from "gtfs-realtime-bindings";
import { pool } from "@workspace/db";
import { stopTimesMode } from "../generations";
import type { Arrival, TransitAlert, TransitStop } from "../types";
import { download, setupStatus, WmataError, type Operation } from "./client";
import { current, normalizePredictions, normalizeAlerts, applies, type StaticCatalog } from "./model";

export interface Feed {timestamp:number;fetchedAt:number;entities:any[];error?:string;state:string;nextPoll:number;alerts?:TransitAlert[]}
const cache=new Map<Operation,Feed>(),pending=new Map<Operation,Promise<void>>();
let catalogCache:{at:number;catalog:StaticCatalog}|undefined;
async function catalog(entities:any[]=[]):Promise<StaticCatalog>{
  if(!catalogCache||Date.now()-catalogCache.at>60000){
    const [stops,routes]=await Promise.all([
      pool.query("SELECT data FROM transit_stops WHERE mode='live' AND agency='wmata'"),
      pool.query("SELECT data FROM transit_routes WHERE mode='live' AND agency='wmata'")]);
    catalogCache={at:Date.now(),catalog:{stops:stops.rows.map(r=>r.data),routes:routes.rows.map(r=>r.data),trips:[]}};
  }
  const base=catalogCache.catalog;
  const tripIds=entities.flatMap(e=>e.tripUpdate?.trip?.tripId?[e.tripUpdate.trip.tripId]:[]);
  if(!tripIds.length)return base;
  const bases=tripIds.filter(id=>/^\d+_\d+$/.test(id)).map(id=>id.split("_")[0]);
  const {rows}=await pool.query(`SELECT id,data FROM transit_trips WHERE mode='live' AND agency='wmata'
    AND (id=ANY($1::text[]) OR data->>'scheduled_trip_id'=ANY($2::text[]))`,[tripIds.map(id=>`wmata:${id}`),bases]);
  const [calls,calendars,exceptions]=await Promise.all([
    pool.query(`SELECT trip_id,data FROM transit_stop_times WHERE mode=${stopTimesMode("'wmata'")} AND trip_id=ANY($1::text[]) ORDER BY trip_id,sequence`,[rows.map(r=>r.id)]),
    pool.query("SELECT data FROM transit_calendars WHERE mode='live' AND agency='wmata'"),
    pool.query("SELECT data FROM transit_calendar_exceptions WHERE mode='live' AND agency='wmata'")]);
  const byTrip=new Map<string,any[]>();
  for(const c of calls.rows){const list=byTrip.get(c.trip_id)||[];list.push(c.data);byTrip.set(c.trip_id,list);}
  return {...base,trips:rows.map(r=>({id:r.id,data:r.data,calls:byTrip.get(r.id)||[],
    calendar:calendars.rows.find(c=>c.data.service_id===r.data.service_id)?.data,
    exceptions:exceptions.rows.filter(c=>c.data.service_id===r.data.service_id).map(c=>c.data)}))};
}
async function poll(op:Operation){
  const previous=cache.get(op),now=Date.now();
  if(previous&&previous.nextPoll>now)return;
  const existing=pending.get(op);if(existing)return existing;
  const work=(async()=>{
    const shared=(await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`wmata:realtime:${op}`])).rows[0]?.data as Feed|undefined;
    if(shared&&shared.nextPoll>now){cache.set(op,shared);return;}
    const setup=setupStatus();
    if(setup!=="configured"){cache.set(op,{timestamp:0,fetchedAt:now,entities:[],state:setup,error:setup,nextPoll:now+30000});return;}
    const owner=randomUUID(),lease=`wmata:lease:${op}`;
    const locked=(await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
      VALUES('live',$1,'wmata',jsonb_build_object('owner',$2::text,'until',$3::bigint+45000))
      ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()
      WHERE (transit_feed_snapshots.data->>'until')::bigint<$3 RETURNING id`,[lease,owner,now])).rows.length;
    if(!locked){if(shared)cache.set(op,shared);return;}
    let result:Feed;
    try{
      const bytes=await download(op),decoded=GtfsRealtime.transit_realtime.FeedMessage.decode(bytes);
      const timestamp=Number(decoded.header.timestamp);
      if(!Number.isFinite(timestamp)||timestamp<=0||decoded.entity.length>15000||Number(decoded.header.incrementality||0)!==0)
        throw new WmataError("invalid","WMATA feed missing a valid full-dataset timestamp or exceeds record bounds");
      const predictions=op.endsWith("predictions"),mode=op.startsWith("bus")?"bus":"subway";
      const staticCatalog=await catalog(predictions?decoded.entity:[]);
      const entities=predictions?normalizePredictions(decoded.entity,staticCatalog,mode,timestamp):[];
      const alerts=predictions?undefined:normalizeAlerts(decoded.entity,staticCatalog,mode,timestamp);
      const stale=!current(timestamp,Date.now(),predictions?60000:180000);
      result={timestamp,fetchedAt:Date.now(),entities,alerts,state:stale?"stale":decoded.entity.length?"fresh":"empty",
        nextPoll:Date.now()+(predictions?30000:120000)};
    }catch(error){
      result={timestamp:shared?.timestamp||0,fetchedAt:Date.now(),entities:[],alerts:[],
        state:error instanceof WmataError?error.state:"invalid",
        error:error instanceof WmataError?error.message:"WMATA feed could not be validated; published schedules retained",
        nextPoll:Date.now()+60000};
    }
    try{
      cache.set(op,result);
      await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data) VALUES('live',$1,'wmata',$2)
        ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`,[`wmata:realtime:${op}`,result]);
    }finally{
      await pool.query("DELETE FROM transit_feed_snapshots WHERE mode='live' AND id=$1 AND data->>'owner'=$2",[lease,owner]);
    }
  })().finally(()=>pending.delete(op));
  pending.set(op,work);return work;
}
/** Requests originate only from rider views, never a per-instance timer.
 * Shared leases/cache prevent duplicate polling. Serial operations respect the
 * key's global spacing; busy operations become limited rather than retry loops.
 */
export async function refresh(types:("bus"|"subway")[],predictions=true){
  for(const mode of new Set(types)){
    const prefix=mode==="bus"?"bus":"rail";
    for(const op of [...(predictions?[`${prefix}-predictions`]:[]),`${prefix}-alerts`] as Operation[]){
      try{await poll(op);}catch{
        cache.set(op,{timestamp:0,fetchedAt:Date.now(),entities:[],error:"WMATA shared cache unavailable",state:"unavailable",nextPoll:Date.now()+60000});
      }
    }
  }
}
export function alerts(){
  if(setupStatus()!=="configured")return [];
  return [...cache.entries()].flatMap(([op,f])=>op.endsWith("alerts")&&!f.error&&current(f.timestamp,Date.now(),180000)?f.alerts||[]:[]);
}
export function state(op:Operation){
  const setup=setupStatus();if(setup!=="configured")return setup;
  const f=cache.get(op);return !f?"not checked":f.error?f.state:!current(f.timestamp,Date.now(),op.endsWith("alerts")?180000:60000)?"stale":f.state;
}
export async function sourceHealth(){
  const {rows}=await pool.query("SELECT id,data FROM transit_feed_snapshots WHERE mode='live' AND id LIKE 'wmata:realtime:%'");
  for(const row of rows)cache.set(row.id.slice("wmata:realtime:".length) as Operation,row.data);
  return (["bus-predictions","rail-predictions","bus-alerts","rail-alerts"] as Operation[]).map(op=>`${op}: ${state(op)}${cache.get(op)?.error?` (${cache.get(op)!.error})`:""}`).join("; ");
}
export function predictionArrivals(stop:TransitStop,feeds:Feed[],now=Date.now()){
  const rows:Arrival[]=[],excluded=new Set<string>(),unmatchedRoutes=new Set<string>();
  for(const feed of feeds){
    if(!feed||feed.error||!current(feed.timestamp,now))continue;
    for(const entity of feed.entities){
      const u=entity.tripUpdate,trip=u.trip,matched=u.transtopTripId as string|undefined;
      if(!current(Number(u.timestamp),now))continue;
      if([3,7].includes(Number(trip.scheduleRelationship))){if(matched)excluded.add(`${matched}|date:${trip.startDate}`);continue;}
      for(const s of u.stopTimeUpdate){
        if(s.stopId!==stop.rawId)continue;
        if(Number(s.scheduleRelationship)===1){if(matched)excluded.add(`${matched}|${s.stopId}|date:${trip.startDate}`);continue;}
        if(Number(s.scheduleRelationship)===2||s.transtopPickup==="1")continue;
        const time=Number(s.departure?.time||s.arrival?.time);
        if(!Number.isFinite(time)||time*1000<now-30000||time*1000>now+7200000)continue;
        const route=stop.routes.find(r=>r.id===`wmata:${trip.routeId}`);if(!route)continue;
        const destination=s.transtopHeadsign||u.transtopHeadsign||"Destination not supplied";
        if(!matched)unmatchedRoutes.add(route.id);
        rows.push({id:`wmata:live:${trip.tripId}:${trip.startDate}:${trip.startTime}:${s.stopId}`,routeId:route.id,
          routeName:route.name,color:route.color,destination,direction:destination,
          minutes:Math.max(0,Math.ceil((time*1000-now)/60000)),source:"live",
          scheduledAt:new Date(time*1000).toISOString(),updatedAt:new Date(Math.min(feed.timestamp,Number(u.timestamp))*1000).toISOString(),
          expiresAt:new Date(Math.min(feed.timestamp,Number(u.timestamp))*1000+60000).toISOString(),
          tripId:matched,timezone:"America/New_York",platform:stop.wmata?.platform||(stop.parent?stop.name:undefined),
          status:matched?"WMATA live prediction":"WMATA live prediction · scheduled trip unresolved"});
      }
    }
  }
  return {arrivals:rows.sort((a,b)=>a.minutes-b.minutes),excluded,unmatchedRoutes};
}
export function arrivals(stop:TransitStop,now=Date.now()){
  return predictionArrivals(stop,setupStatus()==="configured"?
    [...cache.entries()].filter(([op])=>op.endsWith("predictions")).map(([,f])=>f):[],now);
}
export function withStatus(stop:TransitStop):TransitStop{
  const types=new Set(stop.routes.map(r=>r.type));
  return {...stop,wmata:{...stop.wmata!,predictions:[...types].map(t=>`${t==="bus"?"Metrobus":"Metrorail"}: ${state(t==="bus"?"bus-predictions":"rail-predictions")}`).join("; "),
    alerts:[...types].map(t=>`${t==="bus"?"Metrobus":"Metrorail"}: ${state(t==="bus"?"bus-alerts":"rail-alerts")}`).join("; ")},
    alerts:alerts().filter(a=>applies(a,stop))};
}
