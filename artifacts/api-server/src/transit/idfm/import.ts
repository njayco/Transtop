import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { IMPORT_LOCK, cleanupGenerations } from "../generations";
import { copyCalls } from "./copy";
import { createEdition, editionTable, sealEdition } from "./storage";
import { gtfsSeconds } from "../time";
import { openArchive } from "./archive";
import { IDFM_CREDIT, IDFM_LICENSE, IDFM_SOURCE, IDFM_ZONE, parisMode } from "./model";
import { DateTime } from "luxon";
import { logger } from "../../lib/logger";
import { invalidateNetwork } from "../network";

const catalogTables=["agencies","routes","trips","calendars","calendar_exceptions","shapes","stops"];
const id=(raw:string)=>{if(!raw||raw.length>512||/[\u0000-\u001f]/.test(raw))throw new Error("IDFM invalid identity");return `idfm:${raw}`;};
/** One owner, bounded batches, disk ZIP, no regional trip/stop-time/shape maps. */
export async function importIdfm(signal=AbortSignal.timeout(30*60_000)){
  const client=await pool.connect(),stage=`import-${randomUUID()}`;
  let locked=false,archive:Awaited<ReturnType<typeof openArchive>>|undefined;
  const started=Date.now();
  try{
    locked=(await client.query("SELECT pg_try_advisory_lock($1) AS locked",[IMPORT_LOCK])).rows[0].locked;
    if(!locked)throw new Error("Another GTFS import or cleanup is already running");
    await client.query("SET statement_timeout='120s'");
    await client.query("SET work_mem='32MB'");
    const previous=(await client.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='idfm:static'")).rows[0]?.data;
    // An importer-method change requires rebuilding once, even if the ZIP did not change.
    const storage=previous&&(await client.query(`SELECT data->>'storage' AS storage FROM transit_feed_snapshots
      WHERE mode='live' AND id=$1`,[`idfm:generation:${previous.stopTimesMode}`])).rows[0]?.storage;
    archive=await openArchive(previous?.idfmMethodVersion===1&&storage==="idfm-edition"?previous:undefined,signal);
    if(archive.unchanged){
      if(!previous)throw new Error("IDFM 304 without a previous complete generation");
      await client.query(`UPDATE transit_feed_snapshots SET data=data||jsonb_build_object('checkedAt',$1::text),updated_at=now()
        WHERE mode='live' AND id='idfm:static'`,[new Date().toISOString()]);
      await client.query("DELETE FROM transit_feed_snapshots WHERE mode='live' AND id='idfm:import-error'");
      return;
    }
    const dbBytes=Number((await client.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
    if(dbBytes>40*1024**3)throw new Error("IDFM import needs database headroom: current database exceeds the 40 GiB safety threshold; retire old generations first");
    await createEdition(client,stage);
    let count=0,serviceStart="",serviceEnd="",maxDepartureSeconds=0;
    const operatorNames=new Map<string,string>(),routeModes=new Map<string,{type:string;detail:string}>(),sourceRouteIds=new Set<string>();
    // Compact, explicitly bounded reference identities, never timetable rows.
    const tripRoutes=new Map<string,string>(),stopIds=new Set<string>(),memberships=new Set<string>();
    let tripBytes=0,stopBytes=0,membershipBytes=0;
    let membershipBatch:{stop_id:string;route_id:string}[]=[];
    async function flushMemberships(){
      let batch:typeof membershipBatch=[],bytes=0;
      const flush=async()=>{
        if(!batch.length)return;
        await client.query(`INSERT INTO idfm_membership SELECT * FROM jsonb_to_recordset($1::jsonb)
          AS r(stop_id text,route_id text)`,[JSON.stringify(batch)]);
        batch=[];bytes=0;
      };
      for(const pair of membershipBatch){
        const size=Buffer.byteLength(JSON.stringify(pair));
        if(batch.length>=1500||bytes+size>1024*1024)await flush();
        batch.push(pair);bytes+=size;
      }
      await flush();membershipBatch=[];
    }
    const sourceAttributions=new Map<string,Record<string,string>[]>(),tripAttributions=new Map<string,Record<string,string>[]>(),excludedTrips=new Set<string>();
    const suppliedTranslations=new Map<string,Record<string,string>[]>();
    function translationFor(table:string,r:Record<string,string>,recordId:string){
      return [...(suppliedTranslations.get(`${table}:${recordId}`)||[]),
        ...Object.entries(r).flatMap(([field,value])=>(suppliedTranslations.get(`${table}:${value}`)||[])
          .filter(t=>!t.record_id&&t.field_name===field))].filter(t=>!t.record_sub_id||t.record_sub_id===r.stop_sequence);
    }
    const exclusions:Record<string,number>={};
    // Generic bounded JSON recordsets. Duplicate source identities fail, never silently drop rows.
    async function load(table:string,name:string,convert:(r:Record<string,string>)=>Record<string,unknown>|undefined){
      if(!archive||archive.unchanged)throw new Error("Missing IDFM archive");
      let batch:Record<string,unknown>[]=[],bytes=0;
      const flush=async()=>{
        if(!batch.length)return;
        signal.throwIfAborted();
        if(process.memoryUsage().rss>1024**3)throw new Error("IDFM importer exceeds 1 GiB RSS safety bound");
        if(table==="stop_times")await copyCalls(client,batch,signal,stage);
        else await client.query(`INSERT INTO transit_${table}(id,agency,mode,data)
          SELECT id,'idfm',$2,data FROM jsonb_to_recordset($1::jsonb) AS r(id text,data jsonb)`,
          [JSON.stringify(batch),stage]);
        if(table==="stop_times")await flushMemberships();
        const old=count;count+=batch.length;batch=[];bytes=0;
        if(Math.floor(old/250000)!==Math.floor(count/250000))logger.info({file:name,count,elapsedMs:Date.now()-started,rssBytes:process.memoryUsage().rss},"IDFM bounded load checkpoint");
      };
      for await(const r of archive.rows(name)){
        const row=convert(r);if(!row)continue;
        bytes+=Buffer.byteLength(JSON.stringify(row));batch.push(row);
        if(batch.length>=(table==="stop_times"?25000:1500)||bytes>=(table==="stop_times"?8:1)*1024*1024)await flush();
      }
      await flush();logger.info({file:name,count,elapsedMs:Date.now()-started},"IDFM bounded import progress");
    }
    await load("agencies","agency",r=>{
      if(!r.agency_name?.trim())throw new Error("IDFM agency has no supplied name");
      if(!r.agency_id||!r.agency_name||r.agency_timezone!==IDFM_ZONE)throw new Error("Unverified IDFM operator/timezone");
      operatorNames.set(r.agency_id,r.agency_name);
      if(operatorNames.size>200)throw new Error("IDFM operator bound");
      return {id:id(r.agency_id),data:r};
    });
    let attributionRows=0,translationRows=0,metadataBytes=0;
    for await(const r of archive.rows("attributions")){
      metadataBytes+=Buffer.byteLength(JSON.stringify(r));if(metadataBytes>32*1024*1024)throw new Error("IDFM reference metadata memory bound");
      if(++attributionRows>10000)throw new Error("IDFM attribution bound");
      if(r.trip_id){tripAttributions.set(r.trip_id,[...(tripAttributions.get(r.trip_id)||[]),r]);continue;}
      const key=r.route_id||(r.agency_id?`agency:${r.agency_id}`:"");
      sourceAttributions.set(key,[...(sourceAttributions.get(key)||[]),r]);
    }
    for await(const r of archive.rows("translations")){
      metadataBytes+=Buffer.byteLength(JSON.stringify(r));if(metadataBytes>32*1024*1024)throw new Error("IDFM reference metadata memory bound");
      if(++translationRows>50000)throw new Error("IDFM translation bound");
      const key=[r.table_name,r.record_id||r.field_value||""].join(":");
      suppliedTranslations.set(key,[...(suppliedTranslations.get(key)||[]),r]);
    }
    await load("routes","routes",r=>{
      id(r.route_id);sourceRouteIds.add(r.route_id);
      if(sourceRouteIds.size>5000||Buffer.byteLength(JSON.stringify(r))>32768)throw new Error("IDFM source route bound");
      const native=parisMode(r.route_type);
      if(!native||/^(?:TàD|TAD)$/iu.test(r.route_short_name)){const reason=native?"demand-response":r.route_type;exclusions[reason]=(exclusions[reason]||0)+1;return;}
      if(!(r.route_short_name||r.route_long_name)?.trim())throw new Error("IDFM route has no supplied name");
      if(!r.route_id||!operatorNames.has(r.agency_id))throw new Error("Invalid IDFM route operator");
      if(routeModes.size>=5000)throw new Error("IDFM route bound");
      routeModes.set(r.route_id,native);
      const attrs=[...(sourceAttributions.get("")||[]),...(sourceAttributions.get(`agency:${r.agency_id}`)||[]),...(sourceAttributions.get(r.route_id)||[])];
      const operators=attrs.filter(a=>a.is_operator==="1").map(a=>a.organization_name).filter(Boolean);
      const trans=translationFor("routes",r,r.route_id);
      const network=operatorNames.get(r.agency_id)!;
      return {id:id(r.route_id),data:{...r,id:id(r.route_id),name:r.route_short_name||r.route_long_name,
        longName:r.route_long_name||r.route_short_name,color:/^[a-f0-9]{6}$/i.test(r.route_color)?"#"+r.route_color:"#468AC4",
        type:native.type,networkName:network,agency:operators.join(" / ")||network,agencyId:"idfm",sourceUrl:IDFM_SOURCE,
        sourceAttributions:attrs,translations:trans,searchNames:trans.map(t=>t.translation),
        idfm:{url:IDFM_SOURCE,license:IDFM_LICENSE,attribution:IDFM_CREDIT,timezone:IDFM_ZONE,modeDetail:`${native.detail} · ${network}`},
        scheduleNotes:[`${native.detail} · ${network} · GTFS route_type ${r.route_type}`,"Published schedules only, not live predictions.",
          "Local/express and coach subtypes are unknown unless explicitly encoded by the source. Some rail accessibility requires staff assistance or reservation; confirm with the operator."]}};
    });
    await load("trips","trips",r=>{
      id(r.trip_id);
      if(!sourceRouteIds.has(r.route_id))throw new Error("IDFM trip references unknown route");
      if(!routeModes.has(r.route_id)){
        if(excludedTrips.size>=100000)throw new Error("IDFM excluded trip bound");
        excludedTrips.add(r.trip_id);return;
      }
      if(!r.trip_id||!r.service_id)throw new Error("Invalid IDFM trip");
      tripBytes+=Buffer.byteLength(r.trip_id)+Buffer.byteLength(r.route_id);
      tripRoutes.set(r.trip_id,r.route_id);
      if(tripRoutes.size>1_000_000||tripBytes>64*1024*1024)throw new Error("IDFM trip identity memory bound");
      return {id:id(r.trip_id),data:{...r,agency_timezone:IDFM_ZONE,translations:translationFor("trips",r,r.trip_id),sourceAttributions:tripAttributions.get(r.trip_id)||[]}};
    });
    await load("stops","stops",r=>{
      if(!r.stop_name?.trim())throw new Error("IDFM stop has no supplied name");
      const lat=Number(r.stop_lat),lon=Number(r.stop_lon);
      if(!r.stop_id||!r.stop_name||!r.stop_lat||!r.stop_lon||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)
        throw new Error("Invalid IDFM stop coordinates");
      const trans=translationFor("stops",r,r.stop_id);
      stopBytes+=Buffer.byteLength(r.stop_id);stopIds.add(r.stop_id);
      if(stopIds.size>100000||stopBytes>32*1024*1024)throw new Error("IDFM stop identity memory bound");
      return {id:id(r.stop_id),data:{...r,translations:trans,searchNames:trans.map(t=>t.translation),
        id:id(r.stop_id),rawId:r.stop_id,name:r.stop_name,lat,lon,
        parent:r.parent_station||"",stop_timezone:IDFM_ZONE,agency:"Île-de-France Mobilités",type:"bus",
        accessible:r.wheelchair_boarding==="1",distance:0,walkingMinutes:0,routes:[],arrivals:[],alerts:[],
        updatedAt:new Date().toISOString(),idfm:{url:IDFM_SOURCE,license:IDFM_LICENSE,attribution:IDFM_CREDIT,timezone:IDFM_ZONE,
          platform:r.platform_code||undefined,accessibility:r.wheelchair_boarding==="1"?"Supplied as accessible; rail access may require staff assistance or advance reservation":r.wheelchair_boarding==="2"?"Supplied as not accessible":"Unknown"}}};
    });
    function dates(r:Record<string,string>){
      for(const value of [r.date,r.start_date,r.end_date].filter(Boolean))
        if(!/^\d{8}$/.test(value)||!DateTime.fromFormat(value,"yyyyMMdd",{zone:IDFM_ZONE}).isValid)throw new Error("Invalid IDFM calendar date");
      if(r.start_date||r.exception_type==="1"){
        const start=r.start_date||r.date,end=r.end_date||r.date;
        if(!serviceStart||start<serviceStart)serviceStart=start;
        if(end>serviceEnd)serviceEnd=end;
      }
    }
    await load("calendars","calendar",r=>{dates(r);return {id:id(r.service_id),data:r};});
    await load("calendar_exceptions","calendar_dates",r=>{
      dates(r);if(!["1","2"].includes(r.exception_type))throw new Error("Invalid IDFM exception");
      return {id:id(`${r.service_id}:${r.date}`),data:r};
    });
    // Temporary on-disk tables stay connection-local and disappear after rollback/disconnect.
    await client.query("CREATE TEMP TABLE idfm_frequency(trip_id text,data jsonb)");
    await client.query("CREATE TEMP TABLE idfm_membership(stop_id text,route_id text)");
    let freqCount=0;
    for await(const r of archive.rows("frequencies")){
      if(excludedTrips.has(r.trip_id))continue;
      if(!tripRoutes.has(r.trip_id))throw new Error("IDFM frequency references unknown trip");
      if(++freqCount>100000||!["","0","1"].includes(r.exact_times||"")||Number(r.headway_secs)<=0||!Number.isInteger(Number(r.headway_secs))||
        gtfsSeconds(r.start_time)>=gtfsSeconds(r.end_time)||gtfsSeconds(r.end_time)>72*3600)throw new Error("Invalid IDFM frequency");
      maxDepartureSeconds=Math.max(maxDepartureSeconds,gtfsSeconds(r.end_time));
      await client.query("INSERT INTO idfm_frequency VALUES($1,$2)",[id(r.trip_id),r]);
    }
    await client.query(`UPDATE transit_trips t SET data=t.data||jsonb_build_object('frequencies',f.items)
      FROM (SELECT trip_id,jsonb_agg(data) AS items FROM idfm_frequency GROUP BY trip_id) f
      WHERE t.mode=$1 AND t.id=f.trip_id`,[stage]);
    await load("stop_times","stop_times",r=>{
      if(excludedTrips.has(r.trip_id))return;
      if(!r.trip_id||!r.stop_id||!/^\d+$/.test(r.stop_sequence))throw new Error("Invalid IDFM call");
      const route=tripRoutes.get(r.trip_id);
      if(!route||!stopIds.has(r.stop_id))throw new Error("IDFM call references unknown trip or stop");
      const pairKey=r.stop_id+"\0"+route;
      if(!memberships.has(pairKey)){
        memberships.add(pairKey);membershipBytes+=Buffer.byteLength(pairKey);
        if(memberships.size>500000||membershipBytes>32*1024*1024)throw new Error("IDFM stop/route membership memory bound");
        membershipBatch.push({stop_id:id(r.stop_id),route_id:route});
      }
      const arrival=r.arrival_time?gtfsSeconds(r.arrival_time):-1,departure=r.departure_time?gtfsSeconds(r.departure_time):-1;
      maxDepartureSeconds=Math.max(maxDepartureSeconds,arrival,departure);
      if(maxDepartureSeconds>72*3600)throw new Error("IDFM extended time bound");
      return {id:id(`${r.trip_id}:${r.stop_sequence}`),agency:"idfm",mode:stage,tripId:id(r.trip_id),stopId:id(r.stop_id),
        sequence:Number(r.stop_sequence),arrivalSeconds:arrival,departureSeconds:departure,
        data:translationRows?{...r,translations:translationFor("stop_times",r,r.trip_id)}:r};
    });
    await client.query("CREATE TEMP TABLE idfm_shape(id text,seq integer,lon double precision,lat double precision)");
    let points:{id:string;seq:number;lon:number;lat:number}[]=[],shapeCount=0;
    async function flushPoints(){
      if(!points.length)return;
      await client.query(`INSERT INTO idfm_shape SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS r(id text,seq integer,lon double precision,lat double precision)`,[JSON.stringify(points)]);
      points=[];
    }
    for await(const r of archive.rows("shapes")){
      const lon=Number(r.shape_pt_lon),lat=Number(r.shape_pt_lat),seq=Number(r.shape_pt_sequence);
      if(++shapeCount>5_000_000||!r.shape_id||!r.shape_pt_lat||!r.shape_pt_lon||!Number.isFinite(lat)||!Number.isFinite(lon)||
        Math.abs(lat)>90||Math.abs(lon)>180||!Number.isInteger(seq))throw new Error("IDFM shape bound");
      points.push({id:id(r.shape_id),seq,lon,lat});if(points.length===1500)await flushPoints();
    }
    await flushPoints();
    await client.query(`INSERT INTO transit_shapes(id,agency,mode,data)
      SELECT id,'idfm',$1,jsonb_build_object('coordinates',jsonb_agg(jsonb_build_array(lon,lat) ORDER BY seq))
      FROM idfm_shape GROUP BY id HAVING count(*)<=20000`,[stage]);
    const feedInfo:Record<string,string>[]=[];
    for await(const r of archive.rows("feed_info")){
      if(feedInfo.length>=10)throw new Error("IDFM feed_info limit");
      feedInfo.push(r);
      for(const value of [r.feed_start_date,r.feed_end_date].filter(Boolean))
        if(!/^\d{8}$/.test(value)||!DateTime.fromFormat(value,"yyyyMMdd",{zone:IDFM_ZONE}).isValid)throw new Error("Invalid IDFM feed validity date");
      if(r.feed_start_date)serviceStart=[serviceStart,r.feed_start_date].sort().at(-1)!;
      if(r.feed_end_date)serviceEnd=[serviceEnd,r.feed_end_date].sort()[0];
    }
    const today=DateTime.now().setZone(IDFM_ZONE).toFormat("yyyyMMdd");
    if(!routeModes.size||!serviceStart||today<serviceStart||today>serviceEnd)throw new Error("IDFM has no current service window");
    // Validate every selected trip/call/calendar before publication; no orphan clocks.
    // Fresh staging cardinalities must be known before regional integrity/membership joins.
    await sealEdition(client,stage,signal,started+30*60_000);
    for(const table of ["trips","stops","calendars","calendar_exceptions"])await client.query(`ANALYZE transit_${table}`);
    const bad=await client.query(`SELECT 1 FROM transit_trips t WHERE t.mode=$1 AND (
      NOT EXISTS(SELECT 1 FROM transit_calendars c WHERE c.mode=$1 AND c.id='idfm:'||(t.data->>'service_id')) AND
      NOT EXISTS(SELECT 1 FROM transit_calendar_exceptions c WHERE c.mode=$1 AND c.data->>'service_id'=t.data->>'service_id')) LIMIT 1`,[stage]);
    if(bad.rowCount)throw new Error("IDFM trip references unknown calendar");
    // Every call was checked against the completely inserted trip/stop identity
    // sets before its atomic COPY. Do not rescan millions of stored calls here.
    const badParent=await client.query(`SELECT 1 FROM transit_stops s WHERE s.mode=$1 AND s.data->>'parent'<>''
      AND NOT EXISTS(SELECT 1 FROM transit_stops p WHERE p.mode=$1 AND p.id='idfm:'||(s.data->>'parent')) LIMIT 1`,[stage]);
    if(badParent.rowCount)throw new Error("IDFM stop references unknown parent");
    const badFrequency=await client.query(`SELECT 1 FROM idfm_frequency f WHERE NOT EXISTS(
      SELECT 1 FROM transit_trips t WHERE t.mode=$1 AND t.id=f.trip_id) LIMIT 1`,[stage]);
    if(badFrequency.rowCount)throw new Error("IDFM frequency references unknown trip");
    // Aggregate memberships in SQL, not a JS map of the whole regional timetable.
    await client.query("ANALYZE idfm_membership");
    await client.query(`INSERT INTO idfm_membership SELECT DISTINCT 'idfm:'||(s.data->>'parent'),m.route_id
      FROM idfm_membership m JOIN transit_stops s ON s.mode=$1 AND s.id=m.stop_id WHERE s.data->>'parent'<>''`,[stage]);
    await client.query(`UPDATE transit_stops s SET data=s.data||jsonb_build_object('routes',m.items,'type',m.items->0->>'type')
      FROM (SELECT m.stop_id,jsonb_agg(DISTINCT r.data) AS items FROM idfm_membership m
        JOIN transit_routes r ON r.mode=$1 AND r.id='idfm:'||m.route_id GROUP BY m.stop_id) m
      WHERE s.mode=$1 AND s.id=m.stop_id`,[stage]);
    const stopCount=Number((await client.query("SELECT count(*) FROM transit_stops WHERE mode=$1",[stage])).rows[0].count);
    const info={url:IDFM_SOURCE,license:IDFM_LICENSE,attribution:IDFM_CREDIT,timezone:IDFM_ZONE,
      publishedAt:archive.lastModified,validFrom:serviceStart,validThrough:serviceEnd};
    await client.query(`UPDATE transit_stops SET data=jsonb_set(data,'{idfm}',(data->'idfm')||$2::jsonb) WHERE mode=$1`,[stage,JSON.stringify(info)]);
    await client.query(`UPDATE transit_routes SET data=jsonb_set(data,'{idfm}',(data->'idfm')||$2::jsonb) WHERE mode=$1`,[stage,JSON.stringify(info)]);
    const data={status:"ready",stopTimesMode:stage,importedAt:new Date().toISOString(),checkedAt:new Date().toISOString(),
      sourceUrl:IDFM_SOURCE,etag:archive.etag,lastModified:archive.lastModified,serviceStart,serviceEnd,
      routeCount:routeModes.size,stopCount,records:count,maxDepartureSeconds,exclusions,frequencyRows:freqCount,idfmMethodVersion:1,
      attributionRows,translationRows,feedInfo,sourceAttributions:sourceAttributions.get("")||[],
      operators:Object.fromEntries(operatorNames),compressedBytes:archive.downloaded,shapePoints:shapeCount,
      durationMs:Date.now()-started,idfm:info};
    signal.throwIfAborted();
    for(const table of catalogTables)await client.query(`ANALYZE transit_${table}`);
    await client.query("BEGIN");
    try{
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query(`ALTER TABLE ${editionTable(stage)} INHERIT public.transit_idfm_stop_times`);
      for(const table of catalogTables){
        await client.query(`DELETE FROM transit_${table} WHERE mode='live' AND agency='idfm'`);
        await client.query(`UPDATE transit_${table} SET mode='live' WHERE mode=$1`,[stage]);
      }
      await client.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data) VALUES('idfm:static','live','idfm',$1)
        ON CONFLICT(mode,id) DO UPDATE SET data=$1,updated_at=now()`,[JSON.stringify(data)]);
      await client.query("DELETE FROM transit_feed_snapshots WHERE mode='live' AND id='idfm:import-error'");
      signal.throwIfAborted();
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    invalidateNetwork();logger.info(data,"IDFM generation published");
  }catch(error){
    if(locked)await client.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data)
      VALUES('idfm:import-error','live','idfm',$1) ON CONFLICT(mode,id) DO UPDATE SET data=$1,updated_at=now()`,
      [JSON.stringify({message:error instanceof Error?error.message:"IDFM import failed",at:new Date().toISOString()})]);
    throw error;
  }finally{
    await archive?.dispose();
    for(const name of ["idfm_frequency","idfm_shape","idfm_membership"])await client.query(`DROP TABLE IF EXISTS pg_temp.${name}`).catch(()=>{});
    await client.query("RESET statement_timeout; RESET work_mem").catch(()=>{});
    if(locked){
      try{await cleanupGenerations(100000,"idfm");}catch(error){logger.warn({error},"IDFM generation cleanup deferred");}
      await client.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);
    }
    client.release();
  }
}
