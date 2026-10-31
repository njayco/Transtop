import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
// Never point this destructive suite at a workspace or production database.
process.env.DATABASE_URL="postgres://benchmark@127.0.0.1:55439/gtfs_import_test";
process.env.WMATA_API_KEY="wmata-fixture-only";
process.env.WMATA_VERIFIED_DAILY_LIMIT="50000";
process.env.WMATA_ENABLED="true";
process.env.TRANSITLAND_ENABLED="false";
process.env.TFL_ENABLED="false";
const {pool}=await import("@workspace/db");
const {importGtfs}=await import("../src/transit/importer");
const {catalog,timetable}=await import("../src/transit/catalog");
const {sourceUrl}=await import("../src/transit/wmata/client");
const root=new URL("../../../generated-artifacts/wmata-fixtures/",import.meta.url);
await mkdir(root,{recursive:true});
execFileSync("python3",["-c",`
import zipfile,sys
with zipfile.ZipFile(sys.argv[1], 'w',zipfile.ZIP_DEFLATED) as z:
  files={
    'agency':'agency_id,agency_name,agency_timezone\\n1,WMATA,America/New_York\\n',
    'routes':'route_id,agency_id,route_short_name,route_long_name,route_type,route_color\\nRED,1,R,Red,1,C80F2D\\nC51,1,C51,Metrobus corridor,3,0091C8\\n',
    'stops':'stop_id,stop_name,stop_lat,stop_lon,parent_station,location_type\\nSTN,Metro Center,38.8983,-77.0281,,1\\nPF,Track 1,38.8983,-77.0281,STN,0\\nENT,Entrance,38.8984,-77.0282,STN,2\\nBUS,Bus stop,38.899,-77.029,,0\\n',
    'trips':'route_id,service_id,trip_id,direction_id,trip_headsign,scheduled_trip_id\\nRED,daily,123_1,0,Glenmont,123\\nC51,daily,456,1,Takoma,\\n',
    'stop_times':'trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type\\n123_1,PF,1,25:10:00,25:10:00,0\\n456,BUS,1,12:10:00,12:10:00,0\\n',
    'calendar':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\\ndaily,1,1,1,1,1,1,1,20260101,20271231\\n',
    'calendar_dates':'service_id,date,exception_type\\ndaily,20261101,2\\n',
    'feed_info':'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date\\nWMATA,https://www.wmata.com,en,20260101,20271231\\n'
  }
  for name,data in files.items():z.writestr(name+'.txt',data)
`,new URL("combined.zip",root).pathname]);
const bytes=await readFile(new URL("combined.zip",root)),nativeFetch=globalThis.fetch;
let fail=false;
globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),sourceUrl("static"),"No non-fixture request permitted");
  assert.equal((options?.headers as any).api_key,"wmata-fixture-only");
  return fail?new Response(null,{status:403}):new Response(new Uint8Array(bytes));
};
try{
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(await readFile(new URL("../../../lib/db/drizzle/0000_little_victor_mancha.sql",import.meta.url),"utf8"));
  await importGtfs("wmata");
  const snapshot=(await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='wmata:static'")).rows[0].data;
  assert.equal(snapshot.routeCount,2);assert.equal(snapshot.stopCount,4);
  assert.equal(snapshot.sourceUrl,sourceUrl("static"));assert(!JSON.stringify(snapshot).includes("wmata-fixture-only"));
  const result=await catalog({mode:"live",agency:"wmata",offset:0,limit:20});
  assert.deepEqual(new Set(result.routes.map(r=>r.type)),new Set(["subway","bus"]));
  assert(result.stops.some(s=>s.id==="wmata:STN"));assert(result.stops.some(s=>s.id==="wmata:PF"));
  assert(!result.stops.some(s=>s.id==="wmata:ENT"));
  const times=await timetable({mode:"live",date:"2026-10-30",stopId:"wmata:STN",from:"00:00",offset:0,limit:20});
  assert.equal(times.departures.length,1);assert.equal(times.departures[0].destination,"Glenmont");
  assert.equal(times.departures[0].time,"2026-10-31T05:10:00.000Z");
  const exception=await timetable({mode:"live",date:"2026-11-01",routeId:"wmata:RED",from:"00:00",offset:0,limit:20});
  assert.equal(exception.departures.length,0);
  const before=(await pool.query("SELECT id FROM transit_stops WHERE mode='live' AND agency='wmata' ORDER BY id")).rows;
  // Release only the disposable request ledger spacing; never modify a live budget.
  await pool.query("DELETE FROM transit_feed_snapshots WHERE id='wmata:budget'");
  fail=true;await assert.rejects(importGtfs("wmata"),/previous complete generation retained/);
  assert.equal((await pool.query("SELECT data->>'stopTimesMode' AS generation FROM transit_feed_snapshots WHERE id='wmata:static'")).rows[0].generation,snapshot.stopTimesMode);
  assert.deepEqual((await pool.query("SELECT id FROM transit_stops WHERE mode='live' AND agency='wmata' ORDER BY id")).rows,before);
  console.log("WMATA combined import, platform browsing, timetable/overnight, exceptions and failed-refresh preservation passed");
}finally{globalThis.fetch=nativeFetch;await pool.end();}
