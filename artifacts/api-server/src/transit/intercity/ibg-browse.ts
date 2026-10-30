import { ibgCatalog, ibgCompiled, ibgDataset } from "./ibg-store";
import { ibgStopId, referenceTimetable } from "./ibg-model";
import type { RouteDetail } from "../types";

export async function ibgRouteDetail(id:string,direction?:string):Promise<RouteDetail|undefined>{
  const c=await ibgCompiled();if(!c)return;
  const raw=[...c.routeMap].find(([,r])=>r.id===id);if(!raw)return;
  const [rawId,route]=raw,trips=c.tripGroups.get(rawId)||[];
  const directionFor=(t:typeof trips[number])=>t.headsign||c.rawStopMap.get(t.points.at(-1)?.stopId||"")?.stop_name||"";
  const matching=direction?trips.filter(t=>directionFor(t)===direction):trips;
  const trip=[...matching].sort((a,b)=>b.points.length-a.points.length)[0];
  const stops=(trip?.points||[]).flatMap(p=>{const s=c.stopMap.get(ibgStopId(route.agencyId!,p.stopId));return s?[s]:[];});
  const all=new Map<string,{id:string;name:string;sequence:number}>();
  for(const t of matching)for(const p of t.points){
    const s=c.stopMap.get(ibgStopId(route.agencyId!,p.stopId));
    if(s&&!all.has(s.id))all.set(s.id,{id:s.id,name:s.name,sequence:all.size});
  }
  return {route,stops,shape:[],vehicles:[],alerts:stops[0]?.alerts||[],directions:[...new Set(trips.map(directionFor))].filter(Boolean),timetableStops:[...all.values()]};
}
export async function ibgTimetable(p:Parameters<typeof referenceTimetable>[2]){
  const [d,c]=await Promise.all([ibgDataset(),ibgCompiled()]);
  if(!d||!c)return {departures:[],total:0,offset:p.offset||0,limit:p.limit||40,date:p.date,message:"IBG reference dataset unavailable; no current departures inferred."};
  return referenceTimetable(d,c,p);
}
export async function primaryIbgCatalog(){
  const c=await ibgCatalog();
  // Newer carrier schedules already exist for these operators. Do not add a
  // second set of research markers to their verified primary browsing results.
  const keep=(id?:string)=>id!=="martz"&&id!=="transbridge";
  return {routes:c.routes.filter(r=>keep(r.agencyId)),stops:c.stops.filter(s=>s.routes.some(r=>keep(r.agencyId)))};
}
