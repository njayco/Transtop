// Entire importer/reader flow against a disposable database and local ZIPs.
// No catalog requests, credentials, publisher downloads or workspace data.
import assert from "node:assert/strict";
import { mock } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir,readFile } from "node:fs/promises";
import { Open } from "unzipper";

process.env.DATABASE_URL="postgresql://benchmark@127.0.0.1:55440/mobility_import_test";
process.env.MOBILITY_DATABASE_REFRESH_TOKEN="fixture-not-a-secret";
process.env.IDFM_ENABLED="false";
const output=new URL("../../../generated-artifacts/mobility-fixtures/",import.meta.url);
await mkdir(output,{recursive:true});
execFileSync("python3",["-c",`
import zipfile,sys
from pathlib import Path
root=Path(sys.argv[1])
for variant in ['valid','timezone','stop','service','duplicate','frequency','shape']:
  files={
    'agency':'agency_id,agency_name,agency_timezone\\na,Fixture,Europe/Berlin\\n',
    'routes':'route_id,agency_id,route_short_name,route_type\\nR,a,1,3\\n',
    'stops':'stop_id,stop_name,stop_lat,stop_lon,parent_station\\nS,Fixture stop,52.5,13.4,P\\nP,Fixture station,52.5,13.4,\\n',
    'trips':'route_id,trip_id,service_id,shape_id,trip_headsign\\nR,T,daily,line,Terminal\\n',
    'stop_times':'trip_id,arrival_time,departure_time,stop_id,stop_sequence\\nT,25:00:00,25:00:00,S,1\\n',
    'calendar':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\\ndaily,1,1,1,1,1,1,1,20260101,20271231\\n',
    'shapes':'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\\nline,52.6,13.5,2\\nline,52.5,13.4,1\\n'
  }
  if variant=='timezone':files['agency']=files['agency'].replace('Europe/Berlin','UTC')
  if variant=='stop':files['stop_times']=files['stop_times'].replace(',S,',',unknown,')
  if variant=='service':files['calendar']=files['calendar'].replace('daily,','unknown,')
  if variant=='duplicate':files['stop_times']+='T,25:00:00,25:00:00,S,1\\n'
  if variant=='frequency':files['frequencies']='trip_id,start_time,end_time,headway_secs\\nT,10:00:00,11:00:00,600\\n'
  if variant=='shape':files['shapes']=files['shapes'].replace('52.6','999')
  with zipfile.ZipFile(root/f'{variant}.zip','w',zipfile.ZIP_DEFLATED) as z:
    for name,data in files.items():z.writestr(name+'.txt',data)
`,output.pathname]);
let zip=await Open.file(new URL("valid.zip",output).pathname);
mock.module("../src/transit/mobility/archive",{exports:{openArchive:async()=>({zip,zipBytes:100,expandedBytes:1000,cached:true})}});
const {pool}=await import("@workspace/db");
const {restoreRegistry}=await import("../src/transit/mobility/registry");
const {adapters}=await import("../src/transit/adapters");
const {importGtfs}=await import("../src/transit/importer");
const {timetable}=await import("../src/transit/catalog");
const {routeDetail}=await import("../src/transit/service");
const {allStops}=await import("../src/transit/service");
const {findStops,mapPage}=await import("../src/transit/mobility/queries");
const agency="mobility-mdb-fixture",stop=`${agency}:S`;
try{
  await pool.query("DROP SCHEMA IF EXISTS mobility_data CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(await readFile(new URL("../../../lib/db/drizzle/0000_little_victor_mancha.sql",import.meta.url),"utf8"));
  const record={id:"mdb-fixture",kind:"gtfs",name:"Fixture",provider:"Fixture",eligible:true,reason:"Eligible for bounded schedule import",
    regional:true,status:"active",official:true,countries:["DE"],regions:["Berlin"],timezone:"Europe/Berlin",license:"CC-BY-4.0",
    licenseUrl:"https://creativecommons.org/licenses/by/4.0/",url:"https://mobilitydatabase.org/feeds/gtfs/mdb-fixture",
    hostedUrl:"https://files.mobilitydatabase.org/mdb-fixture/dataset/dataset.zip",datasetId:"fixture",
    downloadedAt:"2026-10-30T00:00:00Z",validFrom:"2026-01-01",validThrough:"2027-12-31"};
  await pool.query("INSERT INTO transit_feed_snapshots(id,agency,mode,data) VALUES('mobility:registered:mdb-fixture','mobility','live',$1)",[{record,realtime:[]}]);
  await restoreRegistry();
  await importGtfs(agency);
  const snapshot=async()=>(await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`${agency}:static`])).rows[0].data;
  const previous=await snapshot();
  assert.equal(previous.mobilityMethodVersion,1);
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE agency=$1",[agency])).rows[0].count,"1");
  const times=await timetable({mode:"live",stopId:stop,date:"2026-10-31",from:"00:00",offset:0,limit:20});
  assert.equal(times.total,1);assert.equal(times.departures[0].time,"2026-11-01T00:00:00.000Z");
  assert.equal((await timetable({mode:"live",stopId:stop,date:"2030-01-01",from:"00:00",offset:0,limit:20})).total,0);
  const route=await routeDetail(`${agency}:R`,"live");
  assert.deepEqual(route?.shape,[[13.4,52.5],[13.5,52.6]]);
  assert.equal(route?.route.mobility?.license,"CC-BY-4.0");
  assert.equal((await allStops("live")).some(s=>s.id===stop),false,"Regional records must stay out of the global cache");
  assert.equal((await findStops({agency,q:"Fixture"},undefined,1)).total,2);
  assert.equal((await findStops({agency},undefined,1,1)).stops.length,1);
  const map=await mapPage({agency,routeId:`${agency}:R`,zoom:14},{west:13,south:52,east:14,north:53});
  assert.equal(map.lines.length,1);assert.equal(map.stops.length,2);
  // Immutable unchanged editions do not rebuild their tables.
  await importGtfs(agency);
  assert.equal((await snapshot()).stopTimesMode,previous.stopTimesMode);
  const a=adapters.find(a=>a.id===agency)!;
  for(const variant of ["timezone","stop","service","duplicate","frequency","shape"]){
    zip=await Open.file(new URL(`${variant}.zip`,output).pathname);
    a.mobility!.datasetId=variant;
    await assert.rejects(importGtfs(agency),undefined,variant);
    assert.equal((await snapshot()).stopTimesMode,previous.stopTimesMode,`${variant}: prior publication retained`);
    assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE agency=$1",[agency])).rows[0].count,"1");
  }
  // Rollback includes the inheritance DDL, not just snapshot metadata.
  zip=await Open.file(new URL("valid.zip",output).pathname);a.mobility!.datasetId="next";
  await pool.query(`CREATE FUNCTION reject_mobility() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='${agency}:static' THEN RAISE EXCEPTION 'synthetic publication failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_mobility BEFORE UPDATE ON transit_feed_snapshots FOR EACH ROW EXECUTE FUNCTION reject_mobility()`);
  await assert.rejects(importGtfs(agency));
  assert.equal((await snapshot()).stopTimesMode,previous.stopTimesMode);
  assert.equal((await pool.query("SELECT count(*) FROM pg_inherits WHERE inhparent='transit_stop_times'::regclass")).rows[0].count,"1");
  assert.equal((await timetable({mode:"live",stopId:stop,date:"2026-10-31",from:"00:00",offset:0,limit:20})).total,1);
  console.log("Mobility import, source-zone overnight times, supplied geometry, unchanged edition, six invalid feeds and atomic DDL rollback passed");
}finally{mock.restoreAll();await pool.end();}
