import type { Arrival, TransitRoute, TransitStop, TransitType, TflInfo } from "../types";
import { CREDIT, TERMS, COVERAGE } from "./client";

export const MODES=["bus","tube","dlr","elizabeth-line","overground"] as const;
export const isTfl=(id?:string)=>!!id?.startsWith("tfl:");
export const rawStop=(id:string)=>{
  if(!/^tfl:stop:[A-Za-z0-9]{5,40}$/.test(id))throw new Error("Invalid TfL identity");
  return id.slice(9);
};
export const rawLine=(id:string)=>{
  if(!/^tfl:line:[a-z0-9-]{1,60}$/.test(id))throw new Error("Invalid TfL identity");
  return id.slice(9);
};
export const typeFor=(mode:string):TransitType|undefined=>mode==="tube"?"subway":mode==="bus"?"bus":
  ["dlr","elizabeth-line","overground"].includes(mode)?"rail":undefined;
/** TfL can answer an exact boarding-point lookup with its parent cluster.
 * Traverse supplied relationships only; never substitute the cluster centroid or a sibling.
 */
export function stopRecords(raw:any):any[]{
  const result:any[]=[],queue:any[]=Array.isArray(raw)?raw.slice(0,120):Array.isArray(raw?.stopPoints)?raw.stopPoints.slice(0,120):[raw];
  for(let n=0;n<queue.length&&n<600;n++){
    const value=queue[n];if(!value||typeof value!=="object")continue;
    result.push(value);
    if(Array.isArray(value.children)&&queue.length<600)queue.push(...value.children.slice(0,Math.min(120,600-queue.length)));
  }
  return result;
}
export function findStopRecord(raw:any,id:string){
  return stopRecords(raw).find(s=>(s.naptanId||s.id)===id);
}
export function boardingPoints(raw:any){
  // Keep station-level rail arrivals grouped with their supplied platform fields.
  // Bus clusters/interchanges are relationships, not substitute boarding points.
  const roots=Array.isArray(raw)?raw.slice(0,120):Array.isArray(raw?.stopPoints)?raw.stopPoints.slice(0,120):[raw];
  const result:any[]=[],queue=[...roots];
  for(let n=0;n<queue.length&&n<600;n++){
    const value=queue[n];if(!value||typeof value!=="object")continue;
    if(["TransportInterchange","NaptanOnstreetBusCoachStopCluster"].includes(value.stopType)){
      if(Array.isArray(value.children)&&queue.length<600)queue.push(...value.children.slice(0,Math.min(120,600-queue.length)));
    }else result.push(value);
  }
  return result;
}
export function info(message=COVERAGE):TflInfo {
  return {status:"configured",message,attribution:CREDIT,url:TERMS,timezone:"Europe/London"};
}
export function line(raw:any):TransitRoute|undefined{
  const type=typeFor(raw?.modeName);
  if(!type||!(/^[a-z0-9-]{1,60}$/).test(raw?.id)||typeof raw.name!=="string")return;
  return {id:`tfl:line:${raw.id}`,name:raw.name.slice(0,150),type,color:"#427b91",
    agency:"Transport for London",agencyId:`tfl-${type}`,sourceUrl:TERMS,tfl:info(),
    scheduleNotes:[CREDIT,COVERAGE,"Route geometry is supplied by TfL, not a GPS track."]};
}
export function normalizeStop(raw:any,lines:TransitRoute[],now=Date.now()):TransitStop|undefined{
  const id=raw?.naptanId||raw?.id;
  if(!/^[A-Za-z0-9]{5,40}$/.test(id)||!Number.isFinite(raw.lat)||!Number.isFinite(raw.lon)||
    raw.lat<50.5||raw.lat>52.2||raw.lon< -1.1||raw.lon>0.8||typeof (raw.commonName||raw.name)!=="string")return;
  const ids=new Set((raw.lines||[]).slice(0,100).map((r:any)=>`tfl:line:${r.id}`));
  const rr=lines.filter(r=>ids.has(r.id));
  if(!rr.length)return;
  return {id:`tfl:stop:${id}`,rawId:id,name:(raw.commonName||raw.name).slice(0,200),lat:raw.lat,lon:raw.lon,
    type:rr[0].type,agency:"Transport for London",routes:rr,arrivals:[],alerts:[],distance:0,walkingMinutes:0,
    accessible:false,updatedAt:new Date(now).toISOString(),stop_timezone:"Europe/London",neighborhood:"London",
    tfl:{...info("Open this stop for official predictions. Accessibility is not confirmed."),platform:raw.indicator||raw.stopLetter,
      parentId:raw.parentId||raw.stationId}};
}
/** Require explicit UTC/offset timestamps; never interpret a suffixless time in server time. */
export function instant(value:unknown){
  if(typeof value!=="string"||!/(Z|[+-]\d\d:\d\d)$/.test(value))return NaN;
  return Date.parse(value);
}
export function prediction(p:any,stop:TransitStop,now=Date.now()):Arrival|undefined{
  const route=stop.routes.find(r=>r.id===`tfl:line:${p?.lineId}`);
  const observed=instant(p?.timestamp),expected=instant(p?.expectedArrival),ttl=instant(p?.timeToLive);
  if(!route||p.operationType===2||p.naptanId!==stop.rawId||!["string","number"].includes(typeof p.id)||
    !Number.isFinite(observed)||observed>now+30000||now-observed>90000||
    !Number.isFinite(expected)||expected<now||expected>now+7200000||
    !Number.isFinite(ttl)||ttl<=now||typeof p.destinationName!=="string"||!p.destinationName.trim())return;
  const expires=Math.min(ttl,observed+90000,expected);
  if(expires<=now)return;
  const platform=typeof p.platformName==="string"?p.platformName.slice(0,150):"";
  const direction=typeof p.direction==="string"?p.direction.slice(0,80):"Direction not supplied";
  return {id:`${stop.id}:${p.lineId}:${String(p.id).slice(0,100)}:${platform}:${direction}`,
    routeId:route.id,routeName:route.name,color:route.color,direction:platform?`${direction} · ${platform}`:direction,
    destination:p.destinationName.slice(0,200),minutes:Math.max(0,Math.ceil((expected-now)/60000)),
    source:"live",status:"TfL · official prediction",scheduledAt:new Date(expected).toISOString(),
    updatedAt:new Date(observed).toISOString(),expiresAt:new Date(expires).toISOString(),timezone:"Europe/London",platform};
}
/** Official Line/Meta/Severity codes, not description/reason keyword matching.
 * Verified against https://api.tfl.gov.uk/Line/Meta/Severity on 2026-10-31.
 * Only explicit delays and service disruptions qualify for Nearby. Special
 * service, access/frequency notices, issues reported, overnight Service Closed
 * (20), and unknown codes remain informational. No affected stops are inferred.
 */
function statusSeverity(code:unknown):"delay"|"disruption"|"info"{
  switch(code){
    case 6: // Severe Delays
    case 9: // Minor Delays
      return "delay";
    case 1: // Closed
    case 2: // Suspended
    case 3: // Part Suspended
    case 4: // Planned Closure
    case 5: // Part Closure
    case 7: // Reduced Service
    case 8: // Bus Service (replacement service)
    case 11: // Part Closed
    case 15: // Diverted
    case 16: // Not Running
      return "disruption";
    default:
      return "info";
  }
}
export function notices(raw:any[],now=Date.now()){
  return raw.slice(0,30).flatMap(r=>(Array.isArray(r.lineStatuses)?r.lineStatuses:[]).slice(0,30)
    .filter((s:any)=>s.statusSeverity!==10&&typeof s.statusSeverityDescription==="string"&&
      (!s.validityPeriods?.length||s.validityPeriods.some((v:any)=>v.isNow!==false&&
        Number.isFinite(instant(v.fromDate))&&instant(v.fromDate)<=now&&Number.isFinite(instant(v.toDate))&&instant(v.toDate)>=now)))
    .map((s:any)=>({id:`tfl:status:${r.id}:${s.id??s.statusSeverity}`,title:`${r.name}: ${s.statusSeverityDescription}`.slice(0,300),
      description:String(s.reason||"Check TfL for service details.").slice(0,4000),severity:statusSeverity(s.statusSeverity),
      routeIds:[`tfl:line:${r.id}`],source:CREDIT+" · line status (separate from arrival freshness)"})));
}
export function suppliedShapes(raw:any):number[][][]{
  return (Array.isArray(raw?.lineStrings)?raw.lineStrings:[]).slice(0,20).flatMap((s:any)=>{
    try{const parts=typeof s==="string"?JSON.parse(s):s;
      return (Array.isArray(parts)?parts:[]).slice(0,20).filter((line:any)=>Array.isArray(line)&&line.length>1&&line.length<=10000&&
        line.every((p:any)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90));
    }catch{return [];}
  });
}
