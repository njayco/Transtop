import { Open } from "unzipper";
import { parse } from "csv-parse";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, agencies, stops, routes, trips, stopTimes, calendars, calendarExceptions, shapes, feedSnapshots } from "@workspace/db";
import { adapter } from "./adapters";
import { gtfsSeconds } from "./time";
import { logger } from "../lib/logger";
import type { TransitRoute } from "./types";
const tables=[agencies,routes,trips,stopTimes,calendars,calendarExceptions,shapes,stops];

export async function importGtfs(agency:string) {
  const a=adapter(agency);
  if(!a.staticUrl)throw new Error("No approved static feed configured");
  const stage=`import-${randomUUID()}`;
  const allStops=new Map<string,Record<string,string>>(), allRoutes=new Map<string,TransitRoute>();
  const routeStops=new Map<string,Set<string>>();
  const components:{id:string;url:string;serviceStart:string;serviceEnd:string}[]=[];
  let count=0;
  try {
  for(const feed of a.staticFeeds||[{id:agency,url:a.staticUrl}]){
  const scope=(id:string)=>a.staticFeeds?`${feed.id}~${id}`:id;
  const response=await fetch(feed.url,{signal:AbortSignal.timeout(120000),redirect:"error"});
  if(!response.ok)throw new Error(`GTFS download returned ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>100*1024*1024)throw new Error("GTFS archive exceeds configured size limit");
  const zip=await Open.buffer(bytes);
  const file=(n:string)=>zip.files.find(f=>f.path===`${n}.txt`);
  if(!file("stops")||!file("routes")||!file("trips")||!file("stop_times"))throw new Error("Required GTFS files missing");
  const tripRoute=new Map<string,string>(), shapeMap=new Map<string,number[][]>(),agencyNames=new Map<string,string>();
  let serviceStart="",serviceEnd="";
  const agencyEntry=file("agency");
  if(agencyEntry)for await(const row of agencyEntry.stream().pipe(parse({columns:true,bom:true,skip_empty_lines:true}))){
    agencyNames.set(row.agency_id||"",row.agency_name||a.name);
  }
    const specs:[string,any,(r:Record<string,string>)=>string][]=[
      ["agency",agencies,r=>r.agency_id||agency],["routes",routes,r=>r.route_id],["trips",trips,r=>r.trip_id],
      ["calendar",calendars,r=>r.service_id],["calendar_dates",calendarExceptions,r=>r.service_id+":"+r.date],
      ["stop_times",stopTimes,r=>r.trip_id+":"+r.stop_sequence],
    ];
    for(const [name,table,idOf] of specs) {
      const entry=file(name); if(!entry)continue;
      const parser=entry.stream().pipe(parse({columns:true,bom:true,skip_empty_lines:true,relax_column_count:true}));
      let batch:any[]=[];
      const flush=async()=>{if(batch.length){await db.insert(table).values(batch).onConflictDoNothing();count+=batch.length;batch=[];}};
      for await(const row of parser) {
         const r={...row} as Record<string,string>;
         // Keep route/stop IDs stable across boroughs; scope trip, service and
         // shape IDs, which can collide between independently published feeds.
         for(const key of ["trip_id","service_id","shape_id"])if(r[key])r[key]=scope(r[key]);
         if(name==="agency"&&a.staticFeeds)r.agency_id=scope(r.agency_id||agency);
         if(name==="calendar"||name==="calendar_dates"){
           const start=r.start_date||r.date,end=r.end_date||r.date;
           if(name==="calendar"||r.exception_type==="1"){
             if(start&&(!serviceStart||start<serviceStart))serviceStart=start;
             if(end&&end>serviceEnd)serviceEnd=end;
           }
         }
        if(name==="routes") {
           const name=r.route_short_name||r.route_long_name;
           const express=a.type==="bus"&&(/^(?:BM|BXM|QM|SIM|X)\d/i.test(name)||/\dX$/i.test(name)||/\bexpress\b/i.test(`${r.route_long_name} ${r.route_desc}`));
           const rr:TransitRoute={id:`${agency}:${r.route_id}`,name,longName:r.route_long_name||name,color:"#"+(r.route_color||"468AC4"),type:a.type,agency:agencyNames.get(r.agency_id||"")||a.name,agencyId:agency,serviceClass:express?"express":"local"};
          allRoutes.set(r.route_id,rr);
        }
        if(name==="trips")tripRoute.set(r.trip_id,r.route_id);
        if(name==="stop_times"){
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
        if(batch.length>=1500)await flush();
      }
      await flush();
      logger.info({agency,file:name,records:count},"GTFS import progress");
    }
    const stopsParser=file("stops")!.stream().pipe(parse({columns:true,bom:true,skip_empty_lines:true}));
    for await(const r of stopsParser){
      if(!Number.isFinite(Number(r.stop_lat))||!Number.isFinite(Number(r.stop_lon)))throw new Error("Invalid stop coordinates");
      allStops.set(r.stop_id,r);
    }
    components.push({id:feed.id,url:feed.url,serviceStart,serviceEnd});
    const shapeEntry=file("shapes");
    if(shapeEntry) {
      const shapeParser=shapeEntry.stream().pipe(parse({columns:true,bom:true,skip_empty_lines:true}));
      for await(const r of shapeParser) {
        const id=scope(r.shape_id);
        if(!shapeMap.has(id))shapeMap.set(id,[]);
        shapeMap.get(id)!.push([Number(r.shape_pt_lon),Number(r.shape_pt_lat),Number(r.shape_pt_sequence)]);
      }
      const rows=[...shapeMap].map(([id,points])=>({id:`${agency}:${id}`,mode:stage,agency,data:{coordinates:points.sort((a,b)=>a[2]-b[2]).map(p=>p.slice(0,2))}}));
      for(let i=0;i<rows.length;i+=100)await db.insert(shapes).values(rows.slice(i,i+100));
    }
  }
    if(!allStops.size||!allRoutes.size||components.some(c=>!c.serviceEnd))throw new Error("GTFS feed is empty or lacks service dates");
    // Aggregate child-platform route membership to parent stations.
    for(const [id,r] of allStops) {
      if(r.parent_station){
        if(!routeStops.has(r.parent_station))routeStops.set(r.parent_station,new Set());
        for(const rid of routeStops.get(id)||[])routeStops.get(r.parent_station)!.add(rid);
      }
    }
    const stopRows=[...allStops].map(([id,r])=>({
      id:`${agency}:${id}`,agency,mode:stage,data:{...r,id:`${agency}:${id}`,rawId:id,name:r.stop_name,lat:Number(r.stop_lat),lon:Number(r.stop_lon),
        agency:a.name,type:a.type,parent:r.parent_station||"",accessible:r.wheelchair_boarding==="1",
        routes:[...(routeStops.get(id)||[])].map(r=>allRoutes.get(r)).filter(Boolean),
        arrivals:[],alerts:[],distance:0,walkingMinutes:0,updatedAt:new Date().toISOString()},
    }));
    for(let i=0;i<stopRows.length;i+=1000)await db.insert(stops).values(stopRows.slice(i,i+1000));
    // A complete generation is swapped atomically; failed downloads/imports leave
    // the previous published dataset intact.
    await db.transaction(async tx=>{
      for(const table of tables) {
        await tx.delete(table).where(and(eq(table.agency,agency),eq(table.mode,"live")));
        await tx.update(table).set({mode:"live"}).where(eq(table.mode,stage));
      }
      const data={status:"ready",importedAt:new Date().toISOString(),sourceUrl:a.staticUrl,records:count,stopCount:stopRows.length,routeCount:allRoutes.size,components,
        serviceStart:components.map(c=>c.serviceStart).sort()[0],serviceEnd:components.map(c=>c.serviceEnd).sort().at(-1)};
      await tx.insert(feedSnapshots).values({id:`${agency}:static`,mode:"live",agency,data}).onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data,updatedAt:new Date()}});
      await tx.delete(feedSnapshots).where(and(eq(feedSnapshots.mode,"live"),eq(feedSnapshots.id,`${agency}:import-error`)));
    });
    await pool.query("ANALYZE transit_stop_times");
    await pool.query("ANALYZE transit_trips");
    logger.info({agency,records:count,stops:stopRows.length},"GTFS import complete");
  } catch(error) {
    const data={message:error instanceof Error?error.message:"GTFS import failed",at:new Date().toISOString()};
    await db.insert(feedSnapshots).values({id:`${agency}:import-error`,mode:"live",agency,data})
      .onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data,updatedAt:new Date()}});
    throw error;
  } finally {
    for(const table of tables)await db.delete(table).where(eq(table.mode,stage));
  }
}
