import { db, pool, stops, routes, feedSnapshots } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { adapters } from "./adapters";
import { stationAccess } from "./wmata/access";
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
import { isRetiredResearchId } from "./intercity/retired";
import { isTransitland } from "./transitland/model";
import { discover, globalStop, globalRoute, unique } from "./transitland/discovery";
import { globalEnrich } from "./transitland/departures";
import { globalPlace } from "./transitland/places";
import { coverage as globalCoverage, usage } from "./transitland/client";
import { globalVehicles } from "./transitland/vehicles";
import { globalFeedStates } from "./transitland/tracking";
import * as tfl from "./tfl/service";
import { isTfl } from "./tfl/model";
import { preferDirect, matchedRoutes } from "./tfl/crosswalk";
import { odptEnabled, odptSource } from "./odpt/registry";
import { isIdfm, idfmEnabled, IDFM_ZONE, expiredEdition } from "./idfm/model";
import { directStop, findStops as parisStops, parisArrivals, parisRoute } from "./idfm/queries";
import { enrichPrim } from "./idfm/prim";
import { primEnabled } from "./idfm/prim-model";
import * as wmata from "./wmata/realtime";
import { isWmata,boarding,applies as wmataApplies } from "./wmata/model";
import { setupStatus as wmataSetup,dailyLimit as wmataLimit } from "./wmata/client";
import { discoverRegion, recordFor } from "./mobility/registry";
import { enabled as mobilityEnabled } from "./mobility/client";

let stopCache:{at:number;demo:TransitStop[];live:TransitStop[]}|undefined;
export async function allStops(mode:Mode) {
  if(!stopCache||Date.now()-stopCache.at>60000){
    const data=(await db.select().from(stops).where(and(inArray(stops.mode,["live","demo"]),ne(stops.agency,"idfm")))).filter(s=>!isRetiredResearchId(s.id));
    stopCache={at:Date.now(),demo:data.filter(s=>s.mode==="demo").map(s=>s.data as TransitStop),
      live:data.filter(s=>s.mode==="live").map(s=>s.data as TransitStop)};
  }
  return mode==="live"?[...stopCache.live.filter(s=>(!s.odpt||odptEnabled())&&(!s.mobility||mobilityEnabled())),...(await intercityCatalog()).stops]:stopCache[mode];
}
export async function trackedVehicles(mode:Mode="live",bounds?:{west:number;east:number;south:number;north:number},routeId?:string){
  if(mode==="demo")return [];
  return [...await catalogVehicles(mapVehicles(mode),reportedStopVehicles(mode),await allStops(mode)),...await globalVehicles(bounds),...await wmata.vehicles(bounds,routeId)];
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
      if(trip.scheduleRelationship===3||trip.scheduleRelationship===7){excluded.add(stop.mobility?`${tripId}|date:${trip.startDate}`:tripId);continue;}
      for(const st of t.stopTimeUpdate||[]){
        const matches=st.stopId===raw||!stop.mobility&&!stop.odpt&&(st.stopId===raw+"N"||st.stopId===raw+"S");
        if(st.scheduleRelationship===1){excluded.add(stop.mobility?`${tripId}|${st.stopId}|date:${trip.startDate}`:`${tripId}|${st.stopId}`);continue;}
        if(st.scheduleRelationship===2){if(stop.odpt)excluded.add(`${tripId}|${st.stopId}`);continue;}
        if(!matches)continue;
        const when=Number(st.arrival?.time||st.departure?.time);
        if(!when||when*1000<now-30000||when*1000>now+7200000)continue;
        const route=stop.routes.find(r=>r.id===`${agency}:${trip.routeId}`);
        if(!route)continue;
        const north=st.stopId.endsWith("N");
        const direction=stop.mobility||stop.odpt?(t.transtopHeadsign||`Direction ${trip.directionId??"not supplied"}`):agency==="mta-subway"?(north?"Uptown":"Downtown"):agency==="mta-bus"?(trip.directionId===1?"Downtown":"Uptown"):(trip.directionId===1?"Inbound":"Outbound");
        const destination=stop.mobility||stop.odpt?st.transtopHeadsign||t.transtopHeadsign||direction:agency==="mta-subway"?(north?"Uptown & The Bronx / Queens":"Downtown & Brooklyn"):trip.transtopHeadsign|| (agency==="mta-bus"?`${route.name} · direction ${trip.directionId??"not reported"}`:direction);
        arrivals.push({id:`live:${tripId}:${st.stopId}`,routeId:route.id,routeName:route.name,color:route.color,direction,destination,
          minutes:Math.max(0,Math.ceil((when*1000-now)/60000)),source:"live",updatedAt:new Date((stop.mobility||stop.odpt?Number(t.timestamp):f.timestamp)*1000).toISOString(),
          status:"Live agency prediction",scheduledAt:new Date(when*1000).toISOString(),tripId,...(stop.mobility||stop.odpt?{timezone:stop.mobility?.timezone||stop.odpt!.timezone,expiresAt:new Date(Math.min(Number(t.timestamp),f.timestamp)*1000+60000).toISOString()}:{})});
      }
    }
  }
  return {arrivals:arrivals.sort((a,b)=>a.minutes-b.minutes),excluded};
}
export async function enrich(stop:TransitStop,mode:Mode,deep=false):Promise<TransitStop> {
  if(mode==="demo")return demoArrivals(stop);
  if(isIdfm(stop.id)){
    const scheduled={...stop,arrivals:await parisArrivals(stop)};
    return deep?enrichPrim(scheduled):scheduled;
  }
  if(isTfl(stop.id))return deep?tfl.enrich(stop):stop;
  if(isTransitland(stop.id))return deep?globalEnrich(stop):stop;
  if(stop.id.startsWith("amtrak:"))return {...stop,arrivals:await amtrakArrivals(stop)};
  if(isDocumentId(stop.id))return {...stop,arrivals:documentArrivals(stop)};
  if(stop.type==="intercity"&&!stop.mobility)return {...stop,arrivals:await intercityArrivals(stop)};
  if(isWmata(stop.id)){
    const all=await allStops("live"),children=all.filter(s=>s.parent===stop.rawId&&isWmata(s.id));
    if(deep)await wmata.refresh(stop.routes.map(r=>r.type).filter((t):t is "bus"|"subway"=>t==="bus"||t==="subway"));
    const observations=(stop.wmata?.kind==="station"?children.filter(boarding):[stop]).map(s=>wmata.arrivals(s));
    const official=observations.flatMap(o=>o.arrivals),excluded=new Set(observations.flatMap(o=>[...o.excluded]));
    const unmatched=new Set(observations.flatMap(o=>[...o.unmatchedRoutes]));
    const liveTrips=new Set(official.flatMap(a=>a.tripId?[a.tripId]:[]));
    const schedule=(await scheduledArrivals(stop,excluded)).filter(a=>!liveTrips.has(a.tripId!)&&!unmatched.has(a.routeId));
    const enriched=wmata.withStatus({...stop,arrivals:[...official,...schedule].sort((a,b)=>a.minutes-b.minutes).slice(0,36),
      wmata:{...stop.wmata!,locations:children.map(s=>({id:s.id,name:s.name,kind:s.wmata?.kind||"location"}))}});
    // Platform-targeted advisories are visible at the parent with their original
    // stop scope, never promoted to route-wide alerts.
    enriched.alerts=wmata.alerts().filter(a=>wmataApplies(a,stop)||children.some(s=>wmataApplies(a,s)));
    if(deep && stop.wmata && ["station","platform","entrance","passage","boarding area"].includes(stop.wmata.kind))
      enriched.wmata!.access=await stationAccess(stop);
    return enriched;
  }
  const mobilityChildren=stop.mobility&&!stop.parent?(await allStops("live")).filter(s=>s.mobility?.feedId===stop.mobility!.feedId&&s.parent===stop.rawId):[];
  const observations=[stop,...mobilityChildren].map(s=>officialArrivals(s));
  const official=observations.flatMap(o=>o.arrivals),excluded=new Set(observations.flatMap(o=>[...o.excluded]));
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
  {terms:["washington","washington dc","washington d.c.","district of columbia"],lat:38.8983,lon:-77.0281},
  {terms:["arlington","rosslyn"],lat:38.8959,lon:-77.0726},
  {terms:["alexandria"],lat:38.8065,lon:-77.0608},
  {terms:["silver spring"],lat:38.9939,lon:-77.0318},
  {terms:["bethesda"],lat:38.9847,lon:-77.0947},
  {terms:["paris","île-de-france","ile-de-france"],lat:48.8566,lon:2.3522},
  {terms:["versailles"],lat:48.8049,lon:2.1204},
  {terms:["saint-denis","saint denis"],lat:48.9362,lon:2.3574},
  {terms:["sendai","仙台"],lat:38.2602,lon:140.8824},
  {terms:["nishitokyo","西東京","hana bus","はなバス"],lat:35.7483,lon:139.5466},
  {terms:["kochi","kōchi","高知","tosaden","とさでん"],lat:33.5588,lon:133.5422},
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
export async function nearby(params:{mode?:Mode;q?:string;type?:string;lat?:number;lon?:number;agency?:string;serviceClass?:string;cursor?:string}) {
  const mode=params.mode||"demo", q=(params.q||"").trim().toLowerCase().slice(0,180);
  let lat=params.lat??40.75529,lon=params.lon??-73.98749;
  let foundPlace=false;
  const known=q&&!/^\d+\s+\S/.test(q)?knownPlaces.find(p=>p.terms.some(t=>q.includes(t))):undefined;
  if(known){lat=known.lat;lon=known.lon;foundPlace=true;}
  const onlyParis=mode==="live"&&params.agency==="idfm";
  const all=onlyParis?[]:await allStops(mode);
  const parisExact=mode==="live"&&q&&(!foundPlace||!known?.terms.includes(q))?(await parisStops({...params,q},undefined,1)).stops[0]:undefined;
  if(parisExact&&(!foundPlace||parisExact.name.toLowerCase()===q)){lat=parisExact.lat;lon=parisExact.lon;foundPlace=true;}
  const localExact=q?all.find(s=>s.name.toLowerCase()===q||s.routes.some(r=>r.name.toLowerCase()===q)):undefined;
  if(q&&!foundPlace&&!localExact){
    const point=tfl.londonPlace(q)||await globalPlace(q);
    if(point){lat=point.lat;lon=point.lon;foundPlace=true;}
  }
  const paris=mode==="live"?await parisStops({...params,q:foundPlace?undefined:q,lat,lon},
    {south:lat-.10,north:lat+.10,west:lon-.15,east:lon+.15},80):{stops:[],total:0};
  let rows=[...all,...paris.stops].filter(s=>(!s.parent||s.mobility||isIdfm(s.id)||isWmata(s.id))&&boarding(s)&&s.routes.length&&(!params.type||params.type==="all"||s.routes.some(r=>r.type===params.type))&&
    (!params.agency||s.id.split(":")[0]===params.agency||s.routes.some(r=>r.agencyId===params.agency))&&(!params.serviceClass||params.serviceClass==="all"||s.routes.some(r=>r.serviceClass===params.serviceClass)));
  const exact=q?rows.find(s=>s.name.toLowerCase().includes(q)):undefined;
  if(exact&&!foundPlace){lat=exact.lat;lon=exact.lon;}
  if(mode==="live"&&!params.agency)discoverRegion(lat,lon);
  const london=mode==="live"&&!onlyParis?await tfl.discover({...params,...(q&&!foundPlace&&!exact?{q}:{q:undefined,lat,lon})}):undefined;
  if(london?.stops.length&&q&&!foundPlace&&!exact){lat=london.stops[0].lat;lon=london.stops[0].lon;}
  const foreign=mode==="live"&&!onlyParis?await discover({
    ...params,...(q&&!foundPlace&&!exact?{q}:{q:undefined,lat,lon}),
  },unique([...all.flatMap(s=>s.routes),...(london?.routes||[])]),undefined,all):undefined;
  if(foreign?.stops.length&&!london?.stops.length&&q&&!foundPlace&&!exact){lat=foreign.stops[0].lat;lon=foreign.stops[0].lon;}
  if(q&&!foundPlace)rows=rows.filter(s=>`${s.name} ${s.searchNames?.join(" ")||""}`.toLowerCase().includes(q)||s.neighborhood?.toLowerCase().includes(q)||s.routes.some(r=>r.name.toLowerCase()===q||r.id.toLowerCase()===q));
  rows=preferDirect(unique([...rows,...(foreign?.stops||[]),...(london?.stops||[])])).map(s=>{const d=distance(lat,lon,s.lat,s.lon);return {...s,distance:Math.round(d),walkingMinutes:Math.max(1,Math.round(d/75))};})
    .filter(s=>s.distance<=(s.type==="intercity"||s.id.startsWith("nj-transit:")?3000:10000))
    .sort((a,b)=>a.distance-b.distance).slice(0,16);
  if(mode==="live")await wmata.refresh(rows.filter(s=>isWmata(s.id)).flatMap(s=>s.routes.map(r=>r.type)).filter((t):t is "bus"|"subway"=>t==="bus"||t==="subway"));
  const enriched=await Promise.all(rows.map((s,i)=>isTransitland(s.id)&&i<4?globalEnrich(s):enrich(s,mode)));
  const londonNotices=mode==="live"?await tfl.withLineNotices(enriched.filter(s=>isTfl(s.id))):[];
  const londonById=new Map(londonNotices.map(s=>[s.id,s]));
  return {stops:enriched.map(s=>londonById.get(s.id)||s),mode,updatedAt:new Date().toISOString(),centerLat:lat,centerLon:lon,globalCoverage:foreign?.globalCoverage,tfl:london?.tfl,
    message:mode==="demo"?"Demo data · illustrative arrivals, not for travel planning":rows.length?
      `Official feeds redistributed by Transtop. Predictions may be unavailable or stale.${paris.stops.length?" IDFM published schedules only; 80 geographic candidates, nearest 16 cards. Narrow the location or use paginated IDFM Search for more.":""}`:
      "No matching imported stops. Integration not configured for this location or search. Try a station name or supported neighborhood."};
}
export async function stopDetail(id:string,mode:Mode) {
  if(isRetiredResearchId(id))return;
  if(mode==="live"&&isTfl(id)){const s=await tfl.stop(id);return s?tfl.enrich(s):undefined;}
  if(mode==="live"&&isTransitland(id)){
    const s=await globalStop(id);if(!s)return;
    if(s.rawId&&/^(490|910|940)[A-Za-z0-9]{4,37}$/.test(s.rawId)){
      try{const direct=await tfl.stop(`tfl:stop:${s.rawId}`);
        if(direct){
          const matched=matchedRoutes(s,direct);
          if(matched.length===s.routes.length)return tfl.enrich(direct);
          // Keep uncovered services under their saved global identity. Do not
          // repeat matched direct predictions beside the separate official stop.
          if(matched.length){
            const ids=new Set(matched);
            return globalEnrich({...s,routes:s.routes.filter(r=>!ids.has(r.id)),transitland:{...s.transitland!,
              notes:[...(s.transitland?.notes||[]),`Exactly matched official TfL lines are shown at ${direct.name} (${direct.id}); this saved worldwide link retains the remaining services.`]}});
          }
        }
      }catch{/* Saved worldwide links keep their licensed original source when direct lookup fails. */}
    }
    return globalEnrich(s);
  }
  const s=mode==="live"&&isIdfm(id)?await directStop(id):(await allStops(mode)).find(s=>s.id===id);
  return s?enrich(s,mode,true):undefined;
}
export async function routeDetail(id:string,mode:Mode,direction?:string,lookupGlobal:typeof globalRoute=globalRoute):Promise<RouteDetail|undefined> {
  if(isRetiredResearchId(id))return;
  if(mode==="live"&&isIdfm(id))return parisRoute(id,direction);
  if(odptSource(id.split(":")[0])&&!odptEnabled())return;
  if(id.startsWith("mobility-")&&!mobilityEnabled())return;
  if(mode==="live"&&isTfl(id))return tfl.route(id,direction);
  // Saved worldwide route links always keep their source, even after exact
  // stop matches elsewhere or when TfL is disabled/unavailable.
  if(mode==="live"&&isTransitland(id))return lookupGlobal(id,direction);
  if(mode==="live"&&isDocumentId(id))return documentRoute(id,direction);
  if(mode==="live"&&id.startsWith("martz:"))return intercityRoute(id);
  const [r]=await db.select().from(routes).where(and(eq(routes.id,id),eq(routes.mode,mode)));
  if(!r)return;
  const route=r.data as TransitRoute, agency=id.split(":")[0], raw=id.slice(agency.length+1);
  if(agency==="wmata"&&(route.type==="bus"||route.type==="subway"))await wmata.refresh([route.type]);
  if(agency==="wmata")route.scheduleNotes=[...(route.scheduleNotes||[]),
    `Predictions: ${wmata.state(route.type==="bus"?"bus-predictions":"rail-predictions")}. Alerts: ${wmata.state(route.type==="bus"?"bus-alerts":"rail-alerts")}. Missing or expired predictions are withheld; predictions never generate vehicle GPS.`];
  let ss=(await allStops(mode)).filter(s=>(!s.parent||s.mobility)&&s.routes.some(r=>r.id===id)),shape:number[][]=[];
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
  const vehicles=(await trackedVehicles(mode,undefined,id)).filter(v=>v.routeId===id);
  if(agency==="wmata"&&route.type==="bus")route.scheduleNotes=[...(route.scheduleNotes||[]),
    `Metrobus GPS: ${wmata.state("bus-vehicles")}. Only fresh official coordinates with exact published route identities appear; missing or expired GPS removes the marker.`];
  return {route,stops:await Promise.all(ss.map(s=>enrich(s,mode))),shape,vehicles,
    alerts:(mode==="demo"?demoAlerts:liveAlerts()).filter(a=>a.agencyId==="wmata"?
      agency==="wmata"&&a.type===route.type&&(a.systemwide||a.scopes?.some(s=>s.routeId===id&&!s.stopId)):
      a.routeIds.includes(id)),
    directions};
}
export async function sources() {
  const wmataHealth=await wmata.sourceHealth();
  const imports=await db.select().from(feedSnapshots).where(eq(feedSnapshots.mode,"live"));
  const today=DateTime.now().setZone(ZONE).toFormat("yyyyMMdd");
  const {rows:counts}=await pool.query(`SELECT agency,'routes' AS kind,count(*)::int AS count FROM transit_routes WHERE mode='live' GROUP BY agency
    UNION ALL SELECT agency,'stops',count(*)::int FROM transit_stops WHERE mode='live' GROUP BY agency
    UNION ALL SELECT agency,'native:'||(data->>'route_type'),count(*)::int FROM transit_routes
      WHERE mode='live' AND agency='idfm' GROUP BY agency,data->>'route_type'`);
  const result=adapters.map(a=>{
    if(a.id==="idfm"&&!idfmEnabled())return {
      id:a.id,agency:a.name,type:a.type,status:"disabled / public compliance pending",
      description:a.setup+" Imported IDFM records and inventory are withheld until owner public-use confirmation.",
      routeCount:0,stopCount:0,url:a.documentation,updatedAt:null,
    };
    const sourceToday=a.mobility?DateTime.now().setZone(a.mobility.timezone).toFormat("yyyyMMdd"):odptSource(a.id)?DateTime.now().setZone("Asia/Tokyo").toFormat("yyyyMMdd"):a.id==="idfm"?DateTime.now().setZone(IDFM_ZONE).toFormat("yyyyMMdd"):today;
    const imp=imports.find(i=>i.id===`${a.id}:static`),health=feedStatus(a.id),data=imp?.data;
    const lastError=imports.find(i=>i.id===`${a.id}:import-error`);
     const amtrak=a.id==="amtrak"?amtrakHealth():undefined;
    const primState=a.id==="idfm"&&primEnabled()?imports.find(i=>i.id==="idfm:prim-status")?.data:undefined;
    const status=a.id==="wmata"?(imp?`${data?.serviceEnd<today?"expired schedules":data?.serviceStart>today?"future schedules":"schedules available"} · ${wmataSetup()}`:wmataSetup()==="configured"?"not imported":wmataSetup()):
      a.id==="idfm"&&!idfmEnabled()?"disabled / public compliance pending":odptSource(a.id)&&!odptEnabled()?"disabled":!imp?(a.staticUrl?"not imported":a.status):(a.id==="idfm"?expiredEdition(data):data?.serviceEnd&&data.serviceEnd<sourceToday)?"expired schedules":
      data?.components?.some((c:any)=>c.serviceEnd<today)?"partial schedules":
       data?.serviceStart&&data.serviceStart>today?"future schedules":amtrak?.fresh?"schedules + live train reports":
        health.fresh?(a.mobility||odptSource(a.id)?"schedules + fresh realtime feed":"schedules + live predictions"):
        a.id==="idfm"&&primEnabled()?"schedules + PRIM on demand":"scheduled only";
    const failed=lastError&&(!data||lastError.data.at>data.importedAt)?lastError.data.message:undefined;
    return {id:a.id,agency:a.name,type:a.mobility?(data?.routeTypes?.[0]||a.type):a.type,modes:data?.routeTypes,status:a.mobility&&!mobilityEnabled()?"disabled":status,description:a.setup+
      (a.id==="wmata"?` Per-capability status: ${wmataHealth}. Local allowance ${wmataLimit()} requests/day in this environment; total capped at 5,000 with 10% development / 90% production reservation. Empty means a valid empty source response, not an outage or no scheduled service. See stop details for source freshness.`:"")+
      (a.id==="idfm"&&data?` Source publication ${data.lastModified}; last checked ${data.checkedAt}. Imported native route types/counts: ${JSON.stringify(Object.fromEntries(counts.filter(c=>c.agency==="idfm"&&c.kind.startsWith("native:")).map(c=>[c.kind.slice(7),c.count])))}. Supplied commercial agency networks (not a carrier-completeness guarantee): ${JSON.stringify(data.operators)}. Route details identify supplied operators from source attributions. Native legend: 0 tramway, 1 Métro, 2 RER/Transilien/TER train, 3 bus; type 3 does not reliably distinguish coaches. Exclusions by native type or demand-response: ${JSON.stringify(data.exclusions)}. Regional pages and shapes are capped; narrow the viewport or choose IDFM in Search. Published timetables remain scheduled; PRIM stop predictions are checked separately. No vehicle GPS. Rail accessibility can require assistance/reservation; unknown platform/accessibility remains unknown.`:"")+
      (data?.odpt?` Published ${data.odpt.publishedAt}; edition ${data.odpt.version}; resource valid ${data.odpt.validFrom}–${data.odpt.validThrough}. ${data.odpt.realtime}`:"")+
      (a.id==="idfm"?` PRIM: ${primEnabled()?"enabled; stop details check predictions on demand":"disabled, missing key or public license confirmation pending"}. Last check: ${primState?.checkedAt||"not checked"}. ${primState?.message||""} Partial live coverage; no vehicle GPS, no bulk polling. Local cap 180 requests/day per environment, 60-second stop cache, 2-minute production-age limit. PRIM source/terms: https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/idfm-ivtr-requete_unitaire . Publisher page lists Licence Mobilité and an ODbL footer; public use remains separately gated pending owner resolution.`:"")+
      (a.id==="mta-bus"&&!process.env.MTA_BUS_TIME_API_KEY?" Live Bus Time credentials are not configured.":"")+
       (amtrak?` ${amtrak.fresh} fresh train reports; ${amtrak.unresolved} unresolved identities. Tracking checked ${amtrak.checkedAt||"not yet"}. Unresolved trains never replace schedules.`:"")+
      (data&&data.components?.length>1?` Packages: ${data.components.map((c:any)=>`${c.id} (${c.serviceStart}–${c.serviceEnd})`).join(", ")}.`:"")+
        (imp&&!amtrak&&a.id!=="wmata"?` ${health.fresh}/${health.total} fresh live feeds.`:""),
      routeCount:counts.find(c=>c.agency===a.id&&c.kind==="routes")?.count||0,stopCount:counts.find(c=>c.agency===a.id&&c.kind==="stops")?.count||0,
       importedAt:data?.importedAt,serviceStart:data?.serviceStart,serviceEnd:data?.serviceEnd,sourceUrl:data?.sourceUrl,lastError:failed||amtrak?.error,
       url:a.documentation,updatedAt:amtrak?.updatedAt||health.updatedAt||data?.importedAt||null};
  });
  const google=journeyHealth();
  const intercity=(await intercityProviders()).map(p=>({id:p.id,agency:p.name,type:p.id==="nj-transit"?"bus":"intercity",status:p.status,
    description:p.description,url:p.url,updatedAt:p.updatedAt||p.checkedAt,lastError:p.lastError}));
  const budget=await usage(),world=globalCoverage();
  const globalFeeds=[...globalFeedStates.entries()].map(([id,v])=>({id:`tl-feed:${id}`,agency:v.name,type:"global feed",status:v.status,
    description:"Discovered on demand this server session. License checks and realtime feed permissions are separate from schedule availability; no feed is imported wholesale.",
    url:`https://www.transit.land/data/feeds/${encodeURIComponent(id)}`,updatedAt:v.updatedAt}));
  return [...result,...intercity,...tfl.sourceRows(),...globalFeeds,
    {id:"odpt-restricted",agency:"Other ODPT datasets",type:"Japan coverage",status:"disabled / unsupported",
      description:"Kyoto City Bus and Yokohama municipal candidates require separate agreements and a server-only consumer key; not enabled. Challenge Limited sources are excluded, including challenge-limited Kyoto subway descriptions. ODPT Basic is not a redistribution license. JSON-LD-only railway/timetable data is unsupported in this integration. No Tokyo Metro/JR or nationwide coverage is claimed.",
      url:"https://ckan.odpt.org/dataset",updatedAt:null},
    {id:"transitland",agency:"Transitland worldwide",type:"global coverage",status:world.status,
    description:`${world.message} ${budget.used} of ${budget.limit} app requests reserved this UTC month. Bounded on-demand coverage, not every carrier. Feed licenses are checked; unknown rights and old schedules are withheld. Credits and source dates appear with results.`,
    url:"https://www.transit.land/terms",updatedAt:null},
    {id:"google-routes",agency:"Google journey planning",type:"journey planner",
    status:google.status,lastError:"message" in google?google.message:undefined,
    description:"On-demand Google transit itineraries, not a complete agency catalog or official live arrival feed. Requires Routes API, Google Cloud billing and a separate server key. Provider access is checked when a journey is requested.",
    url:"https://developers.google.com/maps/documentation/routes/transit-route",updatedAt:google.updatedAt}];
}
