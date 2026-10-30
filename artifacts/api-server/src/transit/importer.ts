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
  const response=await fetch(a.staticUrl,{signal:AbortSignal.timeout(120000),redirect:"error"});
  if(!response.ok)throw new Error(`GTFS download returned ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>100*1024*1024)throw new Error("GTFS archive exceeds configured size limit");
  const zip=await Open.buffer(bytes);
  const file=(n:string)=>zip.files.find(f=>f.path===`${n}.txt`);
  if(!file("stops")||!file("routes")||!file("trips")||!file("stop_times"))throw new Error("Required GTFS files missing");
  const allStops=new Map<string,Record<string,string>>(), allRoutes=new Map<string,TransitRoute>();
  const tripRoute=new Map<string,string>(), routeStops=new Map<string,Set<string>>(), shapeMap=new Map<string,number[][]>();
  let count=0;
  try {
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
        const r=row as Record<string,string>;
        if(name==="routes") {
          const rr:TransitRoute={id:`${agency}:${r.route_id}`,name:r.route_short_name||r.route_long_name,color:"#"+(r.route_color||"468AC4"),type:a.type,agency:a.name};
          allRoutes.set(r.route_id,rr);
        }
        if(name==="trips")tripRoute.set(r.trip_id,r.route_id);
        if(name==="stop_times"){
          const rid=tripRoute.get(r.trip_id);
          if(rid){if(!routeStops.has(r.stop_id))routeStops.set(r.stop_id,new Set());routeStops.get(r.stop_id)!.add(rid);}
          if(!r.arrival_time||!r.departure_time)continue; // Untimed stops cannot support schedule estimates.
          batch.push({id:`${agency}:${idOf(r)}`,agency,mode:stage,data:r,tripId:`${agency}:${r.trip_id}`,stopId:`${agency}:${r.stop_id}`,
            sequence:Number(r.stop_sequence),arrivalSeconds:gtfsSeconds(r.arrival_time),departureSeconds:gtfsSeconds(r.departure_time)});
        } else {
          batch.push({id:`${agency}:${idOf(r)}`,agency,mode:stage,data:name==="routes"?{...r,...allRoutes.get(r.route_id)}:r});
        }
        if(batch.length>=1500)await flush();
      }
      await flush();
      logger.info({agency,file:name,records:count},"GTFS import progress");
    }
    const stopsParser=file("stops")!.stream().pipe(parse({columns:true,bom:true,skip_empty_lines:true}));
    for await(const r of stopsParser)allStops.set(r.stop_id,r);
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
    const shapeEntry=file("shapes");
    if(shapeEntry) {
      const shapeParser=shapeEntry.stream().pipe(parse({columns:true,bom:true,skip_empty_lines:true}));
      for await(const r of shapeParser) {
        if(!shapeMap.has(r.shape_id))shapeMap.set(r.shape_id,[]);
        shapeMap.get(r.shape_id)!.push([Number(r.shape_pt_lon),Number(r.shape_pt_lat),Number(r.shape_pt_sequence)]);
      }
      const rows=[...shapeMap].map(([id,points])=>({id:`${agency}:${id}`,mode:stage,agency,data:{coordinates:points.sort((a,b)=>a[2]-b[2]).map(p=>p.slice(0,2))}}));
      for(let i=0;i<rows.length;i+=100)await db.insert(shapes).values(rows.slice(i,i+100));
    }
    // A complete generation is swapped atomically; failed downloads/imports leave
    // the previous published dataset intact.
    await db.transaction(async tx=>{
      for(const table of tables) {
        await tx.delete(table).where(and(eq(table.agency,agency),eq(table.mode,"live")));
        await tx.update(table).set({mode:"live"}).where(eq(table.mode,stage));
      }
      const data={status:"ready",importedAt:new Date().toISOString(),sourceUrl:a.staticUrl,records:count,stopCount:stopRows.length};
      await tx.insert(feedSnapshots).values({id:`${agency}:static`,mode:"live",agency,data}).onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data,updatedAt:new Date()}});
    });
    await pool.query("ANALYZE transit_stop_times");
    logger.info({agency,records:count,stops:stopRows.length},"GTFS import complete");
  } finally {
    for(const table of tables)await db.delete(table).where(eq(table.mode,stage));
  }
}
