import { DateTime } from "luxon";
import { distance, type TransitRoute, type TransitStop, type Arrival } from "../types";
import { ZONE } from "../time";
import { holidayDate, printedInstant } from "./martz";
import { documentStops,documentRoutes,documentTrips,WALL_CLOSED_DATES,WALL_CLOSURE,VERIFIED_AT,type DocumentTrip } from "./uploaded-data";

const stopById=new Map(documentStops.map(s=>[s.id,s]));
const routeById=new Map(documentRoutes.map(r=>[r.id,r]));
export const isDocumentId=(id?:string)=>!!id&&(id.startsWith("transbridge:")||id.startsWith("nj-transit:"));
const routeRecord=(r:typeof documentRoutes[number]):TransitRoute=>({
  id:r.id,name:r.name,agency:r.agency,agencyId:r.providerId,type:r.type,color:r.color,serviceClass:r.type==="bus"?"local":undefined,
  longName:r.providerId==="nj-transit"?`${r.name} · Easton–Phillipsburg–Pohatcong`:`${r.name} · published Wall Street service`,
  scheduleNotes:r.notes,sourceUrl:r.sourceUrl,
});
export function documentCatalog() {
  const routes=documentRoutes.map(routeRecord);
  const stops:TransitStop[]=documentStops.flatMap(s=>{
    if(s.lat==null||s.lon==null)return [];
    const serving=routes.filter(r=>documentTrips.some(t=>t.routeId===r.id&&t.points.some(pt=>pt.stopId===s.id)));
    if(!serving.length)return [];
    const provider=routeById.get(serving[0].id)!;
    return [{id:s.id,rawId:s.id.split(":").at(-1),name:s.name,type:provider.type,agency:provider.agency,lat:s.lat,lon:s.lon,
      routes:serving,arrivals:[],alerts:[],accessible:provider.providerId==="nj-transit",updatedAt:VERIFIED_AT,distance:0,walkingMinutes:0,neighborhood:s.address}];
  });
  return {routes,stops};
}
export function documentServiceStatus(provider:string,date:string) {
  if(provider==="transbridge"&&WALL_CLOSED_DATES.includes(date))return WALL_CLOSURE;
  if(holidayDate(date))return `Special holiday service is not verified for ${provider==="nj-transit"?"NJ TRANSIT 890/891":"Trans-Bridge Wall Street"} on ${date}; regular times are withheld.`;
  return "";
}
export function activeDocumentTrip(t:DocumentTrip,date:string) {
  const day=DateTime.fromISO(date,{zone:ZONE});
  return day.isValid&&date>=t.effectiveDate&&t.days.includes(day.weekday)&&!documentServiceStatus(t.providerId,date);
}
function pointsFor(t:DocumentTrip,date:string,index:number) {
  return t.points.slice(index).map((pt,sequence)=>{
    const stop=stopById.get(pt.stopId)!;
    return {id:stop.id,name:stop.name,sequence,address:stop.address+(!pt.pickup?" · drop-off only":""),
      ...(stop.lat==null?{}:{lat:stop.lat,lon:stop.lon}),...(pt.minutes==null?{}:{time:printedInstant(date,pt.minutes)})};
  });
}
function departureFor(t:DocumentTrip,date:string,index:number) {
  const pt=t.points[index],stop=stopById.get(pt.stopId)!,route=routeById.get(t.routeId)!;
  if(pt.minutes==null)throw new Error("Unpublished boarding time");
  const stops=pointsFor(t,date,index);
  return {id:`${t.id}:${date}:${stop.id}`,tripId:t.id,routeId:t.routeId,providerId:t.providerId,providerName:route.agency,
    stopId:stop.id,stopName:stop.name,time:printedInstant(date,pt.minutes),destination:stops.at(-1)!.name,stops,
    serviceDate:date,sourceUrl:route.sourceUrl,updatedAt:VERIFIED_AT,
    boardingNotes:`${stop.address}. Run ${t.number}. ${t.note} Scheduled, not live. Dates and restrictions follow the uploaded document.`};
}
export function nearbyDocumentProviders(lat:number,lon:number) {
  return [...new Set(documentTrips.filter(t=>routeById.get(t.routeId)?.type==="intercity"&&t.points.some(pt=>{
    const s=stopById.get(pt.stopId)!;
    return pt.pickup&&s.lat!=null&&s.lon!=null&&distance(lat,lon,s.lat,s.lon)<=3000;
  })).map(t=>t.providerId))];
}
export function documentIntercityDepartures(p:{lat:number;lon:number;provider?:string;date:string;from?:string}) {
  const after=DateTime.fromISO(`${p.date}T${p.from||"00:00"}`,{zone:ZONE}).toMillis();
  return documentTrips.filter(t=>routeById.get(t.routeId)?.type==="intercity"&&(!p.provider||p.provider===t.providerId)&&activeDocumentTrip(t,p.date))
    .flatMap(t=>{
      const candidates=t.points.map((pt,index)=>({pt,index,s:stopById.get(pt.stopId)!})).filter(({pt,s})=>pt.pickup&&pt.minutes!=null&&
        s.lat!=null&&s.lon!=null&&distance(p.lat,p.lon,s.lat,s.lon)<=3000)
        .sort((a,b)=>distance(p.lat,p.lon,a.s.lat!,a.s.lon!)-distance(p.lat,p.lon,b.s.lat!,b.s.lon!));
      const b=candidates[0];if(!b)return [];
      const d=departureFor(t,p.date,b.index);
      return Date.parse(d.time)>=after?[d]:[];
    });
}
export function documentTimetable(p:{stopId?:string;routeId?:string;direction?:string;date:string;from?:string;offset?:number;limit?:number}) {
  const day=DateTime.fromISO(p.date,{zone:ZONE}),from=p.from||"00:00";
  if(!day.isValid||day.toISODate()!==p.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(from))throw new Error("Invalid service date or time");
  const after=DateTime.fromISO(`${p.date}T${from}`,{zone:ZONE}).toMillis();
  const departures=documentTrips.filter(t=>(!p.routeId||t.routeId===p.routeId)&&(!p.direction||p.direction===t.direction)&&activeDocumentTrip(t,p.date)).flatMap(t=>{
    const index=p.stopId?t.points.findIndex(pt=>pt.stopId===p.stopId):0,pt=t.points[index];
    if(!pt||pt.minutes==null||!pt.pickup)return [];
    const d=departureFor(t,p.date,index),r=routeById.get(t.routeId)!;
    return Date.parse(d.time)<after?[]:[{id:d.id,tripId:d.tripId,stopId:d.stopId,stopName:d.stopName,routeId:d.routeId,
      routeName:r.name,destination:d.destination,direction:`${t.direction} · ${t.note}`,time:d.time}];
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const provider=(p.routeId||p.stopId||"").split(":")[0],status=documentServiceStatus(provider,p.date);
  return {departures:departures.slice(p.offset||0,(p.offset||0)+(p.limit||40)),total:departures.length,offset:p.offset||0,limit:p.limit||40,date:p.date,
    message:status||"Uploaded published timetable · America/New_York · only boardable, explicitly timed departures. Blank, drop-off-only and unpublished weekend/holiday times are not invented."};
}
export function documentRoute(id:string,direction?:string) {
  const route=documentCatalog().routes.find(r=>r.id===id);
  if(!route)return;
  const trips=documentTrips.filter(t=>t.routeId===id),directions=[...new Set(trips.map(t=>t.direction))];
  const selected=trips.filter(t=>!direction||t.direction===direction).sort((a,b)=>b.points.length-a.points.length)[0]||trips[0];
  const ids=[...new Set([...(selected?.points.map(p=>p.stopId)||[]),...trips.flatMap(t=>t.points.map(p=>p.stopId))])];
  const catalog=documentCatalog();
  return {route,directions,shape:[],vehicles:[],alerts:[],stops:ids.flatMap(id=>catalog.stops.filter(s=>s.id===id)),
    timetableStops:ids.map((id,sequence)=>({id,name:stopById.get(id)!.name,sequence}))};
}
export function documentArrivals(stop:TransitStop,now=Date.now()):Arrival[] {
  const date=DateTime.fromMillis(now,{zone:ZONE});
  const data=documentTimetable({stopId:stop.id,date:date.toISODate()!,from:date.toFormat("HH:mm"),limit:100});
  return data.departures.filter(d=>Date.parse(d.time)<=now+2*3600000).map(d=>({
    id:d.id,routeId:d.routeId,routeName:d.routeName,color:routeById.get(d.routeId)!.color,direction:d.direction,
    destination:d.destination,minutes:Math.max(0,Math.ceil((Date.parse(d.time)-now)/60000)),source:"scheduled",
    updatedAt:VERIFIED_AT,status:"Published timetable",scheduledAt:d.time,tripId:d.tripId,
  }));
}
