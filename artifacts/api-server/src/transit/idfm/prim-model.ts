import { createHash } from "node:crypto";
import type { Arrival, TransitAlert, TransitStop } from "../types";
export const PRIM_SOURCE="https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/idfm-ivtr-requete_unitaire";
export const PRIM_MAX_AGE=120_000;
export const PRIM_DAILY_LIMIT=180;
export function primEnabled(options={
  enabled:process.env.PRIM_ENABLED!=="false",hasKey:!!process.env.PRIM_API_KEY,
  production:process.env.NODE_ENV==="production"||process.env.REPLIT_DEPLOYMENT==="1",
  publicConfirmed:process.env.PRIM_PUBLIC_COMPLIANCE_CONFIRMED==="true",
}){
  return options.enabled&&options.hasKey&&(!options.production||options.publicConfirmed);
}
const list=(v:any):any[]=>v==null?[]:Array.isArray(v)?v:[v];
const text=(v:any):string=>typeof v==="string"?v.slice(0,250):Array.isArray(v)?text(v[0]):v&&typeof v==="object"?text(v.value):"";
const instant=(v:any)=>typeof v==="string"&&/(?:Z|[+-]\d\d:\d\d)$/i.test(v)?Date.parse(v):NaN;
export function primReference(stop:TransitStop){
  const raw=stop.rawId||stop.id.slice(5),id=/^IDFM:(\d+)$/.exec(raw)?.[1];
  if(!id)return;
  return `STIF:${(stop as TransitStop&{location_type?:string}).location_type==="1"?"StopArea:SP":"StopPoint:Q"}:${id}:`;
}
export function parsePrim(payload:any,stop:TransitStop,ref:string,now=Date.now(),allowedRefs=new Set([ref])){
  const service=payload?.Siri?.ServiceDelivery;
  const responseAt=instant(service?.ResponseTimestamp);
  if(!Number.isFinite(responseAt)||responseAt>now+30_000||now-responseAt>PRIM_MAX_AGE)
    throw new Error("PRIM response is missing a fresh timestamp");
  const deliveries=list(service.StopMonitoringDelivery).slice(0,16);
  if(!deliveries.length||deliveries.some(d=>d.Status!==true&&d.Status!=="true"))
    throw new Error("PRIM reports this monitoring point unavailable");
  const routes=new Map(stop.routes.map(r=>[/^idfm:IDFM:(C\d+)$/.exec(r.id)?.[1],r]));
  const arrivals:Arrival[]=[],alerts:(TransitAlert&{expiresAt:string})[]=[];let rejected=0;
  const seen=new Set<string>();
  for(const delivery of deliveries){
    const validUntil=instant(delivery.ValidUntil||delivery.ValidUntilTime);
    for(const visit of list(delivery.MonitoredStopVisit).slice(0,200)){
      const journey=visit?.MonitoredVehicleJourney,call=journey?.MonitoredCall;
      const line=/^STIF:Line::(C\d+):$/.exec(text(journey?.LineRef))?.[1],route=line&&routes.get(line);
      if(!route||!call||!allowedRefs.has(text(visit.MonitoringRef)))continue;
      if(ref.startsWith("STIF:StopPoint:")&&call.StopPointRef&&text(call.StopPointRef)!==ref)continue;
      // RecordedAtTime is production time, not necessarily the HTTP response time.
      const produced=instant(visit.RecordedAtTime),expected=instant(call.ExpectedDepartureTime||call.ExpectedArrivalTime);
      const expiry=Math.min(produced+PRIM_MAX_AGE,responseAt+PRIM_MAX_AGE,Number.isFinite(validUntil)?validUntil:Infinity);
      if(!Number.isFinite(produced)||produced>now+30_000||expiry<=now||!Number.isFinite(expected)||expected<now-15_000||expected>now+2*3600_000
        ||journey.Monitored===false||journey.Monitored==="false"){rejected++;continue;}
      const status=text(call.DepartureStatus||call.ArrivalStatus).toLowerCase();
      const destination=text(journey.DestinationName)||text(call.DestinationDisplay)||"Destination not supplied";
      const id=`idfm:prim:${createHash("sha256").update(`${ref}|${route.id}|${text(visit.ItemIdentifier)||text(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef)}|${expected}`).digest("hex").slice(0,24)}`;
      if(seen.has(id))continue;seen.add(id);
      if(["cancelled","canceled","missed","notexpected"].includes(status)){
        alerts.push({id,title:`${route.name}: ${status}`,description:`${destination}. PRIM reports this stop call ${status}; this does not cancel the whole route.`,
          severity:"warning",routeIds:[route.id],source:"Île-de-France Mobilités / PRIM",expiresAt:new Date(expiry).toISOString()});continue;
      }
      if(["departed","noreport"].includes(status))continue;
      arrivals.push({id,routeId:route.id,routeName:route.name,color:route.color,
        direction:text(journey.DirectionName),destination,minutes:Math.max(0,Math.ceil((expected-now)/60000)),
        source:"live",status:`PRIM predicted ${call.ExpectedDepartureTime?"departure":"arrival"}${status?` · ${status}`:""}`,
        scheduledAt:new Date(expected).toISOString(),updatedAt:new Date(produced).toISOString(),publishedAt:new Date(responseAt).toISOString(),
        expiresAt:new Date(expiry).toISOString(),timezone:"Europe/Paris",
        platform:text(call.DeparturePlatformName||call.ArrivalPlatformName)||undefined});
    }
  }
  return {arrivals:arrivals.sort((a,b)=>a.minutes-b.minutes).slice(0,24),alerts:alerts.slice(0,12),
    message:arrivals.length?`${arrivals.length} fresh PRIM predictions. No vehicle positions.`:
      `No fresh PRIM predictions for this stop${rejected?`; ${rejected} old or unusable estimates withheld`:""}. Published schedules remain available.`,
    checkedAt:new Date(now).toISOString()};
}
