import type { TransitRoute, TransitStop } from "../types";
import { sourceUrl } from "./client";

export function verifiedFeed(feed:any){
  return [sourceUrl("static"),"https://api.wmata.com/gtfs/bus-gtfs-static.zip",
    "https://api.wmata.com/gtfs/rail-gtfs-static.zip"].includes(feed?.urls?.static_current);
}
export function routeDuplicate(raw:any,direct:TransitRoute[]){
  if(typeof raw?.route_id!=="string"||raw?.agency?.agency_id!=="1")return false;
  return direct.some(r=>r.id===`wmata:${raw.route_id}`&&r.type===(String(raw.route_type)==="1"?"subway":String(raw.route_type)==="3"?"bus":"unsupported"));
}
export function boardingDuplicate(raw:any,route:any,direct:TransitStop[]){
  const stop=direct.find(s=>s.id===`wmata:${raw?.stop_id}`);
  if(!stop?.wmata||!routeDuplicate(route,stop.routes)||!Array.isArray(raw.geometry?.coordinates))return false;
  return (stop.parent||"")===(raw.parent_station||"")&&
    Math.abs(stop.lat-raw.geometry.coordinates[1])<.000001&&Math.abs(stop.lon-raw.geometry.coordinates[0])<.000001;
}
