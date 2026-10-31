import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { db, feedSnapshots } from "@workspace/db";
import { adapters, alertUrl } from "./adapters";
import { logger } from "../lib/logger";
import type { TransitAlert } from "./types";
import { busRequestUrl, matchBusTrips } from "./bus-time";
import { officialAlert } from "./official-alert";
import { normalizeCtRealtime } from "./ct-realtime";
import { amtrakPositions } from "./amtrak-live";
import type { TransitVehicle } from "./types";
import {matchVehicleTrips} from "./vehicle-trips";
import {trackedVehicleId} from "./vehicle-catalog";
import { odptSource, odptEnabled } from "./odpt/registry";
import { odptFetch,verifyRealtimeAccess } from "./odpt/client";
import { matchOdptRealtime } from "./odpt/realtime";
import { alerts as wmataAlerts } from "./wmata/realtime";
import { isMobility } from "./mobility/model";
import { download as mobilityDownload } from "./mobility/download";
import { matchRealtime as matchMobility } from "./mobility/realtime";
import { enabled as mobilityEnabled } from "./mobility/client";
export interface LiveFeed { timestamp:number; fetchedAt:number; entities:any[]; error?:string }
const cache=new Map<string,LiveFeed>(), inflight=new Map<string,Promise<void>>();
export const FRESH_MS=60_000;
export function fresh(feed:LiveFeed,now=Date.now()) {return !feed.error && now-feed.timestamp*1000<=FRESH_MS && feed.timestamp*1000<=now+30000;}
export async function pollFeed(url:string,agency:string) {
  if(inflight.has(url))return inflight.get(url);
  const task=(async()=>{
    try {
      if(isMobility(agency)&&!mobilityEnabled()){cache.delete(url);return;}
      const odpt=odptSource(agency);
      if(odpt&&!odptEnabled()){cache.delete(url);return;}
      const odptVersion=odpt?await verifyRealtimeAccess(odpt,url):undefined;
      const response=isMobility(agency)?new Response(new Uint8Array(await mobilityDownload(url,5*1024*1024))):odpt?new Response(new Uint8Array(await odptFetch(url,odpt,"realtime",60000))):await fetch(busRequestUrl(url),{signal:AbortSignal.timeout(15000),redirect:"error"});
      if(!response.ok)throw new Error(`Feed HTTP ${response.status}`);
      const data=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
      if(agency==="cttransit")normalizeCtRealtime(data.entity);
      if(agency==="mta-bus"&&url.endsWith("/tripUpdates"))await matchBusTrips(data.entity);
      if(agency==="mta-mnr"||agency==="mta-lirr")await matchVehicleTrips(data.entity,agency);
      if(odpt)data.entity=await matchOdptRealtime(data.entity,agency,Date.now(),odptVersion);
      if(isMobility(agency))data.entity=await matchMobility(data.entity,agency);
      const f:LiveFeed={timestamp:Number(data.header.timestamp),fetchedAt:Date.now(),entities:data.entity};
      cache.set(url,f);
      const snapshot={feedTimestamp:f.timestamp,fetchedAt:new Date(f.fetchedAt).toISOString(),fresh:fresh(f),entities:f.entities};
      await db.insert(feedSnapshots).values({id:url,agency,mode:"live",data:snapshot})
        .onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data:snapshot,updatedAt:new Date()}});
    }catch(err){
      const old=cache.get(url);
      cache.set(url,{timestamp:old?.timestamp||0,fetchedAt:Date.now(),entities:old?.entities||[],error:"Official feed unavailable"});
      logger.warn({agency},"Official transit feed unavailable; live predictions withheld");
    }
  })().finally(()=>inflight.delete(url));
  inflight.set(url,task);
  return task;
}
export async function pollRealtime() {
  const jobs=adapters.flatMap(a=>a.realtimeUrls.map(u=>({u,a:a.id}))).concat([{u:alertUrl,a:"mta-alerts"}]);
  // Small concurrency keeps feed access predictable.
  for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(j=>pollFeed(j.u,j.a)));
}
export function feedsFor(agency:string) {
  if(isMobility(agency)&&!mobilityEnabled())return [];
  if(odptSource(agency)&&!odptEnabled())return [];
  return (adapters.find(a=>a.id===agency)?.realtimeUrls||[]).map(u=>cache.get(u)).filter((f):f is LiveFeed=>!!f);
}
export function feedStatus(agency:string) {
  const feeds=feedsFor(agency);
  const ok=feeds.filter(f=>fresh(f));
  return {fresh:ok.length,total:adapters.find(a=>a.id===agency)?.realtimeUrls.length||0,
    updatedAt:feeds.length?new Date(Math.max(...feeds.map(f=>f.timestamp))*1000).toISOString():null};
}
/** Fresh feed headers do not make an old per-vehicle observation fresh. */
export function freshVehicle(timestamp: number, now = Date.now()) {
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp * 1000 <= FRESH_MS && timestamp * 1000 <= now + 30000;
}
export function mapVehicles(mode: "live" | "demo" = "live"):TransitVehicle[] {
  if (mode === "demo") return [];
  const vehicles = new Map<string, TransitVehicle>();
  for (const agency of adapters) for (const f of feedsFor(agency.id)) {
    if (!fresh(f)) continue;
    for (const e of f.entities) {
      const v = e.vehicle, pos = v?.position, timestamp = Number(v?.timestamp);
      if (!pos || !freshVehicle(timestamp) ||
        !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude) ||
        Math.abs(pos.latitude) > 90 || Math.abs(pos.longitude) > 180) continue;
      if(pos.latitude===0&&pos.longitude===0)continue;
      const id = trackedVehicleId(agency.id,e);
      const routeId=v.trip?.routeId?`${agency.id}:${v.trip.routeId}`:undefined;
      // Fresh GPS remains useful even if line identity cannot be verified.
      // In particular, Metro-North realtime trip IDs can differ from static
      // GTFS IDs. Label the operator; never guess a branch from train numbers.
      const item = { id, routeId,agencyId:agency.id, lat: pos.latitude, lon: pos.longitude,
        routeName:routeId?undefined:agency.id==="mta-mnr"?"MNR":agency.id==="mta-lirr"?"LIRR":agency.name,
        source: `${agency.name} · official live vehicle${routeId?"":` · line unresolved${v.trip?.tripId?` · reported trip ${v.trip.tripId}`:""}`}`, updatedAt: new Date(timestamp * 1000).toISOString() };
      if (!vehicles.has(id) || vehicles.get(id)!.updatedAt < item.updatedAt) vehicles.set(id, item);
    }
  }
   return [...vehicles.values(),...amtrakPositions()];
}
/** Subway/rail feeds often provide a reported station, not GPS coordinates.
 * Never turn timetable predictions into vehicle locations. */
export function reportedStopVehicles(mode:"live"|"demo"="live"){
  const reports=new Map<string,{id:string;routeId:string;stopId:string;currentStatus:number;source:string;updatedAt:string;agencyId:string}>();
  if(mode==="demo")return [];
  for(const agency of adapters)for(const feed of feedsFor(agency.id)){
    if(!fresh(feed))continue;
    for(const entity of feed.entities){
      const v=entity.vehicle,timestamp=Number(v?.timestamp),p=v?.position;
      if(!v?.stopId||!v.trip?.routeId||!freshVehicle(timestamp))continue;
      if(p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&(p.latitude!==0||p.longitude!==0))continue;
      const id=trackedVehicleId(agency.id,entity);
      const report={id,routeId:`${agency.id}:${v.trip.routeId}`,stopId:`${agency.id}:${v.stopId}`,
        currentStatus:Number(v.currentStatus),source:agency.name,updatedAt:new Date(timestamp*1000).toISOString(),agencyId:agency.id};
      if(!reports.has(id)||reports.get(id)!.updatedAt<report.updatedAt)reports.set(id,report);
    }
  }
  return [...reports.values()];
}
export function liveAlerts():TransitAlert[] {
  const feeds=[{feed:cache.get(alertUrl),agency:undefined as string|undefined},
    ...["mta-bus","cttransit","odpt-sendai",...adapters.filter(a=>a.mobility).map(a=>a.id)].flatMap(agency=>feedsFor(agency).map(feed=>({feed,agency})))];
  const now=Date.now()/1000;
  const alerts=feeds.flatMap(({feed,agency})=> !feed||!fresh(feed)?[]:feed.entities.filter(e=>e.alert).filter(e=>{
    const periods=e.alert.activePeriod||[];
    return !periods.length||periods.some((p:any)=>(!p.start||Number(p.start)<=now)&&(!p.end||Number(p.end)>=now));
  }).map(e=>officialAlert(e,agency)));
  return [...new Map([...alerts,...wmataAlerts()].map(a=>[a.id,a])).values()];
}
