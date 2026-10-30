import type { TransitVehicle } from "../types";
import { contains, type Bounds } from "../map-geometry";
import { request, enabled, safeMessage } from "./client";
import { activeGlobalRoutes, feedState } from "./tracking";
import { feedInfo } from "./discovery";
import { freshTimestamp } from "./departures";
import { identity, parseIdentity } from "./model";

const time = (v:any) => typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
export function normalizeVehicle(e:any, feed:string, rr:Map<string,{agencyId?:string;name:string;type?:TransitVehicle["vehicleType"];color?:string}>, now=Date.now()):TransitVehicle|undefined {
  const v=e?.vehicle, p=v?.position, routeId=v?.trip?.route_id||v?.trip?.routeId;
  const route=rr.get(routeId), at=freshTimestamp(time(v?.timestamp),now);
  if(!at||!route||!Number.isFinite(p?.latitude)||!Number.isFinite(p?.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180||!e.id)return;
  return {id:identity(feed,`vehicle:${e.id}`),lat:p.latitude,lon:p.longitude,routeId:identity(feed,routeId),routeName:route.name,
    agencyId:route.agencyId,vehicleType:route.type,color:route.color,source:"official Transitland agency GPS",updatedAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()};
}
export async function globalVehicles(bounds?:Bounds) {
  if(!enabled()||!bounds)return [];
  const entries=[...activeGlobalRoutes.values()].filter(v=>Date.now()-v.at<600000&&contains(bounds,v.lon,v.lat));
  const feeds=[...new Set(entries.map(v=>v.route.transitland!.feedId))].slice(0,3);
  const result:TransitVehicle[]=[];
  for(const feed of feeds){
    try{
      const info=await feedInfo(feed);if(!info.capabilities?.vehicles)continue;
      const data=await request(`feeds/${encodeURIComponent(feed)}/download_latest_rt/vehicle_positions.json`,{},30000);
      if(!freshTimestamp(time(data.header?.timestamp))){feedState(feed,"vehicle feed stale or timestamp unavailable");continue;}
      const rr=new Map(entries.filter(e=>e.route.transitland!.feedId===feed).map(e=>[parseIdentity(e.route.id)[1],e.route]));
      for(const e of (data.entity||[]).slice(0,10000)){
        const v=normalizeVehicle(e,feed,rr);
        if(v&&contains(bounds,v.lon,v.lat))result.push(v);
      }
      feedState(feed,"fresh vehicle feed · only exact routes and observations within 60 seconds qualify");
    }catch(err){feedState(feed,`Vehicles unavailable · ${safeMessage(err)}`);}
  }
  return result.slice(0,500);
}
