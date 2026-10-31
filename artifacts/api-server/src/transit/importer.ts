import { Open } from "unzipper";
import { parse } from "csv-parse";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, agencies, stops, routes, trips, stopTimes, calendars, calendarExceptions, shapes, feedSnapshots } from "@workspace/db";
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
const tables=[agencies,routes,trips,stopTimes,calendars,calendarExceptions,shapes,stops];

export async function importGtfs(agency:string) {
  if(agency==="idfm")return importIdfm();
  const lock=await pool.connect();
  let locked=false;
  try {
    const {rows}=await lock.query("SELECT pg_try_advisory_lock($1) AS locked",[IMPORT_LOCK]);
    locked=rows[0].locked;
    if(!locked)throw new Error("Another GTFS import or cleanup is already running");
    await importLocked(agency);
  } finally {
    if(locked)await lock.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);
    lock.release();
  }
}

async function importLocked(agency:string) {
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
  let edition:Edition|undefined,odptInfo:OdptInfo|undefined;
  await db.insert(feedSnapshots).values({id:`${agency}:generation:${stage}`,mode:"live",agency,
    data:{kind:"gtfs-generation",stage}});
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
  const selection=new GtfsSelection(a.staticAgencyIds,a.staticRouteTypes);
  const scope=(id:string)=>a.staticFeeds?`${feed.id}~${id}`:id;
   const response=agency==="wmata"?new Response(new Uint8Array(await wmataDownload("static"))):
     odpt?new Response(new Uint8Array(await odptFetch(feed.url,odpt,"static"))):await fetch(feed.url,{signal:AbortSignal.timeout(120000),redirect:"error"});
  if(!response.ok)throw new Error(`GTFS download returned ${response.status}`);
  const chunks:Uint8Array[]=[]; let size=0;
  if(!response.body)throw new Error("GTFS download has no body");
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>100*1024*1024)throw new Error("GTFS archive exceeds configured size limit");
    chunks.push(chunk);
  }
  const bytes=Buffer.concat(chunks);
  const zip=await Open.buffer(bytes);
   if(agency==="wmata")validateWmataArchive(zip);
  if(odpt)validateArchive(zip);
  const translated=odpt?await translations(zip):()=>[] as string[];
  const file=(n:string)=>zip.files.find(f=>f.path===`${n}.txt`);
  if(!file("stops")||!file("routes")||!file("trips")||!file("stop_times"))throw new Error("Required GTFS files missing");
   const tripRoute=new Map<string,string>(), shapeMap=new Map<string,number[][]>(),agencyNames=new Map<string,string>(),agencyZones=new Map<string,string>(),routeZones=new Map<string,string>();
   let maxDepartureSeconds=0;
  let serviceStart="",serviceEnd="";
  const feedInfo:Record<string,string>[]=[];
  const infoEntry=file("feed_info");
   if(infoEntry)for await(const row of infoEntry.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:256*1024}))){
     if(odpt&&feedInfo.length>=1000)throw new Error("ODPT feed metadata limit");
     feedInfo.push(row);
   }
   if(odpt&&edition&&feedInfo.length){
     if(feedInfo.length!==1||feedInfo[0].feed_version!==edition.feed_version||
       feedInfo[0].feed_start_date!==edition.feed_start_date.replaceAll("-","")||
       feedInfo[0].feed_end_date!==edition.feed_end_date.replaceAll("-",""))
       throw new Error("ODPT archive and catalog edition mismatch");
   }
  const agencyEntry=file("agency");
   if(agencyEntry)for await(const row of agencyEntry.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:256*1024}))){
    agencyNames.set(row.agency_id||"",row.agency_name||a.name);
     agencyZones.set(row.agency_id||"",row.agency_timezone);
     if(odpt&&row.agency_timezone!=="Asia/Tokyo")throw new Error("ODPT agency timezone missing or changed");
      if(agency==="wmata"&&row.agency_timezone!=="America/New_York")throw new Error("WMATA timezone missing or changed");
     if(odpt&&agencyZones.size>100)throw new Error("ODPT agency limit");
  }
    const specs:[string,any,(r:Record<string,string>)=>string][]=[
      ["agency",agencies,r=>r.agency_id||agency],["routes",routes,r=>r.route_id],["trips",trips,r=>r.trip_id],
      ["calendar",calendars,r=>r.service_id],["calendar_dates",calendarExceptions,r=>r.service_id+":"+r.date],
      ["stop_times",stopTimes,r=>r.trip_id+":"+r.stop_sequence],
    ];
    for(const [name,table,idOf] of specs) {
      const entry=file(name); if(!entry)continue;
       const parser=entry.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true,relax_column_count:true,max_record_size:256*1024}));
      let batch:any[]=[];
      let batchBytes=0;
      const flush=async()=>{if(batch.length){
        if(name==="stop_times")await insertStopTimes(batch);
        else await db.insert(table).values(batch).onConflictDoNothing();
        count+=batch.length;batch=[];batchBytes=0;
      }};
      for await(const row of parser) {
         if(odpt&&count+batch.length>1500000)throw new Error("ODPT record limit");
          if(agency==="wmata"&&count+batch.length>6000000)throw new Error("WMATA record limit");
         const r={...row} as Record<string,string>;
         // Keep route/stop IDs stable across boroughs; scope trip, service and
         // shape IDs, which can collide between independently published feeds.
         for(const key of ["trip_id","service_id","shape_id"])if(r[key])r[key]=scope(r[key]);
         if(name==="agency"&&a.staticFeeds)r.agency_id=scope(r.agency_id||agency);
         if(!selection.accept(name,r))continue;
         if(name==="calendar"||name==="calendar_dates"){
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
            routeZones.set(r.route_id,agencyZones.get(r.agency_id||"")||"America/New_York");
           const name=a.routeName||r.route_short_name||r.route_long_name;
            const type=agency==="wmata"?wmataType(r.route_type)!:a.type;
            const express=type==="bus"&&isExpressRoute(agency,name,`${r.route_long_name} ${r.route_desc}`);
            const rr:TransitRoute={id:`${agency}:${r.route_id}`,name:agency==="wmata"&&type==="subway"?`${r.route_long_name} Line`:name,longName:a.routeName||r.route_long_name||name,color:"#"+(r.route_color||"468AC4"),type,agency:agencyNames.get(r.agency_id||"")||a.name,agencyId:agency,serviceClass:express?"express":"local"};
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
          if(rid){if(!routeStops.has(r.stop_id))routeStops.set(r.stop_id,new Set());routeStops.get(r.stop_id)!.add(rid);}
           // Retain untimed intermediate stops for complete route ordering,
           // but never generate exact departure estimates for them.
          batch.push({id:`${agency}:${idOf(r)}`,agency,mode:stage,data:r,tripId:`${agency}:${r.trip_id}`,stopId:`${agency}:${r.stop_id}`,
             sequence:Number(r.stop_sequence),arrivalSeconds:r.arrival_time||r.departure_time?gtfsSeconds(r.arrival_time||r.departure_time):-1,
             departureSeconds:r.departure_time||r.arrival_time?gtfsSeconds(r.departure_time||r.arrival_time):-1});
        } else {
          batch.push({id:`${agency}:${idOf(r)}`,agency,mode:stage,data:name==="routes"?{...r,...allRoutes.get(r.route_id)}:r});
        }
        batchBytes+=Buffer.byteLength(JSON.stringify(batch[batch.length-1]));
        if(batch.length>=1500||batchBytes>=1024*1024)await flush();
      }
      await flush();
      logger.info({agency,file:name,records:count},"GTFS import progress");
    }
    const stopsParser=file("stops")!.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:256*1024}));
    for await(const r of stopsParser){
      if(odpt&&allStops.size>=100000)throw new Error("ODPT stop limit");
       if(agency==="wmata"&&(!r.stop_id||allStops.has(r.stop_id)))throw new Error("WMATA stop identity missing or duplicated");
       if(agency==="wmata"&&(allStops.size>=30000||!r.stop_lat||!r.stop_lon||Math.abs(Number(r.stop_lat))>90||Math.abs(Number(r.stop_lon))>180))throw new Error("WMATA stop bounds");
      if(!Number.isFinite(Number(r.stop_lat))||!Number.isFinite(Number(r.stop_lon)))throw new Error("Invalid stop coordinates");
      if(odpt&&(!r.stop_lat||!r.stop_lon||Math.abs(Number(r.stop_lat))>90||Math.abs(Number(r.stop_lon))>180))throw new Error("Invalid ODPT coordinates");
      allStops.set(r.stop_id,r);
      if(odpt)stopNames.set(r.stop_id,translated("stops","stop_name",r.stop_id,r.stop_name));
    }
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
      const shapeParser=shapeEntry.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:256*1024}));
      let shapeRows=0;
      for await(const r of shapeParser) {
         if(agency==="wmata"&&(++shapeRows>1000000||!r.shape_pt_lat||!r.shape_pt_lon||
           !Number.isFinite(Number(r.shape_pt_sequence))||!Number.isFinite(Number(r.shape_pt_lat))||
           !Number.isFinite(Number(r.shape_pt_lon))||Math.abs(Number(r.shape_pt_lat))>90||Math.abs(Number(r.shape_pt_lon))>180))
           throw new Error("WMATA shape bounds violation");
        if(odpt&&(++shapeRows>1000000||!r.shape_pt_lat||!r.shape_pt_lon||
          !Number.isFinite(Number(r.shape_pt_sequence))||!Number.isFinite(Number(r.shape_pt_lat))||!Number.isFinite(Number(r.shape_pt_lon))||
          Math.abs(Number(r.shape_pt_lat))>90||Math.abs(Number(r.shape_pt_lon))>180))throw new Error("ODPT shape bounds violation");
        const id=scope(r.shape_id);
        if(!selection.accept("shapes",{...r,shape_id:id}))continue;
        if(!shapeMap.has(id))shapeMap.set(id,[]);
        shapeMap.get(id)!.push([Number(r.shape_pt_lon),Number(r.shape_pt_lat),Number(r.shape_pt_sequence)]);
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
    const stopRows=[...allStops].map(([id,r])=>({
      id:`${agency}:${id}`,agency,mode:stage,data:{...r,id:`${agency}:${id}`,rawId:id,name:r.stop_name,lat:Number(r.stop_lat),lon:Number(r.stop_lon),
         agency:a.name,type:agency==="wmata"?allRoutes.get([...(routeStops.get(id)||[])][0])?.type||(r.location_type||r.parent_station?"subway":"bus"):a.type,parent:r.parent_station||"",accessible:r.wheelchair_boarding==="1",
         ...(agency==="wmata"?{wmata:locationInfo(r),stop_timezone:"America/New_York"}:{}),
         ...(odptInfo?{odpt:odptInfo,stop_timezone:"Asia/Tokyo",searchNames:stopNames.get(id)||[],
           name:[r.stop_name,...(stopNames.get(id)||[]).filter(n=>/^[\x20-\x7e]+$/.test(n)&&n!==r.stop_name)].join(" / ")}:{}),
        routes:[...(routeStops.get(id)||[])].map(r=>allRoutes.get(r)).filter(Boolean),
        arrivals:[],alerts:[],distance:0,walkingMinutes:0,updatedAt:new Date().toISOString()},
    }));
    for(let i=0;i<stopRows.length;i+=1000)await db.insert(stops).values(stopRows.slice(i,i+1000));
    // Statistics must be ready before readers can see the new generation.
    for(const name of ["transit_stop_times","transit_trips","transit_stops","transit_routes",
      "transit_calendars","transit_calendar_exceptions","transit_shapes"])await pool.query(`ANALYZE ${name}`);
    // A complete generation is swapped atomically; failed downloads/imports leave
    // the previous published dataset intact.
    await db.transaction(async tx=>{
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
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
        ...(odptInfo?{odpt:odptInfo,edition}:{}),
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
    try { await cleanupGenerations(); }
    catch(err){logger.warn({err,agency,published},"GTFS cleanup deferred; generation registry retained");}
  }
}
