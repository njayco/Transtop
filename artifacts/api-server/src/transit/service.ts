import { db, pool, stops, routes, feedSnapshots } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { adapters } from "./adapters";
import { demoArrivals, demoAlerts } from "./demo";
import { feedsFor, fresh, liveAlerts, feedStatus, mapVehicles, reportedStopVehicles } from "./realtime";
import { catalogVehicles } from "./vehicle-catalog";
import { scheduledArrivals } from "./schedules";
import { communityArrivals } from "./estimator";
import { geocodeAddress } from "./geocoder";
import { distance, type Mode, type Arrival, type TransitStop, type TransitRoute, type RouteDetail } from "./types";
import { DateTime } from "luxon";
import { ZONE } from "./time";
import { patternLabel,resolvePattern } from "./catalog";
import { journeyHealth } from "./journeys";
import { stopTimesMode } from "./generations";
import { tripIdentity } from "./bus-time";
import { intercityCatalog, intercityArrivals, intercityRoute, intercityProviders } from "./intercity/service";
import { documentArrivals,documentRoute,isDocumentId } from "./intercity/uploaded-service";
import { amtrakArrivals } from "./amtrak-service";
import { amtrakHealth } from "./amtrak-live";
import { isIbgId } from "./intercity/ibg-model";
import { ibgRouteDetail, primaryIbgCatalog } from "./intercity/ibg-browse";

let stopCache:{at:number;demo:TransitStop[];live:TransitStop[]}|undefined;
export async function allStops(mode:Mode) {
  if(!stopCache||Date.now()-stopCache.at>60000){
    const data=await db.select().from(stops).where(inArray(stops.mode,["live","demo"]));
    stopCache={at:Date.now(),demo:data.filter(s=>s.mode==="demo").map(s=>s.data as TransitStop),
      live:data.filter(s=>s.mode==="live").map(s=>s.data as TransitStop)};
  }
  return mode==="live"?[...stopCache.live,...(await intercityCatalog()).stops]:stopCache[mode];
}
export async function trackedVehicles(mode:Mode="live"){
  if(mode==="demo")return [];
  return catalogVehicles(mapVehicles(mode),reportedStopVehicles(mode),await allStops(mode));
}
export function officialArrivals(stop:TransitStop,now=Date.now()) {
  const agency=stop.id.split(":")[0], raw=stop.rawId||stop.id.slice(agency.length+1);
  const arrivals:Arrival[]=[], excluded=new Set<string>();
  for(const f of feedsFor(agency)) {
    if(!fresh(f,now))continue;
    for(const e of f.entities){
      const t=e.tripUpdate;if(!t?.trip)continue;
      if(agency==="mta-bus"&&(!t.timestamp||now-Number(t.timestamp)*1000>60000||Number(t.timestamp)*1000>now+30000))continue;
      const trip=t.trip, tripId=`${agency}:${trip.tripId}`;
      if(trip.scheduleRelationship===3||trip.scheduleRelationship===7){excluded.add(tripId);continue;}
      for(const st of t.stopTimeUpdate||[]){
        const matches=st.stopId===raw||st.stopId===raw+"N"||st.stopId===raw+"S";
        if(st.scheduleRelationship===1){excluded.add(`${tripId}|${st.stopId}`);continue;}
        if(!matches||st.scheduleRelationship===2)continue;
        const when=Number(st.arrival?.time||st.departure?.time);
        if(!when||when*1000<now-30000||when*1000>now+7200000)continue;
        const route=stop.routes.find(r=>r.id===`${agency}:${trip.routeId}`);
        if(!route)continue;
        const north=st.stopId.endsWith("N");
        const direction=agency==="mta-subway"?(north?"Uptown":"Downtown"):agency==="mta-bus"?(trip.directionId===1?"Downtown":"Uptown"):(trip.directionId===1?"Inbound":"Outbound");
        const destination=agency==="mta-subway"?(north?"Uptown & The Bronx / Queens":"Downtown & Brooklyn"):trip.transtopHeadsign|| (agency==="mta-bus"?`${route.name} · direction ${trip.directionId??"not reported"}`:direction);
        arrivals.push({id:`live:${tripId}:${st.stopId}`,routeId:route.id,routeName:route.name,color:route.color,direction,destination,
          minutes:Math.max(0,Math.ceil((when*1000-now)/60000)),source:"live",updatedAt:new Date(f.timestamp*1000).toISOString(),
          status:"Live agency prediction",scheduledAt:new Date(when*1000).toISOString(),tripId});
      }
    }
  }
  return {arrivals:arrivals.sort((a,b)=>a.minutes-b.minutes),excluded};
}
export async function enrich(stop:TransitStop,mode:Mode,deep=false):Promise<TransitStop> {
  if(mode==="demo")return demoArrivals(stop);
  if(stop.id.startsWith("amtrak:"))return {...stop,arrivals:await amtrakArrivals(stop)};
  if(isDocumentId(stop.id))return {...stop,arrivals:documentArrivals(stop)};
  if(stop.type==="intercity")return {...stop,arrivals:await intercityArrivals(stop)};
  const {arrivals:official,excluded}=officialArrivals(stop);
  const community=deep?await communityArrivals(stop):[];
  const schedule=official.length>=3&&!deep?[]:await scheduledArrivals(stop,excluded);
  // Official predictions always win per trip; a community estimate can only
  // replace a schedule for the same unambiguous trip, never fresh official data.
  const liveTrips=new Set(official.map(a=>tripIdentity(a.tripId))), communityTrips=new Set(community.map(a=>tripIdentity(a.tripId)));
  const arrivals=[...official,...community.filter(a=>!liveTrips.has(tripIdentity(a.tripId))),...schedule.filter(a=>!liveTrips.has(tripIdentity(a.tripId))&&!communityTrips.has(tripIdentity(a.tripId)))]
    .sort((a,b)=>a.minutes-b.minutes).slice(0,36);
  return {...stop,arrivals,alerts:liveAlerts().filter(a=>stop.routes.some(r=>a.routeIds.includes(r.id)))};
}
const knownPlaces=[
  {terms:["new haven"],lat:41.297172,lon:-72.925945},
  {terms:["hartford"],lat:41.768960,lon:-72.681831},
  {terms:["stamford"],lat:41.0469,lon:-73.5415},
  {terms:["new britain"],lat:41.6657,lon:-72.7838},
  {terms:["waterbury"],lat:41.5545,lon:-73.0438},
  {terms:["meriden"],lat:41.538894,lon:-72.801485},
  {terms:["new london"],lat:41.3542,lon:-72.0930},
  {terms:["old saybrook"],lat:41.3006,lon:-72.3773},
  {terms:["springfield"],lat:42.106137,lon:-72.593041},
  {terms:["easton"],lat:40.689434071649,lon:-75.209040322102},
  {terms:["pohatcong","phillipsburg"],lat:40.677134426789,lon:-75.142608109327},
  {terms:["wall street","wall st"],lat:40.703284765181,lon:-74.010092405239},
  {terms:["port authority","pabt"],lat:40.756143,lon:-73.990672},
  {terms:["times square","times sq","midtown","42nd street","42 st","7th avenue"],lat:40.75529,lon:-73.98749},
  {terms:["bryant park","new york public library","fifth avenue"],lat:40.7536,lon:-73.9832},
  {terms:["penn station","penn","madison square garden","34th street","moynihan"],lat:40.7506,lon:-73.9935},
  {terms:["grand central","lexington","42 east"],lat:40.7527,lon:-73.9772},
  {terms:["union square","14th street"],lat:40.73574,lon:-73.99057},
  {terms:["mineola","long island"],lat:40.7409,lon:-73.6409},
  {terms:["jamaica"],lat:40.7003,lon:-73.8087},
  {terms:["atlantic terminal","barclays"],lat:40.6843,lon:-73.9777},
];
export async function nearby(params:{mode?:Mode;q?:string;type?:string;lat?:number;lon?:number;agency?:string;serviceClass?:string}) {
  const mode=params.mode||"demo", q=(params.q||"").trim().toLowerCase().slice(0,180);
  let lat=params.lat??40.75529,lon=params.lon??-73.98749;
  let foundPlace=false;
  const known=q&&!/^\d+\s+\S/.test(q)?knownPlaces.find(p=>p.terms.some(t=>q.includes(t))):undefined;
  if(known){lat=known.lat;lon=known.lon;foundPlace=true;}
  if(q&&/^\d+\s+\S/.test(q)){
    const point=await geocodeAddress(q);
    if(point){lat=point.lat;lon=point.lon;foundPlace=true;}
  }
  let rows=(await allStops(mode)).filter(s=>!s.parent&&s.routes.length&&(!params.type||params.type==="all"||s.type===params.type)&&
    (!params.agency||s.id.split(":")[0]===params.agency||s.routes.some(r=>r.agencyId===params.agency))&&(!params.serviceClass||params.serviceClass==="all"||s.routes.some(r=>r.serviceClass===params.serviceClass)));
  const exact=q?rows.find(s=>s.name.toLowerCase().includes(q)):undefined;
  if(exact&&!foundPlace){lat=exact.lat;lon=exact.lon;}
  if(q&&!foundPlace)rows=rows.filter(s=>s.name.toLowerCase().includes(q)||s.neighborhood?.toLowerCase().includes(q)||s.routes.some(r=>r.name.toLowerCase()===q||r.id.toLowerCase()===q));
  rows=rows.map(s=>{const d=distance(lat,lon,s.lat,s.lon);return {...s,distance:Math.round(d),walkingMinutes:Math.max(1,Math.round(d/75))};})
    .filter(s=>s.type!=="intercity"&&!s.id.startsWith("nj-transit:")||s.distance<=3000)
    .sort((a,b)=>a.distance-b.distance).slice(0,16);
  const enriched=await Promise.all(rows.map(s=>enrich(s,mode)));
  const coverageWarning=mode==="live"&&(!params.type||params.type==="all"||params.type==="intercity")?(await primaryIbgCatalog()).coverageWarning:"";
  return {stops:enriched,mode,updatedAt:new Date().toISOString(),centerLat:lat,centerLon:lon,
    message:(mode==="demo"?"Demo data · illustrative arrivals, not for travel planning":rows.length?rows.some(s=>isIbgId(s.id))?"Includes labeled IBG research references, not verified current service. Confirm research stop locations and schedules with the carrier.":"Official feeds redistributed by Transtop. Predictions may be unavailable or stale.":"No matching imported stops. Integration not configured for this location or search. Try a station name or supported neighborhood.")+(coverageWarning?` ${coverageWarning}`:"")};
}
export async function stopDetail(id:string,mode:Mode) {
  const s=(await allStops(mode)).find(s=>s.id===id);
  return s?enrich(s,mode,true):undefined;
}
export async function routeDetail(id:string,mode:Mode,direction?:string):Promise<RouteDetail|undefined> {
  if(mode==="live"&&isIbgId(id))return ibgRouteDetail(id,direction);
  if(mode==="live"&&isDocumentId(id))return documentRoute(id,direction);
  if(mode==="live"&&id.startsWith("martz:"))return intercityRoute(id);
  const [r]=await db.select().from(routes).where(and(eq(routes.id,id),eq(routes.mode,mode)));
  if(!r)return;
  const route=r.data as TransitRoute, agency=id.split(":")[0], raw=id.slice(agency.length+1);
  let ss=(await allStops(mode)).filter(s=>!s.parent&&s.routes.some(r=>r.id===id)),shape:number[][]=[];
  let directions=route.type==="rail"?["Outbound","Inbound"]:["Uptown","Downtown"];
  if(mode==="demo"){
    ss=ss.sort((a,b)=>a.lat-b.lat);
    if(direction==="Downtown"||direction==="Inbound")ss.reverse();
  }
  if(mode==="live"){
    const {rows:patterns}=await pool.query(`SELECT DISTINCT data->>'direction_id' AS direction,data->>'trip_headsign' AS headsign
      FROM transit_trips WHERE mode='live' AND agency=$1 AND data->>'route_id'=$2 ORDER BY 1,2`,[agency,raw]);
    directions=patterns.map(p=>patternLabel({direction_id:p.direction,trip_headsign:p.headsign}));
    const selected=resolvePattern(directions,direction),dir=selected?.split(" · ")[0],headsign=selected?.split(" · ").slice(1).join(" · ");
    const {rows}=await pool.query(`SELECT id,data FROM transit_trips t WHERE mode='live' AND agency=$1 AND data->>'route_id'=$2
      AND COALESCE(NULLIF(data->>'direction_id',''),'0')=$3
      AND COALESCE(NULLIF(data->>'trip_headsign',''),'Direction ' || COALESCE(NULLIF(data->>'direction_id',''),'0'))=$4
      ORDER BY (SELECT max(st.sequence) FROM transit_stop_times st WHERE st.mode=${stopTimesMode("$1::text")} AND st.trip_id=t.id) DESC,t.id LIMIT 1`,[agency,raw,dir,headsign]);
    if(rows[0]){
      const {rows:ordered}=await pool.query(`SELECT s.data FROM transit_stop_times st JOIN transit_stops s ON s.id=st.stop_id AND s.mode='live'
        WHERE st.mode=${stopTimesMode("$2::text")} AND st.trip_id=$1 ORDER BY st.sequence`,[rows[0].id,agency]);
      const seen=new Set<string>(), all=await allStops(mode);
      ss=ordered.map(o=>{const s=o.data as TransitStop;return s.parent?all.find(p=>p.id===`${agency}:${s.parent}`)||s:s;}).filter(s=>{if(seen.has(s.id))return false;seen.add(s.id);return true;});
      const {rows:sh}=await pool.query("SELECT data FROM transit_shapes WHERE mode='live' AND id=$1",[`${agency}:${rows[0].data.shape_id}`]);
      shape=sh[0]?.data.coordinates||[];
    }else ss=[];
  }
  if(!shape.length&&mode==="demo")shape=ss.map(s=>[s.lon,s.lat]);
  const vehicles=(await trackedVehicles(mode)).filter(v=>v.routeId===id);
  return {route,stops:await Promise.all(ss.map(s=>enrich(s,mode))),shape,vehicles,
    alerts:(mode==="demo"?demoAlerts:liveAlerts()).filter(a=>a.routeIds.includes(id)),
    directions};
}
export async function sources() {
  const imports=await db.select().from(feedSnapshots).where(eq(feedSnapshots.mode,"live"));
  const today=DateTime.now().setZone(ZONE).toFormat("yyyyMMdd");
  const {rows:counts}=await pool.query(`SELECT agency,'routes' AS kind,count(*)::int AS count FROM transit_routes WHERE mode='live' GROUP BY agency
    UNION ALL SELECT agency,'stops',count(*)::int FROM transit_stops WHERE mode='live' GROUP BY agency`);
  const result=adapters.map(a=>{
    const imp=imports.find(i=>i.id===`${a.id}:static`),health=feedStatus(a.id),data=imp?.data;
    const lastError=imports.find(i=>i.id===`${a.id}:import-error`);
     const amtrak=a.id==="amtrak"?amtrakHealth():undefined;
     const status=!imp?(a.staticUrl?"not imported":a.status):data?.serviceEnd&&data.serviceEnd<today?"expired schedules":
      data?.components?.some((c:any)=>c.serviceEnd<today)?"partial schedules":
       data?.serviceStart&&data.serviceStart>today?"future schedules":amtrak?.fresh?"schedules + live train reports":
        health.fresh?"schedules + live predictions":"scheduled only";
    const failed=lastError&&(!data||lastError.data.at>data.importedAt)?lastError.data.message:undefined;
    return {id:a.id,agency:a.name,type:a.type,status,description:a.setup+
      (a.id==="mta-bus"&&!process.env.MTA_BUS_TIME_API_KEY?" Live Bus Time credentials are not configured.":"")+
       (amtrak?` ${amtrak.fresh} fresh train reports; ${amtrak.unresolved} unresolved identities. Tracking checked ${amtrak.checkedAt||"not yet"}. Unresolved trains never replace schedules.`:"")+
      (data&&data.components?.length>1?` Packages: ${data.components.map((c:any)=>`${c.id} (${c.serviceStart}–${c.serviceEnd})`).join(", ")}.`:"")+
       (imp&&!amtrak?` ${health.fresh}/${health.total} fresh live feeds.`:""),
      routeCount:counts.find(c=>c.agency===a.id&&c.kind==="routes")?.count||0,stopCount:counts.find(c=>c.agency===a.id&&c.kind==="stops")?.count||0,
       importedAt:data?.importedAt,serviceStart:data?.serviceStart,serviceEnd:data?.serviceEnd,sourceUrl:data?.sourceUrl,lastError:failed||amtrak?.error,
       url:a.documentation,updatedAt:amtrak?.updatedAt||health.updatedAt||data?.importedAt||null};
  });
  const google=journeyHealth();
  const intercity=(await intercityProviders()).map(p=>({id:p.id,agency:p.name,type:p.id==="nj-transit"?"bus":"intercity",status:p.status,
    description:p.description,url:p.url,updatedAt:p.updatedAt||p.checkedAt,lastError:p.lastError}));
  return [...result,...intercity,{id:"google-routes",agency:"Google journey planning",type:"journey planner",
    status:google.status,lastError:"message" in google?google.message:undefined,
    description:"On-demand Google transit itineraries, not a complete agency catalog or official live arrival feed. Requires Routes API, Google Cloud billing and a separate server key. Provider access is checked when a journey is requested.",
    url:"https://developers.google.com/maps/documentation/routes/transit-route",updatedAt:google.updatedAt}];
}
