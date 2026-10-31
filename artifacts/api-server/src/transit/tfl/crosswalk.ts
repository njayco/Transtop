import type { TransitStop } from "../types";
import { distance } from "../types";

function original(id:string):string|undefined{
  if(!/^tl:[\w-]{1,1300}$/.test(id))return;
  try{const pair=JSON.parse(Buffer.from(id.slice(3),"base64url").toString());
    return Array.isArray(pair)&&pair.length===2&&typeof pair[1]==="string"?pair[1]:undefined;
  }catch{return;}
}
/** Verified at an individual boarding point: exact NaPTAN ID, coordinate agreement,
 * no platform mismatch, exact current official line ID and mode. Never operator/name matching.
 * Preserve unknown feed identities and all unmatched lines on a shared boarding point.
 */
export function matchedRoutes(global:TransitStop,direct:TransitStop){
  if(!global.transitland||global.rawId!==direct.rawId||!direct.id.startsWith("tfl:stop:")||
    distance(global.lat,global.lon,direct.lat,direct.lon)>25||
    global.transitland.platform&&global.transitland.platform!==direct.tfl?.platform)return [];
  return global.routes.flatMap(r=>{
    const raw=original(r.id),local=direct.routes.find(d=>d.id===`tfl:line:${raw}`&&d.type===r.type);
    if(!local)return [];
    return [r.id];
  });
}
/** Line-card identity only within this particular result. A match at one stop
 * must never affect source discovery, another viewport, saved links or platforms.
 * If ANY returned global boarding point is unmatched, retain its global line.
 */
export function resultRouteAliases(globalStops:TransitStop[],directStops:TransitStop[]){
  const aliases=new Map<string,string>(),unmatched=new Set<string>();
  const direct=new Map(directStops.filter(s=>s.id.startsWith("tfl:stop:")).map(s=>[s.rawId,s]));
  for(const s of globalStops){
    if(!s.transitland)continue;
    const d=direct.get(s.rawId),matched=new Set(d?matchedRoutes(s,d):[]);
    for(const r of s.routes){
      if(matched.has(r.id))aliases.set(r.id,`tfl:line:${original(r.id)}`);
      else unmatched.add(r.id);
    }
  }
  for(const id of unmatched)aliases.delete(id);
  return aliases;
}
export function preferDirect(stops:TransitStop[]){
  const direct=new Map(stops.filter(s=>s.id.startsWith("tfl:stop:")).map(s=>[s.rawId,s]));
  return stops.flatMap(s=>{
    const local=direct.get(s.rawId);if(!s.transitland||!local)return [s];
    const matched=new Set(matchedRoutes(s,local)),routes=s.routes.filter(r=>!matched.has(r.id));
    return routes.length?[{...s,routes,arrivals:s.arrivals.filter(a=>!matched.has(a.routeId))}]:[];
  });
}
