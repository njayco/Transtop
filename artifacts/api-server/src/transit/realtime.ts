import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { db, feedSnapshots } from "@workspace/db";
import { adapters, alertUrl } from "./adapters";
import { logger } from "../lib/logger";
import type { TransitAlert } from "./types";
export interface LiveFeed { timestamp:number; fetchedAt:number; entities:any[]; error?:string }
const cache=new Map<string,LiveFeed>(), inflight=new Map<string,Promise<void>>();
export const FRESH_MS=60_000;
export function fresh(feed:LiveFeed,now=Date.now()) {return !feed.error && now-feed.timestamp*1000<=FRESH_MS && feed.timestamp*1000<=now+30000;}
export async function pollFeed(url:string,agency:string) {
  if(inflight.has(url))return inflight.get(url);
  const task=(async()=>{
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:"error"});
      if(!response.ok)throw new Error(`Feed HTTP ${response.status}`);
      const data=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
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
  return (adapters.find(a=>a.id===agency)?.realtimeUrls||[]).map(u=>cache.get(u)).filter((f):f is LiveFeed=>!!f);
}
export function feedStatus(agency:string) {
  const feeds=feedsFor(agency);
  const ok=feeds.filter(f=>fresh(f));
  return {fresh:ok.length,total:adapters.find(a=>a.id===agency)?.realtimeUrls.length||0,
    updatedAt:feeds.length?new Date(Math.max(...feeds.map(f=>f.timestamp))*1000).toISOString():null};
}
const text=(t:any)=>t?.translation?.find((x:any)=>x.language==="en")?.text||t?.translation?.[0]?.text||"";
export function liveAlerts():TransitAlert[] {
  const feed=cache.get(alertUrl); if(!feed||!fresh(feed))return [];
  const now=Date.now()/1000;
  return feed.entities.filter(e=>e.alert).filter(e=>{
    const periods=e.alert.activePeriod||[];
    return !periods.length||periods.some((p:any)=>(!p.start||Number(p.start)<=now)&&(!p.end||Number(p.end)>=now));
  }).map(e=>{
    const a=e.alert;
    return {id:"mta-alert:"+e.id,title:text(a.headerText),description:text(a.descriptionText),severity:a.effect===1?"disruption":a.effect===3?"delay":"notice",
      routeIds:(a.informedEntity||[]).filter((i:any)=>i.routeId).map((i:any)=>{
        const ag=i.agencyId==="LI"?"mta-lirr":i.agencyId==="MNR"?"mta-mnr":"mta-subway";
        return `${ag}:${i.routeId}`;
      }),source:"Live agency data"};
  });
}
