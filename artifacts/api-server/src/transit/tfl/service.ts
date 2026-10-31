import type { TransitRoute, TransitStop, TflInfo, RouteDetail } from "../types";
import { distance } from "../types";
import type { Bounds } from "../map-geometry";
import { request,health,configured,safeMessage,CREDIT,COVERAGE,TERMS } from "./client";
import { MODES,line,normalizeStop,rawStop,rawLine,prediction,notices,suppliedShapes,boardingPoints,findStopRecord } from "./model";

export type Query={q?:string;lat?:number;lon?:number;type?:string;agency?:string;serviceClass?:string;cursor?:string};
const unique=<T extends {id:string}>(rows:T[])=>[...new Map(rows.map(r=>[r.id,r])).values()];
export const inLondon=(lat?:number,lon?:number)=>lat!=null&&lon!=null&&lat>=50.5&&lat<=52.2&&lon>=-1.1&&lon<=.8;
export const londonPlace=(q:string)=>/^(london|london,? (uk|england|united kingdom)|london england)$/i.test(q.trim())?{lat:51.5074,lon:-.1278}:undefined;
export function matches(r:TransitRoute,p:Query){
  return (!p.type||p.type==="all"||r.type===p.type)&&(!p.agency||p.agency==="tfl"||p.agency===r.agencyId)&&
    (!p.serviceClass||p.serviceClass==="all");
}
export const eligible=(p:Query)=>configured()&&(!p.agency||p.agency==="tfl"||p.agency.startsWith("tfl-"))&&p.type!=="intercity";
export async function lines():Promise<TransitRoute[]>{
  const raw=await request(`Line/Mode/${MODES.join(",")}`,{},86400000);
  if(!Array.isArray(raw))throw new Error("Invalid TfL lines");
  return raw.slice(0,1000).flatMap(r=>{const v=line(r);return v?[v]:[];});
}
export async function stop(id:string):Promise<TransitStop|undefined>{
  const raw=rawStop(id),rr=await lines(),value=await request(`StopPoint/${raw}`,{},86400000);
  const record=findStopRecord(value,raw);
  return record?normalizeStop(record,rr):undefined;
}
export function boundedArea(b:Bounds){
  return [b.west,b.east,b.south,b.north].every(Number.isFinite)&&b.east>=b.west&&b.north>=b.south&&
    b.east-b.west<=.12&&b.north-b.south<=.08&&inLondon((b.north+b.south)/2,(b.west+b.east)/2);
}
export async function discover(p:Query,bounds?:Bounds){
  let coverage:TflInfo|undefined;
  const empty={stops:[] as TransitStop[],routes:[] as TransitRoute[],tfl:coverage};
  if(!eligible(p))return empty;
  const isPlace=!!p.q&&!!londonPlace(p.q);
  if(!p.q&&!inLondon(p.lat,p.lon)&&!bounds)return empty;
  if(bounds&&!boundedArea(bounds))return {...empty,...(inLondon((bounds.north+bounds.south)/2,(bounds.west+bounds.east)/2)?
    {tfl:{...health(),message:"Zoom in further to load a bounded TfL stop area. No citywide poll is made."}}:{})};
  try{
    const rr=await lines(),q=p.q?.trim().slice(0,120);
    let raw:any,partial=false;
    if(q&&!isPlace){
      const result=await request("StopPoint/Search",{query:q,modes:MODES.join(","),maxResults:12},3600000);
      const ids=(result.matches||[]).slice(0,12).map((s:any)=>s.id).filter((id:any)=>typeof id==="string"&&/^[A-Za-z0-9]{5,40}$/.test(id));
      partial=Number(result.total)>ids.length;
      raw=ids.length?await request(`StopPoint/${ids.join(",")}`,{},86400000):[];
    }else{
      const lat=bounds?(bounds.north+bounds.south)/2:isPlace?51.5074:p.lat!;
      const lon=bounds?(bounds.west+bounds.east)/2:isPlace?-.1278:p.lon!;
      // Quantized centers share metadata across pans; the result remains explicitly partial.
      raw=await request("StopPoint",{lat:+lat.toFixed(3),lon:+lon.toFixed(3),radius:1500,
        stopTypes:"NaptanPublicBusCoachTram,NaptanMetroStation,NaptanRailStation"},3600000);
      partial=Number(raw.total)>(raw.stopPoints?.length||0)||!!bounds;
    }
    const candidates=boardingPoints(raw);
    partial=partial||candidates.length>80;
    const ss=unique(candidates.flatMap(s=>{
      const v=normalizeStop(s,rr);if(!v)return [];
      v.routes=v.routes.filter(r=>matches(r,p));if(!v.routes.length)return [];
      v.type=v.routes[0].type;
      return !bounds||v.lon>=bounds.west&&v.lon<=bounds.east&&v.lat>=bounds.south&&v.lat<=bounds.north?[v]:[];
    })).slice(0,80);
    const routes=unique(ss.flatMap(s=>s.routes).concat(q?rr.filter(r=>matches(r,p)&&r.name.toLowerCase().includes(q.toLowerCase())):[]));
    coverage={...health(),message:`${COVERAGE} ${partial?"Partial results: at most 80 matching stops from a bounded source page. Area queries cover 1.5 km around the center; narrow the map or station search for other stops.":""} Open a stop for predictions. Map geometry loads only on a selected route. ${p.cursor?"Transitland pagination does not change this cached TfL selection.":""}`};
    return {stops:ss,routes,tfl:coverage};
  }catch(err){return {...empty,tfl:{...health(),message:safeMessage(err)}};}
}
export async function statuses(rr:TransitRoute[]){
  const ids=unique(rr).slice(0,30).map(r=>rawLine(r.id));
  if(!ids.length)return [];
  const raw=await request(`Line/${ids.join(",")}/Status`,{},60000);
  if(!Array.isArray(raw))throw new Error("Invalid TfL status");
  return notices(raw);
}
export async function enrich(s:TransitStop):Promise<TransitStop>{
  let message="",arrivals:TransitStop["arrivals"]=[],alerts:TransitStop["alerts"]=[];
  try{
    const raw=await request(`StopPoint/${rawStop(s.id)}/Arrivals`,{},20000);
    if(!Array.isArray(raw))throw new Error("Invalid TfL predictions");
    arrivals=unique(raw.slice(0,1500).flatMap(p=>{const a=prediction(p,s);return a?[a]:[];}))
      .sort((a,b)=>a.minutes-b.minutes).slice(0,36);
    message=arrivals.length?"Official predictions; expiry is based on upstream observation time.":"No fresh TfL predictions supplied. This does not mean service has stopped; no schedules are invented.";
  }catch(err){message=safeMessage(err);}
  try{alerts=await statuses(s.routes);}catch(err){message+=` Line notices unavailable: ${safeMessage(err)}`;}
  return {...s,arrivals,alerts,tfl:{...s.tfl!,...health(),status:arrivals.length?"healthy":health().status==="healthy"?"unavailable":health().status,message},
    updatedAt:arrivals[0]?.updatedAt||s.updatedAt};
}
export async function route(id:string,direction?:string,withArrivals=true):Promise<RouteDetail|undefined>{
  const raw=rawLine(id),r=(await lines()).find(r=>r.id===id);if(!r)return;
  if(direction&&!["inbound","outbound"].includes(direction))throw new Error("Invalid TfL direction");
  let message="",ss:TransitStop[]=[],shape:number[][]=[];
  try{
    const pattern=await request(`Line/${raw}/Route/Sequence/${direction||"inbound"}`,{},86400000);
    const sequences=(pattern.stopPointSequences||[]).slice(0,20),chosen=sequences[0];
    ss=(chosen?.stopPoint||[]).slice(0,150).flatMap((s:any)=>{const v=normalizeStop({...s,lines:[{id:raw}]},[r]);return v?[v]:[];});
    // Never concatenate disjoint branches. The UI shows one explicitly supplied pattern.
    shape=suppliedShapes(pattern)[0]||[];
    message=`Showing one supplied ${direction||"inbound"} stop pattern; other branches may exist. ${!shape.length?"Official geometry is unavailable; no connecting track is drawn.":""} Select a stop for its predictions. No per-stop arrival fan-out.`;
  }catch(err){message=`Route pattern unavailable: ${safeMessage(err)} No track is invented.`;}
  let alerts:TransitStop["alerts"]=[];
  try{alerts=await statuses([r]);}catch(err){message+=` Line status unavailable: ${safeMessage(err)}`;}
  // Only the first boarding point is enriched, never the full line. All stops open their own detail.
  if(ss[0]&&withArrivals)ss[0]=await enrich(ss[0]);
  return {route:{...r,tfl:{...health(),message},scheduleNotes:[...(r.scheduleNotes||[]),message]},stops:ss,shape,
    vehicles:[],alerts,directions:["inbound","outbound"]};
}
export function sourceRows(){
  const h=health();
  return (["bus","subway","rail"] as const).map(type=>({id:`tfl-${type}`,agency:`TfL London · ${type==="subway"?"Underground":type==="bus"?"buses":"DLR / Elizabeth / Overground"}`,
    type,status:h.status,description:`${CREDIT}. ${h.message} Shared cap: 17 requests/minute per database/environment (34 total reserved for development + published app), below the documented public 50/minute baseline. Account-specific subscription allowance unverified; no 500/min entitlement assumed. Last successful request: ${h.lastSuccess||"not yet this session"}. Independent app; no TfL endorsement. Terms: ${TERMS}`,
    url:TERMS,updatedAt:h.lastSuccess||null}));
}
