import type {TransitStop,TransitRoute,TransitVehicle} from "./types";

type StationReport={id:string;routeId:string;stopId:string;currentStatus:number;source:string;updatedAt:string;agencyId:string};
/** Entity IDs are only feed-local and can be reused by other subway feeds. */
export function trackedVehicleId(agency:string,entity:any){
  const v=entity.vehicle;
  return `${agency}:${v?.vehicle?.id||v?.trip?.tripId||`${v?.trip?.routeId||"vehicle"}:${entity.id}`}`;
}
/** Resolve vehicle route IDs against the published catalog, not display guesses.
 * A Bus Time route can be unscoped while static borough IDs are scoped. */
export function catalogVehicles(gps:TransitVehicle[],reports:StationReport[],stops:TransitStop[]):TransitVehicle[]{
  const routes=new Map<string,TransitRoute>(),byStop=new Map(stops.map(s=>[s.id,s]));
  const aliases=new Map<string,TransitRoute|null>();
  for(const s of stops)for(const route of s.routes){
    routes.set(route.id,route);
    const agency=route.id.split(":")[0],key=agency+":"+route.name.toUpperCase();
    const previous=aliases.get(key);
    if(previous===undefined)aliases.set(key,route);
    else if(previous?.id!==route.id)aliases.set(key,null);
  }
  const resolve=(id?:string)=>{
    if(!id)return;
    const exact=routes.get(id);if(exact)return exact;
    const [agency,...parts]=id.split(":");
    const raw=parts.join(":").split("~").pop()!.split("_").pop()!.toUpperCase();
    return aliases.get(`${agency}:${raw}`)||undefined;
  };
  const result=new Map<string,TransitVehicle>();
  for(const v of gps){
    const route=resolve(v.routeId);
    result.set(v.id,{...v,agencyId:v.agencyId||v.routeId?.split(":")[0],routeId:route?.id||v.routeId,routeName:v.routeName||route?.name});
  }
  for(const report of reports){
    if(result.has(report.id))continue;
    const stop=byStop.get(report.stopId)||(report.agencyId==="mta-subway"?byStop.get(report.stopId.replace(/[NS]$/,"")):undefined);
    const route=resolve(report.routeId);
    if(!stop||!route||!Number.isFinite(stop.lat)||!Number.isFinite(stop.lon))continue;
    const status=report.currentStatus===1?"at station":report.currentStatus===2?"next station":"approaching station";
    result.set(report.id,{id:report.id,lat:stop.lat,lon:stop.lon,routeId:route.id,routeName:route.name,agencyId:report.agencyId,
      source:`${report.source} · live ${status} report (not GPS) · ${stop.name}`,updatedAt:report.updatedAt});
  }
  return [...result.values()];
}
