import type { TransitRoute, TransitStop } from "../types";
import { IDFM_URL, idfmEnabled } from "./model";

/** Provider metadata must identify the exact authorized resource, not a city/name.
 * No feed IDs or proximity-based operator aliases are guessed.
 */
export function verifiedIdfmFeed(feed:any){
  return feed?.urls?.static_current===IDFM_URL;
}
export function routeDuplicate(raw:any,direct:TransitRoute[]){
  if(!idfmEnabled()||typeof raw?.route_id!=="string"||typeof raw?.agency?.agency_id!=="string")return false;
  return direct.some(r=>r.id===`idfm:${raw.route_id}`&&r.idfm&&
    (r as TransitRoute&{agency_id?:string}).agency_id===raw.agency.agency_id);
}
export function boardingDuplicate(rawStop:any,rawRoute:any,directStops:TransitStop[]){
  if(!idfmEnabled()||!rawStop?.stop_id||!Array.isArray(rawStop.geometry?.coordinates))return false;
  const d=directStops.find(s=>s.id===`idfm:${rawStop.stop_id}`);
  if(!d?.idfm||!routeDuplicate(rawRoute,d.routes))return false;
  return (d.parent||"")===(rawStop.parent_station||"")&&
    (d.idfm.platform||"")===(rawStop.platform_code||"")&&
    Math.abs(d.lat-rawStop.geometry.coordinates[1])<.000001&&
    Math.abs(d.lon-rawStop.geometry.coordinates[0])<.000001;
}
