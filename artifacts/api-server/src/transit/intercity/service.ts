import { db, feedSnapshots } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { logger } from "../../lib/logger";
import { distance, type Arrival, type TransitRoute, type TransitStop } from "../types";
import { ZONE } from "../time";
import { MARTZ_URL, providerInventory } from "./providers";
import { parseMartz, holidayDate, printedInstant, type MartzDataset } from "./martz";
import { documentCatalog,documentIntercityDepartures,nearbyDocumentProviders,documentServiceStatus,documentArrivals,documentRoute,documentTimetable,isDocumentId } from "./uploaded-service";
import { WALL_CLOSURE,VERIFIED_AT } from "./uploaded-data";

const DATA_ID = "intercity:martz", ERROR_ID = "intercity:martz:error";
const MAX_AGE = 72 * 3600000;
export const NEARBY_RADIUS = 3000;
type Point = { name: string; address: string; lat?: number; lon?: number };
// Official addresses: martzbus.com/customer-service; coordinates resolved by
// US Census on 2026-10-30. These are address-level locations, not gate GPS.
export const boardingPoints: Record<string, Point> = {
  NY: { name:"Port Authority Bus Terminal · Martz",address:"625 8th Avenue, New York, NY",lat:40.756143471891,lon:-73.990671823839 },
  DWG: { name:"Martz Delaware Water Gap",address:"1082 Foxtown Hill Road, Stroudsburg, PA 18360",lat:40.985416501445,lon:-75.155432835423 },
  MTP: { name:"Martz Mount Pocono",address:"2 Fork Street, Mount Pocono, PA 18344",lat:41.118007552019,lon:-75.354184837523 },
  SCR: { name:"Scranton · Lackawanna Transit Center",address:"30 Lackawanna Avenue, Scranton, PA",lat:41.410385157558,lon:-75.670921822588 },
  WB: { name:"Wilkes-Barre Intermodal Terminal",address:"Rear 47 S Washington Street, Wilkes-Barre, PA",lat:41.243827182784,lon:-75.882388289521 },
  PV: { name:"Panther Valley 7-Eleven",address:"1642 County Road 517, Hackettstown, NJ 07840",lat:40.911786583727,lon:-74.818924849835 },
  PNR: { name:"East Stroudsburg Park & Ride",address:"545 Independence Road, East Stroudsburg, PA 18301",lat:41.004636858227,lon:-75.157192484244 },
  WVM: { name:"Wyoming Valley Mall · Martz parking pickup",address:"Kidder/Mundy entrance, first parking row, Wilkes-Barre Township, PA; exact map location not verified" },
  SR209: { name:"Marshalls Creek State Route 209 Park & Ride",address:"209 Park & Ride, near Price Chopper, East Stroudsburg, PA; exact map location not verified" },
};
let cached: MartzDataset | undefined, lastError: string | undefined, loadedAt = 0;
let refreshPromise: Promise<void> | undefined;
async function dataset() {
  if (Date.now()-loadedAt>60_000) {
    const rows=await db.select().from(feedSnapshots).where(and(eq(feedSnapshots.mode,"live"),eq(feedSnapshots.agency,"intercity")));
    cached=rows.find(r=>r.id===DATA_ID)?.data as MartzDataset|undefined;
    lastError=rows.find(r=>r.id===ERROR_ID)?.data.message as string|undefined;
    loadedAt=Date.now();
  }
  return cached;
}
export function usable(data:MartzDataset|undefined,now=Date.now()) {
  return !!data&&Number.isFinite(Date.parse(data.fetchedAt))&&now-Date.parse(data.fetchedAt)<=MAX_AGE&&Date.parse(data.fetchedAt)<=now+30000;
}
async function fetchText(url:string,limit=2_000_000) {
  // Fixed allowlist, no redirects, no arbitrary URLs or user-supplied destinations.
  if(![MARTZ_URL,"https://martzbus.com/robots.txt","https://martzbus.com/customer-service/"].includes(url))throw new Error("Source not allowlisted");
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:"error",
    headers:{"User-Agent":"Transtop schedule reader; public timetables; daily refresh"}});
  if(!response.ok||!response.body)throw new Error("Official timetable unavailable");
  let size=0;const chunks:Uint8Array[]=[];
  for await(const part of response.body){size+=part.length;if(size>limit)throw new Error("Timetable exceeds size limit");chunks.push(part);}
  return Buffer.concat(chunks).toString("utf8");
}
export function refreshIntercity() {
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    try{
      const old=await dataset();
      if(usable(old)&&Date.now()-Date.parse(old!.fetchedAt)<22*3600000)return;
      const robots=await fetchText("https://martzbus.com/robots.txt",100000);
      // Fail closed if public-path rules change; never bypass disallowed paths.
      if([...robots.matchAll(/^Disallow:[ \t]*(.*)$/gmi)].some(m=>m[1].trim()&&m[1].trim()!=="/wp-admin/"))
        throw new Error("Source automated access rules changed");
      const [html,locations]=await Promise.all([fetchText(MARTZ_URL),fetchText("https://martzbus.com/customer-service/")]);
      if(!locations.includes("1082 Foxtown")||!locations.includes("625 8th")||!locations.includes("2 Fork Street"))
        throw new Error("Boarding location information changed");
      const next=parseMartz(html);
      await db.insert(feedSnapshots).values({id:DATA_ID,mode:"live",agency:"intercity",data:next})
        .onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data:next,updatedAt:new Date()}});
      await db.delete(feedSnapshots).where(and(eq(feedSnapshots.mode,"live"),eq(feedSnapshots.id,ERROR_ID)));
      cached=next;lastError=undefined;loadedAt=Date.now();
      logger.info({trips:next.trips.length,omitted:next.omittedTrips},"Intercity published timetable refreshed");
    }catch{
      lastError="Official source unavailable or changed; last validated data retained for at most 72 hours.";
      await db.insert(feedSnapshots).values({id:ERROR_ID,mode:"live",agency:"intercity",data:{message:lastError}})
        .onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data:{message:lastError},updatedAt:new Date()}});
      logger.warn("Intercity timetable refresh failed; unverified departure times withheld");
    }
  })().finally(()=>{refreshPromise=undefined;});
  return refreshPromise;
}
export async function intercityProviders() {
  const data=await dataset();
  return providerInventory.map(p=>p.id==="transbridge"?{...p,status:"imported · schedules + verified holidays",updatedAt:VERIFIED_AT,
    access:"15 user-supplied carrier PDFs checked against current official schedules, holiday notices and stop-location links.",
    description:"Allentown/Clinton/NYC, Doylestown/Flemington/NYC, Newark Airport, Wind Creek and Wall Street. Regular weekday/weekend calendars and exact November 26–27, 2026 holiday replacements; duplicate airport/casino extracts do not create extra buses. "+WALL_CLOSURE}:
    p.id==="nj-transit"?{...p,status:"imported · local routes 890/891 only",updatedAt:VERIFIED_AT,
      access:"User-supplied NJ TRANSIT T1890 brochure; no developer credentials or private feeds used.",
      terminalService:"These local NJ/PA routes do not serve Port Authority.",
      description:"Weekday 890/891 timetables, published fares, lift-equipped and flex-service information. Other NJ TRANSIT routes are not imported; full-feed access remains separate."}:
    p.id!=="martz"?p:{...p,
    status:usable(data)?"imported · partial timetable":data?"stale · times withheld":"link-only",
    updatedAt:data?.fetchedAt,lastError,
    access:"Public factual timetable rows; robots allow public paths; ticket terms reviewed. No booking data scraped.",
    description:p.description+` ${data?.trips.length||0} validated recurring trips; ${data?.omittedTrips||0} special/ambiguous rows omitted. Holidays require carrier confirmation. Address-level map points, not exact boarding GPS.`,
  });
}
function routeFor(t:MartzDataset["trips"][number]):TransitRoute {
  return {id:t.id,name:`Martz ${t.number}`,longName:`${boardingPoints[t.points[0].code].name} → ${boardingPoints[t.points.at(-1)!.code].name}`,
    type:"intercity",color:"#df8b45",agency:"Martz Trailways",agencyId:"martz"};
}
export async function intercityCatalog() {
  const data=await dataset();
  const documents=documentCatalog();
  if(!usable(data))return documents;
  const routes=data!.trips.map(routeFor);
  const stops:TransitStop[]=Object.entries(boardingPoints).flatMap(([code,p])=>{
    const serving=data!.trips.filter(t=>t.points.some(v=>v.code===code)).map(routeFor);
    return p.lat==null||p.lon==null||!serving.length?[]:[{
      id:`martz:${code}`,rawId:code,name:p.name,lat:p.lat,lon:p.lon,type:"intercity",agency:"Martz Trailways",
      routes:serving,arrivals:[],alerts:[],accessible:false,updatedAt:data!.fetchedAt,distance:0,walkingMinutes:0,
      neighborhood:p.address,
    }];
  });
  return {routes:[...routes,...documents.routes],stops:[...stops,...documents.stops]};
}
async function martzDepartures(p:{lat:number;lon:number;provider?:string;date:string;from?:string}) {
  const data=await dataset(),allProviders=await intercityProviders();
  const today=DateTime.now().setZone(ZONE).startOf("day"),date=DateTime.fromISO(p.date,{zone:ZONE});
  const from=p.from||"00:00";
  if(!date.isValid||date.toISODate()!==p.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(from))throw new Error("Invalid intercity date or time");
  const localPoints=Object.entries(boardingPoints).filter(([,s])=>s.lat!=null&&s.lon!=null&&distance(p.lat,p.lon,s.lat,s.lon)<=NEARBY_RADIUS);
  const near=localPoints.length>0;
  const terminal=boardingPoints.NY;
  const atTerminal=distance(p.lat,p.lon,terminal.lat!,terminal.lon!)<=NEARBY_RADIUS;
  // Only current official location evidence is sufficient for nearby filtering.
  // Other directory entries remain visible in the global coverage checklist.
  const nearbyIds=new Set([...(near?["martz"]:[]),...(atTerminal?["greyhound","transbridge"]:[])]);
  const providers=allProviders.filter(v=>nearbyIds.has(v.id));
  const base={providers,updatedAt:data?.fetchedAt||new Date().toISOString(),radiusMeters:NEARBY_RADIUS};
  const empty=(message:string)=>({...base,departures:[],message});
  if(!near)return empty("No verified intercity boarding stops within 3 km. Other providers may serve this area; check the full carrier coverage in Settings.");
  if(p.provider&&p.provider!=="martz")return empty("This provider has no verified nearby imported timetable. Clear the provider filter or check carrier coverage.");
  if(!usable(data))return empty("No fresh validated intercity timetable is available here. Use the official carrier schedule; old times are withheld.");
  if(p.date<data!.effectiveDate||date>today.plus({days:30}))return empty("This date is outside the verified timetable horizon (effective date through the next 30 days). Check the carrier.");
  if(holidayDate(p.date))return empty("Holiday service has not been verified for this date. Regular weekday/weekend times are withheld; confirm with Martz.");
  const after=date.set({hour:+from.slice(0,2),minute:+from.slice(3),second:0,millisecond:0}).toMillis();
  const departures:any[]=[];
  // Previous service day is necessary for printed trips continuing after midnight.
  for(const serviceDay of [date.minus({days:1}),date]) {
    const serviceDate=serviceDay.toISODate()!;
    if(serviceDate<data!.effectiveDate||holidayDate(serviceDate))continue;
    for(const trip of data!.trips.filter(t=>t.days.includes(serviceDay.weekday))) {
      const boarding=trip.points.slice(0,-1).filter(pt=>localPoints.some(([c])=>c===pt.code))
        .sort((a,b)=>{const aa=boardingPoints[a.code],bb=boardingPoints[b.code];return distance(p.lat,p.lon,aa.lat!,aa.lon!)-distance(p.lat,p.lon,bb.lat!,bb.lon!);})[0];
      if(!boarding)continue;
      try{
        const index=trip.points.indexOf(boarding),time=printedInstant(serviceDate,boarding.minutes);
        if(Date.parse(time)<after||DateTime.fromISO(time,{zone:ZONE}).toISODate()!==p.date)continue;
        const stops=trip.points.slice(index).map((pt,sequence)=>({id:`martz:${pt.code}`,sequence,
          ...boardingPoints[pt.code],time:printedInstant(serviceDate,pt.minutes)}));
        departures.push({id:`${trip.id}:${serviceDate}:${boarding.code}`,tripId:trip.id,routeId:trip.id,
          providerId:"martz",providerName:"Martz Trailways",stopId:`martz:${boarding.code}`,stopName:boardingPoints[boarding.code].name,
          time,destination:stops.at(-1)!.name,stops,serviceDate,sourceUrl:MARTZ_URL,updatedAt:data!.fetchedAt,
          boardingNotes:`${boardingPoints[boarding.code].address}. Address-level map location. ${boarding.code==="NY"&&trip.gate?`Published gate ${trip.gate} (checked ${data!.fetchedAt.slice(0,10)}); confirm current gate before boarding. `:""}Published schedule only, not live. Special trips/holidays are not included.`});
      }catch{/* Ambiguous DST/civil-clock observations are not displayed. */}
    }
  }
  return {...base,departures:departures.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).slice(0,100),
    message:`Published Martz timetable · America/New_York · within 3 km. Partial coverage: special/ambiguous trips and unverified holidays are omitted. Other carriers remain linked in Settings; missing times do not mean no service.`};
}
export async function intercityDepartures(p:{lat:number;lon:number;provider?:string;date:string;from?:string}) {
  const original=await martzDepartures(p),all=await intercityProviders();
  const extraIds=nearbyDocumentProviders(p.lat,p.lon);
  const providers=all.filter(v=>extraIds.includes(v.id)||original.providers.some(s=>s.id===v.id));
  const documents=documentIntercityDepartures(p);
  const departures=[...(p.provider&&p.provider!=="martz"?[]:original.departures),...documents]
    .sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).slice(0,100);
  const transbridgeHere=extraIds.includes("transbridge")||providers.some(v=>v.id==="transbridge");
  const notice=transbridgeHere?documentServiceStatus("transbridge",p.date):"";
  const message=p.provider==="transbridge"||extraIds.length>0&&original.providers.length===0?
    (notice||"Trans-Bridge published schedules: Allentown/Clinton, Doylestown/Flemington, Newark Airport, Wind Creek and Wall Street. Weekday/weekend calendars and verified November 26–27 replacements. Drop-off-only and untimed/reservation-only stops are not boarding predictions. Confirm gates and terminal pickup locations."):
    original.message+(transbridgeHere?` Trans-Bridge: ${notice||"Published regular and verified November 26–27 holiday schedules are imported."}`:"");
  return {...original,providers,departures,message,updatedAt:documents.length||p.provider==="transbridge"?VERIFIED_AT:original.updatedAt};
}
export async function intercityArrivals(stop:TransitStop,now=Date.now()):Promise<Arrival[]> {
  if(isDocumentId(stop.id))return documentArrivals(stop,now);
  const d=DateTime.fromMillis(now,{zone:ZONE});
  const result=await intercityDepartures({lat:stop.lat,lon:stop.lon,date:d.toISODate()!,from:d.toFormat("HH:mm")});
  return result.departures.filter(t=>t.stopId===stop.id&&Date.parse(t.time)<=now+2*3600000).map(t=>({
    id:t.id,routeId:t.routeId,routeName:`Martz ${t.tripId.split(":").at(-1)}`,color:"#df8b45",
    direction:"Published departure",destination:t.destination,minutes:Math.max(0,Math.ceil((Date.parse(t.time)-now)/60000)),
    source:"scheduled",updatedAt:t.updatedAt,status:"Published · partial timetable",scheduledAt:t.time,tripId:t.tripId,
  }));
}
export async function intercityRoute(id:string) {
  if(isDocumentId(id))return documentRoute(id);
  const data=await dataset(),catalog=await intercityCatalog();
  const trip=data?.trips.find(t=>t.id===id),route=catalog.routes.find(r=>r.id===id);
  if(!trip||!route)return;
  return {route,stops:trip.points.flatMap(p=>catalog.stops.filter(s=>s.id===`martz:${p.code}`)),shape:[],vehicles:[],alerts:[],
    directions:[boardingPoints[trip.points.at(-1)!.code].name]};
}
export async function intercityTimetable(p:{stopId?:string;routeId?:string;direction?:string;date:string;from?:string;offset?:number;limit?:number}) {
  if(isDocumentId(p.stopId)||isDocumentId(p.routeId))return documentTimetable(p);
  const code=p.stopId?.slice("martz:".length),data=await dataset();
  const trip=data?.trips.find(t=>t.id===p.routeId);
  const point=boardingPoints[code||trip?.points[0].code||"NY"];
  if(!point||point.lat==null||point.lon==null)return {departures:[],total:0,offset:p.offset||0,limit:p.limit||40,date:p.date,message:"Boarding location unavailable."};
  const result=await intercityDepartures({lat:point.lat,lon:point.lon,date:p.date,from:p.from});
  const departures=result.departures.filter(t=>(!p.routeId||p.routeId===t.routeId)&&(!p.stopId||p.stopId===t.stopId))
    .map(t=>({id:t.id,tripId:t.tripId,stopId:t.stopId,stopName:t.stopName,routeId:t.routeId,routeName:`Martz ${t.tripId.split(":").at(-1)}`,
      destination:t.destination,direction:t.destination,time:t.time}));
  return {departures:departures.slice(p.offset||0,(p.offset||0)+(p.limit||40)),total:departures.length,offset:p.offset||0,limit:p.limit||40,date:p.date,message:result.message};
}
