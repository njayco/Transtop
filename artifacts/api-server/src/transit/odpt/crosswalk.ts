import type { TransitRoute,TransitStop } from "../types";
/** Verified catalog datasets and exact raw GTFS IDs, not names or proximity.
 * Route + stop samples compared against direct editions on 2026-10-31.
 * An unimported route (including a new branch) is never suppressed. */
export const odptCrosswalk:Record<string,string>={
  "f-sendaimunicipal~bus~realtime~information~jp":"odpt-sendai",
  "f-nishitokyocity~alllines~jp":"odpt-hana",
  "f-tosaden~kotsu~gtfs~tosadentraffic~streetcar":"odpt-tosaden",
};
export function odptRouteDuplicate(feed:string,rawId:string,type:string,direct:TransitRoute[]){
  const agency=odptCrosswalk[feed];
  return !!agency&&direct.some(r=>r.odpt&&r.id===`${agency}:${rawId}`&&r.type===type);
}
export function odptBoardingDuplicate(feed:string,rawStop:any,rawRoute:string,type:string,direct:TransitRoute[],stops:TransitStop[]){
  const agency=odptCrosswalk[feed];
  if(!odptRouteDuplicate(feed,rawRoute,type,direct))return false;
  const stop=stops.find(s=>s.id===`${agency}:${rawStop.stop_id}`);
  return !!stop?.odpt&&(stop.parent||"")===(rawStop.parent_station||"")&&
    stop.routes.some(r=>r.id===`${agency}:${rawRoute}`)&&
    Array.isArray(rawStop.geometry?.coordinates)&&Math.abs(stop.lon-rawStop.geometry.coordinates[0])<0.000001&&
    Math.abs(stop.lat-rawStop.geometry.coordinates[1])<0.000001;
}
