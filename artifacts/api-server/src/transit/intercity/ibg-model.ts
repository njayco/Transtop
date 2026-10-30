import { DateTime } from "luxon";
import { distance, type TransitRoute, type TransitStop } from "../types";
import { ibgLocationDecision, IBG_LOCATION_WARNING } from "./ibg-verification";

export const IBG_URL="https://github.com/UTEL-UIUC/intercity-bus-gtfs";
export const IBG_ARTICLE="https://findingspress.org/article/159284-a-gtfs-based-dataset-for-the-us-intercity-bus-network";
export const IBG_CUTOFF="2026-01-04";
export const IBG_WARNING="IBG research reference, not verified current service. Most sources were collected in 2025; some in January 2026. Boarding coordinates, local timezones and holiday exceptions require carrier confirmation. Research road geometry is not used as a verified route path.";
export type Row=Record<string,string>;
export interface IbgPoint {stopId:string;sequence:number;arrival:string;departure:string;pickup:string}
export interface IbgTrip {id:string;routeId:string;serviceId:string;headsign:string;direction:string;points:IbgPoint[]}
export interface IbgData {
  version:string;importedAt:string;sha256:string;
  agencies:Row[];routes:Row[];stops:Row[];calendars:Row[];exceptions:Row[];sources:Row[];trips:IbgTrip[];
}
// These are brand aliases, not arbitrary parent-company mergers.
const PROVIDERS:Record<string,string>={"Academy Bus":"academy","Greyhound-us":"greyhound","FlixBus-us":"greyhound",
  "Adirondack Trailways":"adirondack","New York Trailways":"new-york-trailways","Pine Hill Trailways":"pine-hill",
  "Fullington Trailways":"fullington","C&J Bus Lines":"cj","Peter Pan Bus Lines":"peter-pan","Peter Pan (BZ)":"peter-pan",
  "Martz Bus":"martz","ShortLine Hudson":"shortline","Trans-Bridge Lines, Inc.":"transbridge"};
export const ibgProvider=(a:Row)=>PROVIDERS[a.agency_name]||`ibg-${a.agency_id}`;
export const isIbgId=(id?:string)=>!!id?.startsWith("ibg:");
export const ibgRouteId=(provider:string,id:string)=>`ibg:${provider}:route:${id}`;
export const ibgStopId=(provider:string,id:string)=>`ibg:${provider}:stop:${id}`;
export const sourceFor=(d:IbgData,a:Row)=>d.sources.find(s=>s.agency_name===a.agency_name);
function isoDate(raw:string){return /^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw;}
export function serviceOn(d:IbgData,id:string,date:string){
  const compact=date.replaceAll("-","");
  const exception=d.exceptions.find(e=>e.service_id===id&&e.date===compact);
  if(exception)return exception.exception_type==="1";
  const c=d.calendars.find(c=>c.service_id===id),day=DateTime.fromISO(date,{zone:"America/New_York"});
  return !!c&&day.isValid&&compact>=c.start_date&&compact<=c.end_date&&
    c[["monday","tuesday","wednesday","thursday","friday","saturday","sunday"][day.weekday-1]]==="1";
}
function sampleDate(d:IbgData,trips:IbgTrip[]){
  const dates:string[]=[];
  for(const id of new Set(trips.map(t=>t.serviceId))){
    const cal=d.calendars.find(c=>c.service_id===id);
    const end=cal?isoDate(cal.end_date)<IBG_CUTOFF?isoDate(cal.end_date):IBG_CUTOFF:IBG_CUTOFF;
    for(let i=0;i<7;i++){
      const date=DateTime.fromISO(end).minus({days:i}).toISODate()!;
      if(serviceOn(d,id,date)){dates.push(date);break;}
    }
    dates.push(...d.exceptions.filter(e=>e.service_id===id&&e.exception_type==="1").map(e=>isoDate(e.date)).filter(date=>date<=IBG_CUTOFF));
  }
  return dates.sort().at(-1)||IBG_CUTOFF;
}
export function buildIbg(d:IbgData){
  const agencies=new Map(d.agencies.map(a=>[a.agency_id,a]));
  const routes=new Map<string,TransitRoute>(),rawRoutes=new Map(d.routes.map(r=>[r.route_id,r]));
  const tripGroups=new Map<string,IbgTrip[]>();
  for(const t of d.trips){const group=tripGroups.get(t.routeId)||[];group.push(t);tripGroups.set(t.routeId,group);}
  for(const r of d.routes){
    const a=agencies.get(r.agency_id)!;const provider=ibgProvider(a);
    const id=ibgRouteId(provider,r.route_id),source=sourceFor(d,a);
    routes.set(r.route_id,{id,name:`${r.route_short_name||r.route_long_name||`Route ${r.route_id}`} · IBG ref`,
      longName:r.route_long_name,agency:a.agency_name,agencyId:provider,type:"intercity",
      color:/^[\da-f]{6}$/i.test(r.route_color)?`#${r.route_color}`:"#b38d46",
      sourceUrl:IBG_ARTICLE,referenceDate:sampleDate(d,tripGroups.get(r.route_id)||[]),
      scheduleNotes:[IBG_WARNING,`Collection date: ${source?.source_date||"not supplied"}. Source: ${source?.data_source||"research compilation"}.`,
        "Ahammed, Shih & Lehe, A GTFS-Based Dataset for the US Intercity Bus Network (2026). Article license does not independently establish all upstream feed reuse terms."]});
  }
  const served=new Map<string,Map<string,TransitRoute>>();
  for(const t of d.trips){
    const route=routes.get(t.routeId)!;
    for(const p of t.points){
      const id=ibgStopId(route.agencyId!,p.stopId),m=served.get(id)||new Map();
      m.set(route.id,route);served.set(id,m);
    }
  }
  const archivalStops:TransitStop[]=[];
  const quarantinedStops=new Map<string,NonNullable<ReturnType<typeof ibgLocationDecision>>>();
  const rawStopMap=new Map(d.stops.map(s=>[s.stop_id,s]));
  for(const [key,rs] of served){
      const s=rawStopMap.get(key.split(":").at(-1)!)!;
      const rr=[...rs.values()];
      const decision=ibgLocationDecision(d,s);
      if(decision?.status==="quarantined")quarantinedStops.set(key,decision);
      archivalStops.push({id:key,rawId:s.stop_id,name:`${s.stop_name} · IBG reference`,agency:rr[0].agency,type:"intercity",
        lat:Number(s.stop_lat),lon:Number(s.stop_lon),distance:0,walkingMinutes:0,accessible:false,
        updatedAt:d.importedAt,routes:rr,arrivals:[],
        alerts:[{id:`${key}:reference`,title:"Research snapshot · verify before travel",description:IBG_WARNING,
          severity:"warning",routeIds:rr.map(r=>r.id),source:"IBG research dataset"}]});
  }
  const affectedRoutes=new Set(archivalStops.filter(s=>quarantinedStops.has(s.id)).flatMap(s=>s.routes.map(r=>r.id)));
  for(const r of routes.values())if(affectedRoutes.has(r.id))r.scheduleNotes!.push(IBG_LOCATION_WARNING);
  // Only eligible points enter public catalogs and selectors. The archival map
  // retains provider identities and untouched source coordinates for audit.
  const stops=archivalStops.filter(s=>!quarantinedStops.has(s.id));
  return {routes:[...routes.values()],stops,rawRoutes,rawStopMap,tripGroups,routeMap:routes,
    stopMap:new Map(stops.map(s=>[s.id,s])),archivalStopMap:new Map(archivalStops.map(s=>[s.id,s])),
    quarantinedStops,affectedRoutes,coverageWarning:quarantinedStops.size?IBG_LOCATION_WARNING:""};
}
export function nearbyIbg(stops:TransitStop[],lat:number,lon:number){
  return new Set(stops.filter(s=>distance(lat,lon,s.lat,s.lon)<=3000).flatMap(s=>s.routes.map(r=>r.agencyId!)));
}
export function referenceTimetable(d:IbgData,c:ReturnType<typeof buildIbg>,p:{date:string;from?:string;routeId?:string;stopId?:string;direction?:string;offset?:number;limit?:number}){
  const offset=p.offset||0,limit=p.limit||40;
  const empty=(message:string)=>({departures:[],total:0,offset,limit,date:p.date,message});
  const day=DateTime.fromISO(p.date,{zone:"America/New_York"});
  if(!day.isValid||day.toISODate()!==p.date)return empty("Invalid reference service date.");
  if(p.date>IBG_CUTOFF)return empty(`Research snapshot only. Current departures are withheld, even when an old calendar extends into the future. Choose a historical date on or before ${IBG_CUTOFF}; confirm current trips with the carrier.`);
  const result:any[]=[];
  for(const t of d.trips){
    const route=c.routeMap.get(t.routeId)!;
    if(p.routeId&&route.id!==p.routeId)continue;
    const destination=c.rawStopMap.get(t.points.at(-1)?.stopId||"")?.stop_name||t.headsign;
    const direction=t.headsign||destination;
    if(p.direction&&p.direction!==direction)continue;
    if(!serviceOn(d,t.serviceId,p.date))continue;
    for(const pt of t.points){
      const stopId=ibgStopId(route.agencyId!,pt.stopId);
      if(!c.stopMap.has(stopId))continue;
      if(p.stopId?stopId!==p.stopId:pt!==t.points[0])continue;
      if(pt.pickup==="1")continue;
      const raw=pt.departure||pt.arrival,m=raw.match(/^(\d{1,3}):([0-5]\d):([0-5]\d)$/);
      if(!m)continue;
      const hours=+m[1],minutes=+m[2],seconds=+m[3];
      // Preserve the archive's service day and encoded timezone, never shift
      // old schedules into today. DST ambiguity is withheld.
      const base=day.plus({days:Math.floor(hours/24)}),instant=base.set({hour:hours%24,minute:minutes,second:seconds,millisecond:0});
      if(instant.hour!==hours%24||instant.getPossibleOffsets().length!==1)continue;
      const from=p.from||"00:00",threshold=Number(from.slice(0,2))*3600+Number(from.slice(3,5))*60;
      if(hours*3600+minutes*60+seconds<threshold)continue;
      result.push({id:`${t.id}:${p.date}:${pt.sequence}`,tripId:`ibg:${t.id}`,routeId:route.id,routeName:route.name,
        stopId,stopName:c.stopMap.get(stopId)?.name||pt.stopId,destination,direction,time:instant.toUTC().toISO()!});
    }
  }
  result.sort((a,b)=>a.time.localeCompare(b.time));
  return {departures:result.slice(offset,offset+limit),total:result.length,offset,limit,date:p.date,
    message:`Historical IBG timetable only — not current travel information. Times use the archive's encoded America/New_York timezone, which may not be the original operator's local timezone. Holiday completeness is unverified. ${IBG_ARTICLE}${c.coverageWarning?` ${c.coverageWarning}`:""}`};
}
