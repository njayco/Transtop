import { Open } from "unzipper";
import { parse } from "csv-parse";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, agencies, stops, routes, trips, stopTimes, calendars, calendarExceptions, shapes, feedSnapshots,type PoolClient } from "@workspace/db";
import { adapter } from "./adapters";
import { gtfsSeconds } from "./time";
import { logger } from "../lib/logger";
import { invalidateNetwork } from "./network";
import type { TransitRoute } from "./types";
import { IMPORT_LOCK, cleanupGenerations, insertStopTimes } from "./generations";
import { GtfsSelection,isExpressRoute } from "./gtfs-selection";
import { DateTime } from "luxon";
import { odptSource, catalogUrl, attribution, odptLicense, odptTerms } from "./odpt/registry";
import { resolveEdition, odptFetch, type Edition } from "./odpt/client";
import { validateArchive, translations } from "./odpt/gtfs";
import type { OdptInfo } from "./types";
import { importIdfm } from "./idfm/import";
import { download as wmataDownload, WMATA_CREDIT, WMATA_DOCS } from "./wmata/client";
import { routeType as wmataType,locationInfo } from "./wmata/model";
import { validateArchive as validateWmataArchive } from "./wmata/archive";
import { routeMode } from "./mobility/model";
import { openArchive as mobilityArchive } from "./mobility/archive";
import { recordFor } from "./mobility/registry";
import { smallCapacity,regionalCapacity,referenceCapacity } from "./mobility/capacity";
import { createEdition as createMobilityEdition,copyCalls as copyMobilityCalls,sealEdition as sealMobilityEdition,
  editionTable as mobilityEditionTable,createShapeStage,copyShapePoints,publishShapes } from "./mobility/storage";
const tables=[agencies,routes,trips,stopTimes,calendars,calendarExceptions,shapes,stops];

export async function importGtfs(agency:string) {
  if(agency==="idfm")return importIdfm();
  const lock=await pool.connect();
  let locked=false;
  try {
    const {rows}=await lock.query("SELECT pg_try_advisory_lock($1) AS locked",[IMPORT_LOCK]);
    locked=rows[0].locked;
    if(!locked)throw new Error("Another GTFS import or cleanup is already running");
    await importLocked(agency,lock);
  } finally {
    if(locked)await lock.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);
    lock.release();
  }
}

async function importLocked(agency:string,storage:PoolClient) {
  const a={...adapter(agency)},odpt=odptSource(agency);
  if(!a.staticUrl)throw new Error("No approved static feed configured");
  const stage=`import-${randomUUID()}`;
  const allStops=new Map<string,Record<string,string>>(), allRoutes=new Map<string,TransitRoute>();
  const stopNames=new Map<string,string[]>();
  const routeStops=new Map<string,Set<string>>();
  const components:{id:string;url:string;serviceStart:string;serviceEnd:string}[]=[];
  let count=0;
  let published=false;
  const started=Date.now();
  const limits=a.mobilityRegional?regionalCapacity:smallCapacity,deadline=started+20*60_000;
  const signal=AbortSignal.timeout(20*60_000);
  let referenceBytes=0,memberships=0,peakRss=process.memoryUsage().rss;
  const budget=()=>{
    if(!a.mobility)return;
    signal.throwIfAborted();
    peakRss=Math.max(peakRss,process.memoryUsage().rss);
    if(peakRss>1024**3)throw new Error("Mobility importer exceeds 1 GiB RSS capacity");
    if(referenceBytes>referenceCapacity.bytes)throw new Error("Mobility reference identity memory capacity exceeded");
  };
  const identity=(value:string)=>{
    if(!value||value.length>512||/[\u0000-\u001f]/.test(value))throw new Error("Mobility identity is missing or invalid");
    return value;
  };
  let edition:Edition|undefined,odptInfo:OdptInfo|undefined;
  if(a.mobility){
    const current=(await storage.query(`SELECT s.data,g.data->>'storage' AS storage FROM transit_feed_snapshots s
      LEFT JOIN transit_feed_snapshots g ON g.mode='live' AND g.id=s.agency||':generation:'||(s.data->>'stopTimesMode')
      WHERE s.mode='live' AND s.id=$1`,[`${agency}:static`])).rows[0];
    // The earliest isolated editions used this same method before a method
    // stamp existed. Never apply this shortcut to legacy shared-table imports.
    if(current?.storage==="mobility-edition"&&(current.data.mobilityMethodVersion??1)===1&&current.data.mobility?.datasetId===a.mobility.datasetId){
      await storage.query(`UPDATE transit_feed_snapshots SET data=data||jsonb_build_object('checkedAt',$2::text),updated_at=now()
        WHERE mode='live' AND id=$1`,[`${agency}:static`,new Date().toISOString()]);
      logger.info({agency},"Mobility immutable dataset unchanged; existing complete edition retained");
      return;
    }
    // Retire an earlier failed edition before allocating another one. Shared
    // metadata drains in bounded slices; no chain of abandoned regional copies.
    await cleanupGenerations(20000,agency);
    const abandoned=await storage.query(`SELECT 1 FROM transit_feed_snapshots g
      WHERE mode='live' AND agency=$1 AND data->>'storage'='mobility-edition'
      AND data->>'stage' IS DISTINCT FROM
        (SELECT data->>'stopTimesMode' FROM transit_feed_snapshots WHERE mode='live' AND id=$1||':static') LIMIT 1`,[agency]);
    if(abandoned.rowCount)throw new Error("Mobility previous staging metadata is still retiring; retry after bounded maintenance");
    const bytes=Number((await storage.query("SELECT pg_database_size(current_database()) bytes")).rows[0].bytes);
    if(bytes>24*1024**3)throw new Error("Mobility import requires database headroom below 24 GiB; existing schedules retained");
    await storage.query("SET statement_timeout='120s'; SET work_mem='32MB'");
    await createMobilityEdition(storage,stage,agency);
  }else await db.insert(feedSnapshots).values({id:`${agency}:generation:${stage}`,mode:"live",agency,data:{kind:"gtfs-generation",stage}});
  try {
  if(odpt){
    edition=await resolveEdition(odpt);a.staticUrl=edition.url;
    odptInfo={attribution:attribution(odpt),url:catalogUrl(odpt),license:odptLicense,terms:odptTerms,timezone:"Asia/Tokyo",
      version:edition.feed_version,publishedAt:edition.uploaded_at,
      validFrom:[edition.start_at,edition.feed_start_date].sort().at(-1)!,
      validThrough:[edition.end_at,edition.feed_end_date].filter((v):v is string=>!!v).sort()[0],
      modeDetail:odpt.type==="rail"?"Tram / streetcar · GTFS route_type 0":"Bus · GTFS route_type 3",
      realtime:odpt.realtime.length?"Sendai GTFS-Realtime: only fresh exact trip/route/stop matches; empty alerts are not service notices.":"Published schedules only; no verified realtime companion"};
  }
  for(const feed of a.staticFeeds||[{id:agency,url:a.staticUrl}]){
  let selection=new GtfsSelection(a.staticAgencyIds,a.staticRouteTypes);
  const scope=(id:string)=>a.staticFeeds?`${feed.id}~${id}`:id;
   const mobility=a.mobility?await mobilityArchive(recordFor(agency)!,a.mobilityRegional):undefined;
   const response=mobility?undefined:agency==="wmata"?new Response(new Uint8Array(await wmataDownload("static"))):
     odpt?new Response(new Uint8Array(await odptFetch(feed.url,odpt,"static"))):await fetch(feed.url,{signal:AbortSignal.timeout(120000),redirect:"error"});
  let zip:Awaited<ReturnType<typeof Open.buffer>>;
  if(mobility)zip=mobility.zip;
  else{
  if(!response)throw new Error("GTFS response missing");
  if(!response.ok)throw new Error(`GTFS download returned ${response.status}`);
  const chunks:Uint8Array[]=[]; let size=0;
  if(!response.body)throw new Error("GTFS download has no body");
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>100*1024*1024)throw new Error("GTFS archive exceeds configured size limit");
    chunks.push(chunk);
  }
  const bytes=Buffer.concat(chunks);
  zip=await Open.buffer(bytes);
  }
   if(agency==="wmata")validateWmataArchive(zip);
  if(odpt)validateArchive(zip);
  const translated=odpt?await translations(zip):()=>[] as string[];
  const file=(n:string)=>zip.files.find(f=>f.path===`${n}.txt`);
  if(a.mobility&&file("frequencies")){
    for await(const _row of file("frequencies")!.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true})))throw new Error("Mobility frequency-based feeds require a dedicated timetable review");
  }
  if(!file("stops")||!file("routes")||!file("trips")||!file("stop_times"))throw new Error("Required GTFS files missing");
   const tripRoute=new Map<string,string>(), shapeMap=new Map<string,number[][]>(),agencyNames=new Map<string,string>(),agencyZones=new Map<string,string>(),routeZones=new Map<string,string>();
   let maxDepartureSeconds=0;
   const referencedServices=new Set<string>(),suppliedServices=new Set<string>();
  let serviceStart="",serviceEnd="";
  const feedInfo:Record<string,string>[]=[];
  const infoEntry=file("feed_info");
   if(infoEntry)for await(const row of infoEntry.stream().compose(parse({columns:true,bom:true,trim:!!a.mobility,skip_empty_lines:true,max_record_size:256*1024}))){
     if((odpt||a.mobility)&&feedInfo.length>=1000)throw new Error("GTFS feed metadata limit");
     feedInfo.push(row);
   }
   if(odpt&&edition&&feedInfo.length){
     if(feedInfo.length!==1||feedInfo[0].feed_version!==edition.feed_version||
       feedInfo[0].feed_start_date!==edition.feed_start_date.replaceAll("-","")||
       feedInfo[0].feed_end_date!==edition.feed_end_date.replaceAll("-",""))
       throw new Error("ODPT archive and catalog edition mismatch");
   }
  const agencyEntry=file("agency");
  if(a.mobility&&!agencyEntry)throw new Error("Mobility GTFS agency metadata missing");
   if(agencyEntry)for await(const row of agencyEntry.stream().compose(parse({columns:true,bom:true,trim:!!a.mobility,skip_empty_lines:true,max_record_size:256*1024}))){
    agencyNames.set(row.agency_id||"",row.agency_name||a.name);
     if(a.mobility&&agencyNames.size>200)throw new Error("Mobility agency capacity exceeded");
     agencyZones.set(row.agency_id||"",row.agency_timezone);
     if(a.mobility&&(!DateTime.now().setZone(row.agency_timezone).isValid||row.agency_timezone!==a.mobility.timezone))throw new Error("Mobility GTFS timezone must match the verified catalog; mixed-zone feeds require separate review");
     if(odpt&&row.agency_timezone!=="Asia/Tokyo")throw new Error("ODPT agency timezone missing or changed");
      if(agency==="wmata"&&row.agency_timezone!=="America/New_York")throw new Error("WMATA timezone missing or changed");
     if(odpt&&agencyZones.size>100)throw new Error("ODPT agency limit");
  }
   if(a.mobility){
     if(!agencyNames.size)throw new Error("Mobility GTFS agency metadata is empty");
     selection=new GtfsSelection([...agencyNames.keys()],a.staticRouteTypes);
   }
    const specs:[string,any,(r:Record<string,string>)=>string][]=[
      ["agency",agencies,r=>r.agency_id||agency],["routes",routes,r=>r.route_id],["trips",trips,r=>r.trip_id],
      ["calendar",calendars,r=>r.service_id],["calendar_dates",calendarExceptions,r=>r.service_id+":"+r.date],
      ["stop_times",stopTimes,r=>r.trip_id+":"+r.stop_sequence],
    ];
    for(const [name,table,idOf] of specs) {
      const entry=file(name); if(!entry)continue;
       const parser=entry.stream().compose(parse({columns:true,bom:true,trim:!!a.mobility,skip_empty_lines:true,relax_column_count:true,max_record_size:256*1024}));
      let batch:any[]=[];
      let batchBytes=0;
      const flush=async()=>{if(batch.length){
        const before=count;
        budget();
        if(a.mobility&&name==="stop_times")await copyMobilityCalls(storage,stage,batch,signal);
        else if(name==="stop_times")await insertStopTimes(batch);
        else if(a.mobility)await db.insert(table).values(batch);
        else await db.insert(table).values(batch).onConflictDoNothing();
        count+=batch.length;batch=[];batchBytes=0;
        if(a.mobility&&Math.floor(before/250000)!==Math.floor(count/250000)){
          const size=Number((await storage.query("SELECT pg_database_size(current_database()) bytes")).rows[0].bytes);
          if(size>30*1024**3)throw new Error("Mobility import exceeded database storage safety capacity");
          logger.info({agency,records:count,rssBytes:peakRss,elapsedMs:Date.now()-started},"Mobility bounded staging checkpoint");
        }
      }};
      for await(const row of parser) {
         if(a.mobility&&count+batch.length>=limits.rows)throw new Error("Mobility GTFS row capacity exceeded");
         if(odpt&&count+batch.length>1500000)throw new Error("ODPT record limit");
          if(agency==="wmata"&&count+batch.length>6000000)throw new Error("WMATA record limit");
         const r={...row} as Record<string,string>;
         if(a.mobility&&(name==="agency"||name==="routes")){
           if(name==="routes"&&(!r.agency_id&&agencyNames.size!==1||r.agency_id&&!agencyNames.has(r.agency_id)))
             throw new Error("Mobility route agency is ambiguous or unknown");
           r.agency_id=r.agency_id||[...agencyNames.keys()][0]||"";
         }
         // Keep route/stop IDs stable across boroughs; scope trip, service and
         // shape IDs, which can collide between independently published feeds.
         for(const key of ["trip_id","service_id","shape_id"])if(r[key])r[key]=scope(r[key]);
         if(name==="agency"&&a.staticFeeds)r.agency_id=scope(r.agency_id||agency);
         if(!selection.accept(name,r))continue;
         if(a.mobility){
           identity(idOf(r));
           if(name==="trips"){
             identity(r.service_id);referencedServices.add(r.service_id);
             referenceBytes+=Buffer.byteLength(r.trip_id)+Buffer.byteLength(r.route_id)+Buffer.byteLength(r.service_id)+64;
             if(tripRoute.size>=referenceCapacity.trips)throw new Error("Mobility trip capacity exceeded");
           }
           if(name==="routes"&&allRoutes.size>=referenceCapacity.routes)throw new Error("Mobility route capacity exceeded");
           if(name==="stop_times"&&(!Number.isSafeInteger(Number(r.stop_sequence))||Number(r.stop_sequence)<0||!r.stop_id))
             throw new Error("Mobility call identity or sequence invalid");
         }
         if(name==="calendar"||name==="calendar_dates"){
           if(a.mobility){
             if(!/^\d{8}$/.test(r.start_date||r.date)||!/^\d{8}$/.test(r.end_date||r.date))throw new Error("Mobility service date invalid");
             suppliedServices.add(r.service_id);
           }
           const start=r.start_date||r.date,end=r.end_date||r.date;
            if(agency==="wmata"&&(!/^\d{8}$/.test(start)||!/^\d{8}$/.test(end)))throw new Error("WMATA calendar date invalid");
           if(name==="calendar"||r.exception_type==="1"){
             if(start&&(!serviceStart||start<serviceStart))serviceStart=start;
             if(end&&end>serviceEnd)serviceEnd=end;
           }
         }
        if(name==="routes") {
             if(agency==="wmata"&&(!r.route_id||r.route_color&&!/^[0-9a-f]{6}$/i.test(r.route_color)))throw new Error("WMATA route identity or color invalid");
            if(odpt&&!odpt.routeTypes.includes(r.route_type))throw new Error("Unapproved ODPT route type");
            if(odpt&&!agencyZones.has(r.agency_id||"")){
              if(agencyZones.size!==1)throw new Error("ODPT route agency timezone unverified");
              r.agency_id=agencyZones.keys().next().value!;
            }
            if(a.mobility&&!agencyZones.has(r.agency_id||"")&&agencyZones.size!==1)throw new Error("Mobility route agency timezone is unverified");
            routeZones.set(r.route_id,agencyZones.get(r.agency_id||"")||(a.mobility?agencyZones.values().next().value!:"America/New_York"));
           if(a.mobility&&r.route_color&&!/^[a-f0-9]{6}$/i.test(r.route_color))r.route_color="468AC4";
           const name=a.routeName||r.route_short_name||r.route_long_name;
            const type=a.mobility?routeMode(r.route_type)!:agency==="wmata"?wmataType(r.route_type)!:a.type;
            const express=type==="bus"&&isExpressRoute(agency,name,`${r.route_long_name} ${r.route_desc}`);
            const rr:TransitRoute={id:`${agency}:${r.route_id}`,name:agency==="wmata"&&type==="subway"?`${r.route_long_name} Line`:name,longName:a.routeName||r.route_long_name||name,color:"#"+(r.route_color||"468AC4"),type,agency:agencyNames.get(r.agency_id||"")||a.name,agencyId:agency,serviceClass:express?"express":"local"};
            if(a.mobility){rr.mobility=a.mobility;rr.sourceUrl=a.mobility.url;rr.scheduleNotes=[a.mobility.attribution,`${a.mobility.license} · source downloaded ${a.mobility.downloadedAt}. Published schedules, not live predictions.`];}
            if(agency==="wmata"){rr.sourceUrl=WMATA_DOCS;rr.scheduleNotes=[WMATA_CREDIT,"Official WMATA combined GTFS · America/New_York. Published schedules, not live predictions."]; }
          allRoutes.set(r.route_id,rr);
           if(odptInfo){
             rr.odpt=odptInfo;rr.sourceUrl=odptInfo.url;
             rr.agency=a.name;
             rr.searchNames=translated("routes",r.route_short_name?"route_short_name":"route_long_name",r.route_id,name);
             rr.scheduleNotes=[odptInfo.modeDetail,odptInfo.attribution,"Published GTFS/GTFS-JP schedules, not a live prediction. Missing shapes are not reconstructed."];
           }
        }
         if(name==="trips"){
            if(agency==="wmata"&&(!r.trip_id||!allRoutes.has(r.route_id)))throw new Error("WMATA trip references unknown route");
           if(odpt&&(!allRoutes.has(r.route_id)||routeZones.get(r.route_id)!=="Asia/Tokyo"))throw new Error("ODPT trip references unverified route");
           tripRoute.set(r.trip_id,r.route_id);r.agency_timezone=routeZones.get(r.route_id)||"America/New_York";
           if(odpt)r.transtop_headsign_translations=translated("trips","trip_headsign",r.trip_id,r.trip_headsign).join(" / ");}
        if(name==="stop_times"){
            if(agency==="wmata"&&(!tripRoute.has(r.trip_id)||!r.stop_id))throw new Error("WMATA timing references unknown trip or stop");
           if(odpt&&!tripRoute.has(r.trip_id))throw new Error("ODPT timing references unknown trip");
           if(odpt&&r.stop_headsign)r.transtop_headsign_translations=translated("stop_times","stop_headsign",r.trip_id,r.stop_headsign,r.stop_sequence).join(" / ");
           if(r.departure_time)maxDepartureSeconds=Math.max(maxDepartureSeconds,gtfsSeconds(r.departure_time));
          const rid=tripRoute.get(r.trip_id);
          if(rid){
            if(!routeStops.has(r.stop_id))routeStops.set(r.stop_id,new Set());
            if(a.mobility&&!routeStops.get(r.stop_id)!.has(rid)){
              referenceBytes+=Buffer.byteLength(r.stop_id)+Buffer.byteLength(rid)+64;
              if(++memberships>referenceCapacity.memberships)throw new Error("Mobility route membership capacity exceeded");
            }
            routeStops.get(r.stop_id)!.add(rid);
          }
           // Retain untimed intermediate stops for complete route ordering,
           // but never generate exact departure estimates for them.
          batch.push({id:`${agency}:${idOf(r)}`,agency,mode:stage,data:r,tripId:`${agency}:${r.trip_id}`,stopId:`${agency}:${r.stop_id}`,
             sequence:Number(r.stop_sequence),arrivalSeconds:r.arrival_time||r.departure_time?gtfsSeconds(r.arrival_time||r.departure_time):-1,
             departureSeconds:r.departure_time||r.arrival_time?gtfsSeconds(r.departure_time||r.arrival_time):-1});
        } else {
          batch.push({id:`${agency}:${idOf(r)}`,agency,mode:stage,data:name==="routes"?{...r,...allRoutes.get(r.route_id)}:r});
        }
        batchBytes+=Buffer.byteLength(JSON.stringify(batch[batch.length-1]));
        if(batch.length>=(a.mobility&&name==="stop_times"?10000:1500)||batchBytes>=(a.mobility&&name==="stop_times"?4:1)*1024*1024)await flush();
      }
      await flush();
      logger.info({agency,file:name,records:count},"GTFS import progress");
    }
    if(a.mobility&&[...referencedServices].some(id=>!suppliedServices.has(id)))throw new Error("Mobility trip references unknown service");
    const stopsParser=file("stops")!.stream().compose(parse({columns:true,bom:true,trim:!!a.mobility,skip_empty_lines:true,max_record_size:256*1024}));
    for await(const r of stopsParser){
      if(a.mobility){
        identity(r.stop_id);budget();
        if(allStops.has(r.stop_id)||allStops.size>=referenceCapacity.stops)throw new Error("Mobility stop identity duplicated or capacity exceeded");
        referenceBytes+=Buffer.byteLength(r.stop_id)+64;
      }
      if(odpt&&allStops.size>=100000)throw new Error("ODPT stop limit");
       if(agency==="wmata"&&(!r.stop_id||allStops.has(r.stop_id)))throw new Error("WMATA stop identity missing or duplicated");
       if(agency==="wmata"&&(allStops.size>=30000||!r.stop_lat||!r.stop_lon||Math.abs(Number(r.stop_lat))>90||Math.abs(Number(r.stop_lon))>180))throw new Error("WMATA stop bounds");
      if(!Number.isFinite(Number(r.stop_lat))||!Number.isFinite(Number(r.stop_lon)))throw new Error("Invalid stop coordinates");
      if(odpt&&(!r.stop_lat||!r.stop_lon||Math.abs(Number(r.stop_lat))>90||Math.abs(Number(r.stop_lon))>180))throw new Error("Invalid ODPT coordinates");
      allStops.set(r.stop_id,r);
      if(odpt)stopNames.set(r.stop_id,translated("stops","stop_name",r.stop_id,r.stop_name));
    }
    if(a.mobility&&([...routeStops.keys()].some(id=>!allStops.has(id))||
      [...allStops.values()].some(s=>s.parent_station&&(!allStops.has(s.parent_station)||s.parent_station===s.stop_id))))
      throw new Error("Mobility call or parent references unknown stop");
    if(agency!=="wmata")selection.retainStops(allStops);
    if(agency==="wmata"){
      const info=feedInfo[0];
      if(!info?.feed_start_date||!info.feed_end_date)throw new Error("WMATA publication window missing");
      serviceStart=[serviceStart,info.feed_start_date].sort().at(-1)!;
      serviceEnd=[serviceEnd,info.feed_end_date].sort()[0];
      if(serviceStart>serviceEnd)throw new Error("WMATA calendar outside publication window");
    }
  components.push({id:feed.id,url:feed.url,serviceStart,serviceEnd,...{maxDepartureSeconds,feedInfo}});
    const shapeEntry=file("shapes");
    if(shapeEntry) {
      if(a.mobility)await createShapeStage(storage);
      let shapeBatch:Record<string,string>[]=[],shapeBatchBytes=0;
      const shapeParser=shapeEntry.stream().compose(parse({columns:true,bom:true,trim:!!a.mobility,skip_empty_lines:true,max_record_size:256*1024}));
      let shapeRows=0;
      for await(const r of shapeParser) {
        if(a.mobility){
          if(++shapeRows>limits.shapePoints||!r.shape_pt_lat||!r.shape_pt_lon||
            !Number.isSafeInteger(Number(r.shape_pt_sequence))||Number(r.shape_pt_sequence)<0||
            !Number.isFinite(Number(r.shape_pt_lat))||!Number.isFinite(Number(r.shape_pt_lon))||
            Math.abs(Number(r.shape_pt_lat))>90||Math.abs(Number(r.shape_pt_lon))>180)throw new Error("Mobility shape bounds violation");
          identity(r.shape_id);
        }
         if(agency==="wmata"&&(++shapeRows>1000000||!r.shape_pt_lat||!r.shape_pt_lon||
           !Number.isFinite(Number(r.shape_pt_sequence))||!Number.isFinite(Number(r.shape_pt_lat))||
           !Number.isFinite(Number(r.shape_pt_lon))||Math.abs(Number(r.shape_pt_lat))>90||Math.abs(Number(r.shape_pt_lon))>180))
           throw new Error("WMATA shape bounds violation");
        if(odpt&&(++shapeRows>1000000||!r.shape_pt_lat||!r.shape_pt_lon||
          !Number.isFinite(Number(r.shape_pt_sequence))||!Number.isFinite(Number(r.shape_pt_lat))||!Number.isFinite(Number(r.shape_pt_lon))||
          Math.abs(Number(r.shape_pt_lat))>90||Math.abs(Number(r.shape_pt_lon))>180))throw new Error("ODPT shape bounds violation");
        const id=scope(r.shape_id);
        if(!selection.accept("shapes",{...r,shape_id:id}))continue;
        if(a.mobility){
          shapeBatch.push(r);shapeBatchBytes+=Buffer.byteLength(JSON.stringify(r));
          if(shapeBatch.length>=10000||shapeBatchBytes>=2*1024*1024){
            budget();await copyShapePoints(storage,shapeBatch,signal);shapeBatch=[];shapeBatchBytes=0;
          }
          continue;
        }
        if(!shapeMap.has(id))shapeMap.set(id,[]);
        shapeMap.get(id)!.push([Number(r.shape_pt_lon),Number(r.shape_pt_lat),Number(r.shape_pt_sequence)]);
      }
      if(a.mobility){
        if(shapeBatch.length)await copyShapePoints(storage,shapeBatch,signal);
        await publishShapes(storage,agency,stage);
      }
      const rows=[...shapeMap].map(([id,points])=>({id:`${agency}:${id}`,mode:stage,agency,data:{coordinates:points.sort((a,b)=>a[2]-b[2]).map(p=>p.slice(0,2))}}));
      for(let i=0;i<rows.length;i+=100)await db.insert(shapes).values(rows.slice(i,i+100));
    }
  }
    if(!allStops.size||!allRoutes.size||components.some(c=>!c.serviceEnd))throw new Error("GTFS feed is empty or lacks service dates");
     if(agency==="wmata"&&([...routeStops.keys()].some(id=>!allStops.has(id))||
       [...allStops.values()].some(s=>s.parent_station&&!allStops.has(s.parent_station))||
       ![...allRoutes.values()].some(r=>r.type==="bus")||![...allRoutes.values()].some(r=>r.type==="subway")))
       throw new Error("WMATA combined feed lacks verified bus/rail boarding data");
    // Aggregate child-platform route membership to parent stations.
    for(const [id,r] of allStops) {
      if(r.parent_station){
        if(!routeStops.has(r.parent_station))routeStops.set(r.parent_station,new Set());
        for(const rid of routeStops.get(id)||[])routeStops.get(r.parent_station)!.add(rid);
      }
    }
    if(odptInfo){
      if([...routeStops.keys()].some(id=>!allStops.has(id)))throw new Error("ODPT timing references unknown stop");
      for(const c of components){
        c.serviceStart=[c.serviceStart,odptInfo.validFrom.replaceAll("-","")].sort().at(-1)!;
        c.serviceEnd=[c.serviceEnd,odptInfo.validThrough.replaceAll("-","")].sort()[0];
        if(c.serviceStart>c.serviceEnd)throw new Error("ODPT calendar outside resource window");
      }
      const today=DateTime.now().setZone("Asia/Tokyo").toFormat("yyyyMMdd");
      if(components.some(c=>today<c.serviceStart||today>c.serviceEnd))throw new Error("ODPT archive has no current service window");
    }
    if(a.mobility){
      if(!allRoutes.size||!allStops.size)throw new Error("Mobility GTFS has no supported fixed-route service");
      const today=DateTime.now().setZone(a.mobility.timezone).toFormat("yyyyMMdd");
      if(components.some(c=>!c.serviceStart||!c.serviceEnd||c.serviceStart>today||c.serviceEnd<today))throw new Error("Mobility GTFS calendar does not cover the current service day");
      for(const r of allStops.values())if(!r.stop_name||!r.stop_lat||!r.stop_lon||!Number.isFinite(Number(r.stop_lat))||!Number.isFinite(Number(r.stop_lon))||Math.abs(Number(r.stop_lat))>90||Math.abs(Number(r.stop_lon))>180)throw new Error("Mobility GTFS stop coordinates invalid");
    }
    const stopRows=[...allStops].map(([id,r])=>({
      id:`${agency}:${id}`,agency,mode:stage,data:{...r,id:`${agency}:${id}`,rawId:id,name:r.stop_name,lat:Number(r.stop_lat),lon:Number(r.stop_lon),
         agency:a.name,type:a.mobility?allRoutes.get([...(routeStops.get(id)||[])][0])?.type||a.type:agency==="wmata"?allRoutes.get([...(routeStops.get(id)||[])][0])?.type||(r.location_type||r.parent_station?"subway":"bus"):a.type,parent:r.parent_station||"",accessible:r.wheelchair_boarding==="1",
         ...(a.mobility?{mobility:a.mobility,stop_timezone:a.mobility.timezone}:{}),
         ...(agency==="wmata"?{wmata:locationInfo(r),stop_timezone:"America/New_York"}:{}),
         ...(odptInfo?{odpt:odptInfo,stop_timezone:"Asia/Tokyo",searchNames:stopNames.get(id)||[],
           name:[r.stop_name,...(stopNames.get(id)||[]).filter(n=>/^[\x20-\x7e]+$/.test(n)&&n!==r.stop_name)].join(" / ")}:{}),
        routes:[...(routeStops.get(id)||[])].map(r=>allRoutes.get(r)).filter(Boolean),
        arrivals:[],alerts:[],distance:0,walkingMinutes:0,updatedAt:new Date().toISOString()},
    }));
    for(let i=0;i<stopRows.length;i+=1000)await db.insert(stops).values(stopRows.slice(i,i+1000));
    if(a.mobility){
      budget();
      await sealMobilityEdition(storage,stage,signal,deadline);
      logger.info({agency,elapsedMs:Date.now()-started,rssBytes:peakRss,
        editionBytes:Number((await storage.query("SELECT pg_total_relation_size($1) bytes",[mobilityEditionTable(stage)])).rows[0].bytes)},
      "Mobility edition validated and indexed before publication");
    }
    // Statistics must be ready before readers can see the new generation.
    for(const name of [...(a.mobility?[]:["transit_stop_times"]),"transit_trips","transit_stops","transit_routes",
      "transit_calendars","transit_calendar_exceptions","transit_shapes"])await pool.query(`ANALYZE ${name}`);
    // A complete generation is swapped atomically; failed downloads/imports leave
    // the previous published dataset intact.
    await db.transaction(async tx=>{
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      if(a.mobility){
        signal.throwIfAborted();
        await tx.execute(sql.raw(`ALTER TABLE ${mobilityEditionTable(stage)} INHERIT public.transit_stop_times`));
      }
      const previous=await tx.select().from(feedSnapshots).where(and(eq(feedSnapshots.mode,"live"),eq(feedSnapshots.id,`${agency}:static`)));
      if(!previous[0]?.data.stopTimesMode){
        await tx.insert(feedSnapshots).values({id:`${agency}:generation:live`,mode:"live",agency,
          data:{kind:"gtfs-generation",stage:"live"}}).onConflictDoNothing();
      }
      for(const table of tables) {
        if(table===stopTimes)continue;
        await tx.delete(table).where(and(eq(table.agency,agency),eq(table.mode,"live")));
        await tx.update(table).set({mode:"live"}).where(eq(table.mode,stage));
      }
      // The smaller tables changed mode during publication. Refresh their
      // statistics too, so live route/shape joins do not use staging estimates.
      for(const name of ["transit_trips","transit_stops","transit_routes","transit_calendars",
        "transit_calendar_exceptions","transit_shapes"])await tx.execute(sql.raw(`ANALYZE ${name}`));
      const data={status:"ready",stopTimesMode:stage,importedAt:new Date().toISOString(),sourceUrl:a.staticUrl,records:count,stopCount:stopRows.length,routeCount:allRoutes.size,components,
        ...(odptInfo?{odpt:odptInfo,edition}:{}),...(a.mobility?{mobility:a.mobility,mobilityMethodVersion:1,regional:a.mobilityRegional===true,
          peakRssBytes:peakRss,importDurationMs:Date.now()-started,routeTypes:[...new Set([...allRoutes.values()].map(r=>r.type))]}:{}),
        serviceStart:components.map(c=>c.serviceStart).sort()[0],serviceEnd:components.map(c=>c.serviceEnd).sort().at(-1)};
      await tx.insert(feedSnapshots).values({id:`${agency}:static`,mode:"live",agency,data}).onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data,updatedAt:new Date()}});
      await tx.delete(feedSnapshots).where(and(eq(feedSnapshots.mode,"live"),eq(feedSnapshots.id,`${agency}:import-error`)));
    });
    published=true;
    invalidateNetwork();
    logger.info({agency,records:count,stops:stopRows.length,durationMs:Date.now()-started},"GTFS import complete");
  } catch(error) {
    const safeError=agency==="wmata"?new Error("WMATA import failed: verify server credential, quota, product access and valid source; previous complete generation retained"):
      odpt?new Error("ODPT import failed: source unavailable, invalid, expired or changed; previous complete generation retained"):error;
    const data={message:safeError instanceof Error?safeError.message:"GTFS import failed",at:new Date().toISOString()};
    await db.insert(feedSnapshots).values({id:`${agency}:import-error`,mode:"live",agency,data})
      .onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data,updatedAt:new Date()}});
    throw safeError;
  } finally {
    // Cleanup failure must not turn a committed publication into an import error.
    if(a.mobility)try{await storage.query("DROP TABLE IF EXISTS pg_temp.mobility_shape_points; RESET statement_timeout; RESET work_mem");}
    catch(err){logger.warn({err,agency,published},"Mobility staging session cleanup deferred");}
    try { await cleanupGenerations(20000,a.mobility?agency:undefined); }
    catch(err){logger.warn({err,agency,published},"GTFS cleanup deferred; generation registry retained");}
  }
}
