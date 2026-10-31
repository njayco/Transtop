import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DateTime } from "luxon";
import { preflightZip, validateZip, limits } from "../src/transit/idfm/archive";
import { IDFM_URL, idfmEnabled, parisMode, publicationSlot, refreshDue, expiredEdition } from "../src/transit/idfm/model";
import { verifiedIdfmFeed, boardingDuplicate, routeDuplicate } from "../src/transit/idfm/crosswalk";
import { serviceInstant } from "../src/transit/time";

// Only this disposable database is touched. Never redirect this suite to app data.
process.env.DATABASE_URL="postgresql://benchmark@127.0.0.1:55439/gtfs_import_test";
process.env.TRANSITLAND_ENABLED="false";process.env.TFL_ENABLED="false";process.env.ODPT_ENABLED="false";process.env.PRIM_ENABLED="false";
const {pool}=await import("@workspace/db");
const {importIdfm}=await import("../src/transit/idfm/import");
const {IMPORT_LOCK,cleanupGenerations}=await import("../src/transit/generations");
const {createEdition,editionTable}=await import("../src/transit/idfm/storage");
const {findStops,findRoutes,parisTimetable,parisArrivals,parisRoute,mapPage}=await import("../src/transit/idfm/queries");
const {catalog,timetable}=await import("../src/transit/catalog");
const {network}=await import("../src/transit/network");
const {allStops,nearby,stopDetail,routeDetail,sources}=await import("../src/transit/service");
const {favoriteAvailability,lookupFavorite}=await import("../src/transit/favorite-availability");
const output=new URL("../../../generated-artifacts/idfm/fixtures/",import.meta.url);
await mkdir(output,{recursive:true});
process.env.IDFM_ARCHIVE_CACHE=new URL("cache/",output).pathname;
await (await import("node:fs/promises")).rm(process.env.IDFM_ARCHIVE_CACHE,{recursive:true,force:true});
execFileSync("python3",["-c",`
import zipfile,sys
from pathlib import Path
root=Path(sys.argv[1])
for variant in ['valid','orphan','expired','zone','changed','unknown-route','long-id','duplicate']:
  files={
    'agency':'agency_id,agency_name,agency_timezone\\na,Réseau parisien,'+('America/New_York' if variant=='zone' else 'Europe/Paris')+'\\n',
    'routes':'route_id,agency_id,route_short_name,route_long_name,route_type,route_color\\nM,a,1,Métro Château,1,FFCD00\\nR,a,A,RER A,2,E30520\\nT,a,T3a,Tramway T3a,0,F28E42\\nB,a,42,Bus 42,3,0082C3\\nF,a,F,Frequency,3,0082C3\\nX,a,X,Funiculaire,7,FFFFFF\\nD,a,TàD,Sur réservation,3,FFFFFF\\n',
    'attributions':'route_id,is_operator,organization_name\\nB,1,Opérateur Étoile\\nM,1,RATP\\n',
    'stops':'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station,wheelchair_boarding,platform_code\\nP,Châtelet,48.85,2.35,1,,0,\\nS,Châtelet - Île,48.85,2.35,0,P,0,Quai É\\nU,Châtelet quai distinct,48.85001,2.35001,0,P,2,2\\nZ,Terminus,48.86,2.36,0,,1,\\n',
    'trips':'route_id,service_id,trip_id,direction_id,trip_headsign,shape_id\\nM,daily,JM,0,Château de Vincennes,P\\nR,daily,JR,1,Saint-Germain-en-Laye,P\\nT,daily,JT,0,Pont du Garigliano,P\\nB,daily,JB,1,Gare du Nord,P\\nB,daily,JN,0,Étoile,P\\nB,daily,JU,0,Untimed,P\\nB,daily,JQ,0,Approximate,P\\nF,daily,JF,0,Frequency,P\\nX,daily,JX,0,Excluded,P\\nD,daily,JD,0,Excluded,P\\n',
    'calendar':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\\ndaily,1,1,1,1,1,1,1,20260101,'+('20260102' if variant=='expired' else '20271231')+'\\n',
    'calendar_dates':'service_id,date,exception_type\\ndaily,20261103,2\\n',
    'stop_times':'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,timepoint,stop_headsign\\n'+''.join(f'{j},10:00:00,10:00:00,S,0,0,1,Destination fournie\\n{j},10:30:00,10:30:00,Z,1,1,1,\\n' for j in ['JM','JR','JT','JB','JF','JX','JD'])+'JN,25:15:00,25:15:00,U,0,0,1,Étoile\\nJU,,,S,0,0,1,\\nJQ,10:00:00,10:00:00,S,0,0,0,\\n',
    'frequencies':'trip_id,start_time,end_time,headway_secs,exact_times\\nJF,10:00:00,12:00:00,600,0\\nJF,13:00:00,14:00:00,600,1\\n',
    'translations':'table_name,field_name,language,translation,record_id\\nstops,stop_name,en,Chatelet Island,S\\n',
    'shapes':'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\\nP,48.85,2.35,0\\nP,48.86,2.36,1\\n'
  }
  if variant=='orphan': files['stop_times']=files['stop_times'].replace('JB,10:00:00,10:00:00,S','JB,10:00:00,10:00:00,UNKNOWN')
  if variant=='changed': files['routes']=files['routes'].replace('Bus 42','Changed bus')
  if variant=='unknown-route': files['trips']=files['trips'].replace('B,daily,JB','UNKNOWN,daily,JB')
  if variant=='long-id': files['routes']=files['routes'].replace('M,a,1,',('M'*600)+',a,1,')
  if variant=='duplicate': files['stop_times']+='JB,10:00:00,10:00:00,S,0,0,1,Duplicate\\n'
  with zipfile.ZipFile(root/(variant+'.zip'),'w',zipfile.ZIP_DEFLATED) as z:
    for n,data in files.items():z.writestr(n+'.txt',data)
`,output.pathname]);
const archives=new Map(await Promise.all(["valid","orphan","expired","zone","changed","unknown-route","long-id","duplicate"].map(async key=>[key,new Uint8Array(await readFile(new URL(key+".zip",output)))] as const)));
const bomb=Buffer.from(archives.get("valid")!);
const eocd=bomb.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
bomb.writeUInt16LE(65535,eocd+8);bomb.writeUInt16LE(65535,eocd+10);
const bombPath=new URL("directory-bomb.zip",output).pathname;
await writeFile(bombPath,bomb);
await assert.rejects(preflightZip(bombPath),/directory bound/,"Reject directory bombs before allocating ZIP entry objects");
let variant="valid",notModified=false,requests=0,headers:Headers|undefined;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),IDFM_URL,"No non-fixture network access permitted");
  requests++;headers=new Headers(options?.headers);
  return notModified?new Response(null,{status:304}):new Response(archives.get(variant),{
    headers:{"etag":'"fixture-1"',"last-modified":"Fri, 30 Oct 2026 15:24:00 GMT"}});
};
try{
  await pool.query("DROP SCHEMA IF EXISTS idfm_data CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(await readFile(new URL("../../../lib/db/drizzle/0000_little_victor_mancha.sql",import.meta.url),"utf8"));
  await pool.query("CREATE TABLE transit_idfm_stop_times(LIKE transit_stop_times INCLUDING DEFAULTS INCLUDING CONSTRAINTS)");
  await pool.query("CREATE INDEX transit_trips_route_idx ON transit_trips(mode,agency,(data->>'route_id'))");
  await pool.query(`INSERT INTO transit_routes(id,mode,agency,data) VALUES('other:route','live','other','{"id":"other:route","name":"Existing","type":"bus","agency":"Other"}')`);
  assert.equal(parisMode("0")?.detail,"Tramway");assert.equal(parisMode("2")?.type,"rail");
  assert.equal(parisMode("3")?.type,"bus");assert.equal(parisMode("1")?.type,"subway");
  assert.equal(parisMode("208")?.detail,"Car / coach");assert.equal(parisMode("7"),undefined);
  assert.equal(publicationSlot(Date.parse("2026-10-31T12:45:00Z")),"2026-10-31T13:00:00.000+01:00");
  assert.equal(refreshDue({checkedAt:"2026-10-31T12:30:00Z"},Date.parse("2026-10-31T12:45:00Z")),false);
  assert.equal(refreshDue(undefined),true);
  assert(!expiredEdition({serviceEnd:"20261031",maxDepartureSeconds:27*3600},Date.parse("2026-11-01T00:30:00Z")),"Final service-day overnight calls remain eligible");
  assert(expiredEdition({serviceEnd:"20261031",maxDepartureSeconds:27*3600},Date.parse("2026-11-01T03:30:00Z")));
  const deployment=process.env.REPLIT_DEPLOYMENT;
  process.env.REPLIT_DEPLOYMENT="1";delete process.env.IDFM_PUBLIC_COMPLIANCE_CONFIRMED;
  assert.equal(idfmEnabled(),false);process.env.IDFM_PUBLIC_COMPLIANCE_CONFIRMED="true";assert(idfmEnabled());
  delete process.env.IDFM_PUBLIC_COMPLIANCE_CONFIRMED;
  if(deployment===undefined)delete process.env.REPLIT_DEPLOYMENT;else process.env.REPLIT_DEPLOYMENT=deployment;
  assert.throws(()=>validateZip([{path:"../stops.txt",type:"File",uncompressedSize:1,compressedSize:1}]),/Unsafe/);
  assert.throws(()=>validateZip([{path:"stops.txt",type:"File",uncompressedSize:limits.expanded+1,compressedSize:1}]),/expansion/);
  assert.throws(()=>validateZip(Array(33).fill({path:"stops.txt",type:"File",uncompressedSize:1,compressedSize:1})),/file limit/);
  const owner=await pool.connect();
  await owner.query("SELECT pg_advisory_lock($1)",[IMPORT_LOCK]);
  await assert.rejects(importIdfm(),/already running/);assert.equal(requests,0);
  await owner.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);owner.release();
  await importIdfm();
  const snapshot=async()=>(await pool.query("SELECT data FROM transit_feed_snapshots WHERE id='idfm:static' AND mode='live'")).rows[0].data;
  let before=await snapshot();assert.equal(before.routeCount,5);
  {
    const saved=[{kind:"stop" as const,id:"idfm:S"},{kind:"route" as const,id:"idfm:M"}];
    const original=structuredClone(saved);
    const warm=await favoriteAvailability(saved);
    assert(warm.every(row=>row.status==="available"&&row.currentName),"Populate the real metadata cache before withdrawing permission");
    const oldNode=process.env.NODE_ENV,oldDeployment=process.env.REPLIT_DEPLOYMENT;
    const oldConfirmation=process.env.IDFM_PUBLIC_COMPLIANCE_CONFIRMED;
    await pool.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data)
      VALUES('idfm:prim-status','live','idfm','{"message":"PRIVATE-PRIM-STATUS","checkedAt":"2026-10-31T00:00:00Z"}')`);
    try{
      process.env.NODE_ENV="production";process.env.REPLIT_DEPLOYMENT="1";
      delete process.env.IDFM_PUBLIC_COMPLIANCE_CONFIRMED;
      assert(!idfmEnabled());
      const blocked=await favoriteAvailability([...saved,{kind:"stop",id:"idfm:NOT-A-SUPPLIED-ID"},{kind:"route",id:"idfm"}]);
      assert(blocked.every(row=>row.status==="unknown"&&row.currentName===undefined),"A warm cache must not disclose a retained name or listing while gated");
      assert.deepEqual(await lookupFavorite(saved[0]),{status:"unknown",message:"Could not verify this source right now. Your saved item is kept; try again later."});
      const source=(await sources()).find(row=>row.id==="idfm")!;
      assert.match(source.status,/disabled/);
      assert("routeCount" in source&&"stopCount" in source);
      assert.equal(source.routeCount,0);assert.equal(source.stopCount,0);assert.equal(source.updatedAt,null);
      for(const field of ["importedAt","serviceStart","serviceEnd","lastError","sourceUrl"])
        assert.equal((source as Record<string,unknown>)[field],undefined,`No gated ${field}`);
      const publicSource=JSON.stringify(source);
      for(const privateValue of ["Réseau parisien","Opérateur Étoile","PRIVATE-PRIM-STATUS",before.importedAt])
        assert(!publicSource.includes(privateValue),"Source inventory must not disclose retained imported metadata");
      assert.equal(await stopDetail("idfm:S","live"),undefined);
      assert.equal(await routeDetail("idfm:M","live"),undefined);
      assert.deepEqual(saved,original,"A permission gate never deletes or rewrites riders' saved identities");
      assert.equal((await snapshot()).stopTimesMode,before.stopTimesMode,"Public gating keeps the retained edition intact");
      process.env.IDFM_PUBLIC_COMPLIANCE_CONFIRMED="true";
      assert((await favoriteAvailability(saved)).every(row=>row.status==="available"),"Restoring permission can reuse verified identities");
      assert(!JSON.stringify((await sources()).find(row=>row.id==="idfm")).includes("PRIVATE-PRIM-STATUS"),
        "Schedule permission does not expose separately disabled PRIM cache metadata");
    }finally{
      for(const [key,value] of [["NODE_ENV",oldNode],["REPLIT_DEPLOYMENT",oldDeployment],["IDFM_PUBLIC_COMPLIANCE_CONFIRMED",oldConfirmation]])
        if(value===undefined)delete process.env[key!];else process.env[key!]=value;
      await pool.query("DELETE FROM transit_feed_snapshots WHERE id='idfm:prim-status'");
    }
  }
  const loading=`import-${randomUUID()}`,editionOwner=await pool.connect();
  try{
    await editionOwner.query("SELECT pg_advisory_lock($1)",[IMPORT_LOCK]);
    await createEdition(editionOwner,loading);
    await editionOwner.query(`INSERT INTO ${editionTable(loading)}
      (id,mode,agency,trip_id,stop_id,sequence,arrival_seconds,departure_seconds,data)
      SELECT id,$1,agency,trip_id,stop_id,sequence,arrival_seconds,departure_seconds,data
      FROM transit_idfm_stop_times LIMIT 1`,[loading]);
    assert.equal(Number((await pool.query("SELECT count(*) FROM transit_idfm_stop_times WHERE mode=$1",[loading])).rows[0].count),0,
      "A loading, unindexed edition must not enter the reader's inherited relation");
    await cleanupGenerations(100000,"idfm");
    assert.equal((await pool.query("SELECT to_regclass($1) AS table",[editionTable(loading)])).rows[0].table,null,
      "Retired call editions are physically dropped, not millions of row deletes");
    assert.equal((await snapshot()).stopTimesMode,before.stopTimesMode,"Cleanup preserves the active edition");
  }finally{await editionOwner.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);editionOwner.release();}
  assert.throws(()=>editionTable("import-'; DROP TABLE transit_stops"),/Invalid IDFM storage/);
  const {retireLegacyIdfmCalls}=await import("../src/transit/idfm/retire-legacy");
  await pool.query(`INSERT INTO transit_stop_times(id,mode,agency,data,trip_id,stop_id,sequence,arrival_seconds,departure_seconds)
    SELECT 'legacy:paris','obsolete','idfm',data,trip_id,stop_id,sequence,arrival_seconds,departure_seconds
    FROM transit_idfm_stop_times LIMIT 1`);
  await pool.query(`INSERT INTO transit_stop_times(id,mode,agency,data,trip_id,stop_id,sequence,arrival_seconds,departure_seconds)
    SELECT 'legacy:other','obsolete','other',data,trip_id,stop_id,sequence,arrival_seconds,departure_seconds
    FROM transit_idfm_stop_times LIMIT 1`);
  const activeRegistry=`idfm:generation:${before.stopTimesMode}`;
  await pool.query("UPDATE transit_feed_snapshots SET data=data||'{\"storage\":\"legacy\"}'::jsonb WHERE id=$1",[activeRegistry]);
  try{
    await assert.rejects(retireLegacyIdfmCalls(),/active IDFM edition must use isolated storage/);
    assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE id='legacy:paris'")).rows[0].count,"1");
  }finally{
    await pool.query("UPDATE transit_feed_snapshots SET data=data||'{\"storage\":\"idfm-edition\"}'::jsonb WHERE id=$1",[activeRegistry]);
  }
  assert.equal((await retireLegacyIdfmCalls()).deleted,1);
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE id='legacy:other'")).rows[0].count,"1");
  assert.equal((await snapshot()).stopTimesMode,before.stopTimesMode);
  assert.equal(before.attributionRows,2);assert.equal(before.translationRows,1);
  assert.equal((await pool.query("SELECT count(*) FROM transit_routes WHERE id='other:route'")).rows[0].count,"1");
  assert(!(await allStops("live")).some(s=>s.id.startsWith("idfm:")),"Legacy cache must exclude the region");
  const stops=await findStops({q:"Châtelet"});assert.equal(stops.total,3);
  assert.equal((await findStops({q:"Chatelet Island"})).total,1,"Only supplied translations are searchable, never invented romanization");
  const platform=stops.stops.find(s=>s.id==="idfm:S")!;
  assert.equal(platform.routes.length,5);assert.equal(platform.idfm?.platform,"Quai É");assert.equal(platform.idfm?.accessibility,"Unknown");
  assert((await findStops({type:"subway"})).stops.some(s=>s.id==="idfm:S"));
  assert((await findStops({type:"bus"})).stops.some(s=>s.id==="idfm:S"));
  const rr=await findRoutes({q:"42"});assert.equal(rr.routes[0].agency,"Opérateur Étoile");
  assert.equal(rr.routes[0].serviceClass,undefined,"Never invent express/local");
  const p={stopId:"idfm:S",date:"2026-10-31",from:"00:00"};
  const table=await parisTimetable(p);assert.equal(table.total,4);
  assert(table.departures.every(d=>d.timezone==="Europe/Paris"&&d.destination==="Destination fournie"));
  assert.match(table.message,/approximate headway/);assert.match(table.message,/exact repeating service/);assert.equal(table.departures.filter(d=>d.tripId==="idfm:JF").length,0);
  assert.equal((await parisTimetable({...p,date:"2026-11-03"})).total,0);
  assert.equal((await parisTimetable({...p,stopId:"idfm:Z"})).total,0,"Drop-off only is not boarding");
  const overnight=await parisTimetable({...p,stopId:"idfm:U"});
  assert.equal(DateTime.fromISO(overnight.departures[0].time,{zone:"Europe/Paris"}).toFormat("yyyy-MM-dd HH:mm"),"2026-11-01 01:15");
  assert.equal((await parisTimetable({...p,limit:1,offset:1})).departures.length,1);
  assert.equal((await parisTimetable({...p,routeId:"idfm:M"})).total,1);
  assert.equal((await parisTimetable({routeId:"idfm:M",date:p.date})).total,1,"Route-only timetables bind nullable stop parameters");
  await assert.rejects(parisTimetable({date:p.date}),/stop or route is required/);
  assert.equal((await parisTimetable({...p,stopId:"idfm:P"})).total,5);
  assert.equal((await parisArrivals(platform,Date.parse("2026-10-31T08:55:00Z"))).length,4);
  assert.equal((await parisRoute("idfm:M"))?.stops.length,2);
  assert.equal((await routeDetail("idfm:M","live"))?.route.id,"idfm:M");
  assert.equal((await stopDetail("idfm:S","live"))?.id,"idfm:S");
  assert((await nearby({mode:"live",q:"Paris",agency:"idfm"})).stops.length);
  assert((await catalog({mode:"live",agency:"idfm",type:"subway",q:"",limit:2,offset:0})).routes.length);
  const map=await mapPage({zoom:14},{west:2.3,east:2.4,south:48.8,north:48.9});
  assert(map.lines.length&&map.stops.length);assert(map.lines.every(l=>!l.vehicles.length));
  assert((await network({mode:"live",agency:"idfm",west:2.3,east:2.4,south:48.8,north:48.9,zoom:14})).totalStops);
  const rawRoute={route_id:"B",agency:{agency_id:"a"}};
  assert(verifiedIdfmFeed({urls:{static_current:IDFM_URL}}));
  assert(!verifiedIdfmFeed({name:"IDFM",urls:{static_current:"https://example.com/IDFM.zip"}}));
  assert(routeDuplicate(rawRoute,rr.routes));
  const rawStop={stop_id:"S",parent_station:"P",platform_code:"Quai É",geometry:{coordinates:[2.35,48.85]}};
  assert(boardingDuplicate(rawStop,rawRoute,[platform]));
  assert(!boardingDuplicate({...rawStop,platform_code:"2"},rawRoute,[platform]));
  assert(!routeDuplicate({...rawRoute,agency:{agency_id:"different"}},rr.routes));
  assert.equal((await timetable({mode:"live",...p,routeId:"ibg:retired",offset:0,limit:40})).total,0);
  for(const date of ["20260329","20261025"]){
    const noon=DateTime.fromFormat(date,"yyyyMMdd",{zone:"Europe/Paris"}).set({hour:12}).toMillis();
    assert.equal(serviceInstant(date,12*3600,"Europe/Paris"),noon);
  }
  notModified=true;await importIdfm();
  assert.equal(headers?.get("if-none-match"),'"fixture-1"');assert.equal((await snapshot()).stopTimesMode,before.stopTimesMode);
  await pool.query(`UPDATE transit_feed_snapshots SET data=jsonb_set(data,'{idfmMethodVersion}','0') WHERE id='idfm:static' AND mode='live'`);
  await importIdfm(); // 304 + changed method must parse the intact cached body, not claim it was published.
  assert.notEqual((await snapshot()).stopTimesMode,before.stopTimesMode);
  assert.equal((await snapshot()).idfmMethodVersion,1);before=await snapshot();
  notModified=false;
  for(variant of ["orphan","expired","zone","unknown-route","long-id","duplicate"]){
    await assert.rejects(importIdfm());assert.equal((await snapshot()).stopTimesMode,before.stopTimesMode);
  }
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response("x",{headers:{"content-length":String(limits.compressed+1)}});
  await assert.rejects(importIdfm(),/compressed/);globalThis.fetch=oldFetch;
  const abort=new AbortController();abort.abort();
  await assert.rejects(importIdfm(abort.signal));assert.equal((await snapshot()).stopTimesMode,before.stopTimesMode);
  variant="changed";
  await pool.query(`CREATE FUNCTION reject_idfm_publish() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='idfm:static' THEN RAISE EXCEPTION 'publication fixture failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_idfm BEFORE UPDATE ON transit_feed_snapshots FOR EACH ROW EXECUTE FUNCTION reject_idfm_publish()`);
  await assert.rejects(importIdfm(),/publication fixture failure/);
  assert.equal((await findRoutes({q:"42"})).routes[0].longName,"Bus 42");
  assert.equal((await snapshot()).stopTimesMode,before.stopTimesMode);
  await pool.query("DROP TRIGGER reject_idfm ON transit_feed_snapshots; DROP FUNCTION reject_idfm_publish()");
  await pool.query(`UPDATE transit_feed_snapshots SET data=jsonb_set(data,'{serviceEnd}','"20260101"') WHERE id='idfm:static' AND mode='live'`);
  assert.equal((await parisTimetable(p)).total,0,"Expired edition does not supply current clocks");
  const {reservePrimRequest}=await import("../src/transit/idfm/prim-budget");
  const budgetClient=await pool.connect();
  try{
    assert.equal(await reservePrimRequest(budgetClient,"2026-10-31"),1);
    await budgetClient.query(`UPDATE transit_feed_snapshots SET data='{"used":179}' WHERE mode='live' AND id='idfm:prim-budget:2026-10-31'`);
    assert.equal(await reservePrimRequest(budgetClient,"2026-10-31"),180);
    assert.equal(await reservePrimRequest(budgetClient,"2026-10-31"),undefined,"Daily cap survives independent requests");
    assert.equal(await reservePrimRequest(budgetClient,"2026-11-01"),1,"New UTC day has its own persistent budget");
  }finally{budgetClient.release();}
  console.log("IDFM fixtures passed: full staging/publication, source bounds/failures, calendars, modes/platforms, timezone, browsing, frequencies, revalidation, expiry, last-good retention and persistent PRIM budget.");
}finally{globalThis.fetch=nativeFetch;await pool.end();}
