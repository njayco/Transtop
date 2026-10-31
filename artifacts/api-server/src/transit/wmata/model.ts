import type { TransitStop, TransitRoute, TransitAlert } from "../types";
import { activeService, gtfsSeconds } from "../time";
import { WMATA_CREDIT, WMATA_DOCS } from "./client";

export const isWmata=(id?:string)=>!!id?.startsWith("wmata:");
export const routeType=(native:string)=>native==="1"?"subway":native==="3"?"bus":undefined;
export const boarding=(stop:TransitStop)=>!isWmata(stop.id)||(!["2","3","4"].includes((stop as any).location_type)&&stop.routes.length>0);
export interface StaticTrip {id:string;data:Record<string,string>;calendar?:Record<string,string>;exceptions:Record<string,string>[];calls:{stop_id:string;stop_sequence:string;departure_time?:string;pickup_type?:string;stop_headsign?:string}[]}
export interface StaticCatalog {routes:TransitRoute[];stops:TransitStop[];trips:StaticTrip[]}
export function current(timestamp:number,now=Date.now(),age=60000){
  return Number.isFinite(timestamp)&&timestamp>0&&timestamp*1000<=now+30000&&now-timestamp*1000<=age;
}
/** Revision suffixes differ in WMATA rail products. A suffix alone proves nothing.
 * Resolve only the publisher's scheduled_trip_id, exact route, direction, service
 * date, departure time and every supplied sequence/stop. Ambiguity stays unresolved.
 */
export function matchTrip(update:any,catalog:StaticCatalog):StaticTrip|undefined {
  const trip=update.trip;if(!trip?.tripId||!/^\d{8}$/.test(trip.startDate||""))return;
  const candidates=catalog.trips.filter(t=>{
    const r=t.data,exact=t.id===`wmata:${trip.tripId}`;
    if(!exact&&(!/^\d+_\d+$/.test(trip.tripId)||!r.scheduled_trip_id||r.scheduled_trip_id!==trip.tripId.split("_")[0]))return false;
    if(r.route_id!==trip.routeId||trip.directionId!=null&&r.direction_id!==String(trip.directionId))return false;
    if(!activeService(t.calendar,t.exceptions,trip.startDate))return false;
    if(!exact){
      if(!trip.startTime||t.calls[0]?.departure_time!==trip.startTime)return false;
      if(!(update.stopTimeUpdate||[]).length&&![3,7].includes(Number(trip.scheduleRelationship)))return false;
    }
    return (update.stopTimeUpdate||[]).every((s:any)=>t.calls.some(c=>c.stop_id===s.stopId&&Number(c.stop_sequence)===Number(s.stopSequence)));
  });
  return candidates.length===1?candidates[0]:undefined;
}
export function normalizePredictions(entities:any[],catalog:StaticCatalog,mode:"bus"|"subway",header:number,now=Date.now()){
  const routes=new Map(catalog.routes.filter(r=>r.type===mode).map(r=>[r.id,r]));
  const stops=new Map(catalog.stops.filter(boarding).map(s=>[s.rawId,s]));
  return entities.flatMap(entity=>{
    const u=entity.tripUpdate,trip=u?.trip;
    if(!trip||!routes.has(`wmata:${trip.routeId}`)||!current(Number(u.timestamp)||header,now))return [];
    const relationship=Number(trip.scheduleRelationship||0);
    // Duplicated/added trips must never suppress the original scheduled run.
    const matched=relationship===0||relationship===3||relationship===7?matchTrip(u,catalog):undefined;
    const timestamp=Number(u.timestamp)||header;
    const calls=(u.stopTimeUpdate||[]).filter((s:any)=>{
      const stop=stops.get(s.stopId);
      return stop&&stop.routes.some(r=>r.id===`wmata:${trip.routeId}`)&&
        (!matched||matched.calls.some(c=>c.stop_id===s.stopId&&Number(c.stop_sequence)===Number(s.stopSequence)));
    }).map((s:any)=>({...s,transtopHeadsign:matched?.calls.find(c=>Number(c.stop_sequence)===Number(s.stopSequence))?.stop_headsign,
      transtopPickup:matched?.calls.find(c=>Number(c.stop_sequence)===Number(s.stopSequence))?.pickup_type}));
    return [{id:entity.id,tripUpdate:{trip:{...trip},timestamp,stopTimeUpdate:calls,
      transtopTripId:matched?.id,transtopHeadsign:matched?.data.trip_headsign,
      transtopUnresolved:!matched,transtopSourceTrip:trip.tripId}}];
  });
}
const clean=(value:string)=>value.replace(/<[^>]*>/g,"").replace(/[\u0000-\u0008\u000b-\u001f]/g,"").slice(0,12000);
const text=(value:any)=>clean(value?.translation?.find((t:any)=>t.language==="en")?.text||value?.translation?.[0]?.text||"");
export function normalizeAlerts(entities:any[],catalog:Pick<StaticCatalog,"routes"|"stops">,mode:"bus"|"subway",timestamp:number,now=Date.now()):TransitAlert[]{
  if(!current(timestamp,now,180000))return [];
  const routes=new Map(catalog.routes.filter(r=>r.type===mode).map(r=>[r.id,r]));
  const stops=new Map(catalog.stops.map(s=>[s.id,s]));
  return entities.flatMap(e=>{
    const a=e.alert;if(!a)return [];
    const periods=(a.activePeriod||[]).map((p:any)=>({start:Number(p.start)||undefined,end:Number(p.end)||undefined}));
    if(periods.length&&!periods.some((p:any)=>(!p.start||p.start<=now/1000)&&(!p.end||p.end>now/1000)))return [];
    const routeIds=new Set<string>(),stopIds=new Set<string>(),verifiedScopes:{routeId?:string;stopId?:string}[]=[];
    const scopes=a.informedEntity||[];
    let systemwide=!scopes.length,unresolved=false;
    for(const scope of scopes){
      const route=scope.routeId||scope.trip?.routeId,stop=scope.stopId;
      const routeId=route?`wmata:${route}`:undefined,stopId=stop?`wmata:${stop}`:undefined;
      if(routeId&&!routes.has(routeId)||stopId&&!stops.has(stopId)||scope.trip&&!route||
        scope.agencyId&&scope.agencyId!=="1"||scope.routeType!=null&&Number(scope.routeType)!==(mode==="bus"?3:1)){
        unresolved=true;continue;
      }
      if(routeId)routeIds.add(routeId);
      if(stopId)stopIds.add(stopId);
      if(!route&&!stop&&!scope.trip)systemwide=true;
      else verifiedScopes.push({routeId,stopId});
    }
    return [{id:`wmata:${mode}:alert:${String(e.id).slice(0,200)}`,title:text(a.headerText)||"WMATA service advisory",
      description:text(a.descriptionText),severity:Number(a.effect)===1?"disruption":[3,9].includes(Number(a.effect))?"delay":"notice",
      routeIds:[...routeIds],stopIds:[...stopIds],agencyId:"wmata",type:mode,systemwide,
      scopes:verifiedScopes,
      source:`WMATA official ${mode==="bus"?"Metrobus":"Metrorail"} alerts${unresolved?" · some source scope unresolved":""}`,
      updatedAt:new Date(timestamp*1000).toISOString(),url:WMATA_DOCS,activePeriods:periods}];
  });
}
/** Stop-only advisories never become route-wide notices. Combined stop/route scopes
 * are narrowed to both; systemwide advisories remain mode-scoped.
 */
export function applies(alert:TransitAlert,stop:TransitStop) {
  if(alert.agencyId!=="wmata")return stop.routes.some(r=>alert.routeIds.includes(r.id));
  if(!isWmata(stop.id))return false;
  if(alert.type&&!stop.routes.some(r=>r.type===alert.type))return false;
  return !!alert.systemwide||(alert.scopes||[]).some(scope=>
    (!scope.stopId||scope.stopId===stop.id||!!stop.parent&&scope.stopId===`wmata:${stop.parent}`)&&
    (!scope.routeId||stop.routes.some(r=>r.id===scope.routeId)));
}
export function locationInfo(row:Record<string,string>){
  const kind=row.location_type==="1"?"station":row.location_type==="2"?"entrance":
    row.location_type==="3"?"passage":row.location_type==="4"?"boarding area":row.parent_station?"platform":"boarding stop";
  return {kind,platform:row.platform_code||row.stop_desc||undefined,
    parentId:row.parent_station?`wmata:${row.parent_station}`:undefined,
    attribution:WMATA_CREDIT,url:WMATA_DOCS,timezone:"America/New_York"};
}
