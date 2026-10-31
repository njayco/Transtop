import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir,readFile } from "node:fs/promises";
import { odptRegistry,catalogUrl,realtimeUrl,sendaiRealtimeCatalog,odptRefreshDue } from "../src/transit/odpt/registry";
import { selectEdition,safeUrl,safeStorageRedirect,odptFetch,METADATA,verifyCatalogTerms,verifyRealtimeAccess } from "../src/transit/odpt/client";
import { catalogHtml } from "./odpt-catalog-fixtures";
import { odptRouteDuplicate,odptBoardingDuplicate } from "../src/transit/odpt/crosswalk";
import { validateArchive } from "../src/transit/odpt/gtfs";
import { activeService,serviceDates,serviceInstant } from "../src/transit/time";

process.env.DATABASE_URL="postgresql://benchmark@127.0.0.1:55439/gtfs_import_test";
process.env.TRANSITLAND_ENABLED="false";
process.env.TFL_ENABLED="false";
const {pool}=await import("@workspace/db");
const {importGtfs}=await import("../src/transit/importer");
const {catalog,timetable}=await import("../src/transit/catalog");
const {allStops,routeDetail,nearby}=await import("../src/transit/service");
const {network}=await import("../src/transit/network");
const {scheduledArrivals}=await import("../src/transit/schedules");
const {matchOdptRealtime,observationFresh}=await import("../src/transit/odpt/realtime");
const fixed=Date.parse("2026-10-31T00:00:00Z"),realNow=Date.now,nativeFetch=globalThis.fetch;
Date.now=()=>fixed;
const edition=(s:typeof odptRegistry[number],extra={})=>({
  url:`https://api-public.odpt.org/api/v4/files/odpt/${s.organization}/${s.dataset}.zip?date=20261001`,
  start_at:"2026-10-01",end_at:"2026-11-30",uploaded_at:"2026-10-01T00:00:00Z",
  feed_start_date:"2026-10-01",feed_end_date:"2027-03-31",feed_version:"fixture",...extra,
});
const dataset=(s:typeof odptRegistry[number])=>({
  label:s.dataset,format_type:"GTFS/GTFS-JP",license_type:"CC BY 4.0",explain_ja:s.description,
  mode_list:[s.type==="bus"?"bus":"railway"],is_gtfsrt:!!s.realtime.length,dataresource:[edition(s)],
  ...(s.id==="odpt-sendai"?{vehicle_position:{is_operated:true,url:realtimeUrl(s,"vehicle")},
    trip_update:{is_operated:true,url:realtimeUrl(s,"trip_update")},alert:{is_operated:true,url:realtimeUrl(s,"alert")}}:{}),
});
const sendai=odptRegistry[0],hana=odptRegistry[1],tosaden=odptRegistry[2];
try{
  assert(odptRefreshDue({importedAt:new Date(fixed).toISOString(),serviceEnd:"2026-10-30"},fixed));
  assert(!odptRefreshDue({importedAt:new Date(fixed).toISOString(),serviceEnd:"2026-11-30"},fixed));
  assert(odptRefreshDue({importedAt:new Date(fixed-23*3600000).toISOString(),serviceEnd:"2026-11-30"},fixed));
  for(const s of odptRegistry){
    verifyCatalogTerms(catalogHtml(s.id,s.catalog),s);
    assert.throws(()=>verifyCatalogTerms(catalogHtml(s.id,s.catalog).replace('CC BY 4.0</a> の下','CC BY 4.0</a> new restriction の下'),s));
  }
  const ds=dataset(hana),old=edition(hana,{start_at:"2026-09-01",uploaded_at:"2026-10-20T00:00:00Z"});
  ds.dataresource=[edition(hana,{start_at:"2026-11-01"}),edition(hana),old];
  assert.equal(selectEdition(ds,hana,fixed).start_at,"2026-10-01","Not array order or latest upload alone");
  for(const bad of [
    {...ds,license_type:"ODPT Basic License"},{...ds,license_type:"Challenge Limited"},
    {...ds,license_explain:"new agreement"},{...ds,mode_list:["bus","railway"]},
    {...ds,explain_ja:"changed terms"},{...ds,dataresource:[edition(hana,{end_at:"2026-10-30"})]},
    {...ds,dataresource:[edition(hana,{feed_end_date:"2026-10-30"})]},
  ])assert.throws(()=>selectEdition(bad,hana,fixed));
  for(const u of [
    "http://api-public.odpt.org/x","https://evil.example/feed.zip",
    edition(hana).url+"&acl:consumerKey=DO_NOT_LEAK",
    edition(hana).url.replace("api-public","api"),
    edition(hana).url.replace("AllLines","Other"),edition(hana).url+"#fragment",
  ])assert.throws(()=>safeUrl(u,hana),e=>!String(e).includes("DO_NOT_LEAK"));
  const signed="https://dataodpt.blob.core.windows.net/files-open/odpt/NishitokyoCity/AllLines-20261001.zip?sp=r&sig=fixture";
  assert.equal(safeStorageRedirect(signed,edition(hana).url,hana),signed);
  for(const u of [signed.replace("files-open","files-private"),signed.replace("20261001","20261002"),
    signed.replace("dataodpt.blob.core.windows.net","evil.example"),signed.replace("sp=r","sp=rw")])
    assert.throws(()=>safeStorageRedirect(u,edition(hana).url,hana));
  for(const files of [
    [{path:"../agency.txt",uncompressedSize:2}],
    [{path:"a.txt",uncompressedSize:101*1024*1024}],
    [{path:"a.txt",uncompressedSize:1},{path:"a.txt",uncompressedSize:1}],
  ])assert.throws(()=>validateArchive({files} as any));
  assert.equal(new Date(serviceInstant("20261031",24*3600+20*60,"Asia/Tokyo")).toISOString(),"2026-10-31T15:20:00.000Z");
  assert(serviceDates(Date.parse("2026-10-31T15:10:00Z"),"Asia/Tokyo").includes("20261101"));
  const calendar={start_date:"20260101",end_date:"20271231",saturday:"1"};
  assert(activeService(calendar,[],"20261031"));
  assert(!activeService(calendar,[{date:"20261031",exception_type:"2"}],"20261031"));
  assert(activeService(undefined,[{date:"20261101",exception_type:"1"}],"20261101"));

  const output=new URL("../../../generated-artifacts/odpt-fixtures/",import.meta.url);await mkdir(output,{recursive:true});
  execFileSync("python3",["-c",`
import zipfile,sys
from pathlib import Path
for kind in ['bus','tram']:
 with zipfile.ZipFile(Path(sys.argv[1])/(kind+'.zip'),'w',zipfile.ZIP_DEFLATED) as z:
  files={
   'agency':'agency_id,agency_name,agency_timezone\\na,架空事業者,Asia/Tokyo\\n',
   'routes':f'route_id,agency_id,route_short_name,route_type\\nR,a,路線,{3 if kind=="bus" else 0}\\n',
   'stops':'stop_id,stop_name,stop_lat,stop_lon,wheelchair_boarding\\nS,東京駅,35.75,139.54,0\\nT,終点,35.76,139.55,1\\n',
   'trips':'route_id,service_id,trip_id,direction_id,trip_headsign,shape_id\\nR,daily,J,0,終点,P\\nR,daily,N,1,東京駅,P\\n',
   'calendar':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\\ndaily,1,1,1,1,1,1,1,20261001,20270331\\n',
   'calendar_dates':'service_id,date,exception_type\\ndaily,20261103,2\\n',
   'stop_times':'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign\\nJ,09:10:00,09:10:00,S,1,終点\\nJ,09:20:00,09:20:00,T,2,終点\\nN,24:20:00,24:20:00,T,1,東京駅\\nN,24:30:00,24:30:00,S,2,東京駅\\n',
   'translations':'table_name,field_name,language,translation,record_id,record_sub_id,field_value\\nstops,stop_name,en,Tokyo Station,S,,\\n',
   'shapes':'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\\nP,35.75,139.54,1\\nP,35.76,139.55,2\\n'
  }
  for k,v in files.items():z.writestr(k+'.txt',v)
`,output.pathname]);
  const bus=await readFile(new URL("bus.zip",output)),tram=await readFile(new URL("tram.zip",output));
  let fail=false;
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url===METADATA)return Response.json(odptRegistry.map(s=>({label:s.organization,datasets:[dataset(s)]})));
    if(url===sendaiRealtimeCatalog)return new Response(catalogHtml("odpt-sendai-realtime","odpt_sendai_municipal_bus_realtime_information"));
    const s=odptRegistry.find(s=>url===catalogUrl(s)||url===edition(s).url);
    assert(s,"Only allowlisted fixture downloads");
    if(url===catalogUrl(s))return new Response(catalogHtml(s.id,s.catalog));
    if(fail)return new Response("failure",{status:503});
    return new Response(new Uint8Array(s.type==="rail"?tram:bus));
  };
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(await readFile(new URL("../../../lib/db/drizzle/0000_little_victor_mancha.sql",import.meta.url),"utf8"));
  for(const s of odptRegistry)await importGtfs(s.id);
  assert.equal(await verifyRealtimeAccess(sendai,realtimeUrl(sendai,"vehicle")),"fixture");
  const ss=await allStops("live"),stop=ss.find(s=>s.id==="odpt-hana:S")!;
  assert.equal(stop.name,"東京駅 / Tokyo Station");assert.equal(stop.accessible,false);
  assert.equal(ss.find(s=>s.id==="odpt-tosaden:S")!.routes[0].odpt?.modeDetail,"Tram / streetcar · GTFS route_type 0");
  assert.equal((await catalog({mode:"live",q:"Tokyo Station",agency:"odpt-hana",offset:0,limit:20})).totalStops,1);
  assert(odptRouteDuplicate("f-nishitokyocity~alllines~jp","R","bus",stop.routes));
  assert(!odptRouteDuplicate("f-nishitokyocity~alllines~jp","other","bus",stop.routes));
  assert(!odptRouteDuplicate("unverified-feed","R","bus",stop.routes));
  assert(!odptRouteDuplicate("f-nishitokyocity~alllines~jp","R","rail",stop.routes));
  const rawStop={stop_id:"S",geometry:{coordinates:[stop.lon,stop.lat]}};
  assert(odptBoardingDuplicate("f-nishitokyocity~alllines~jp",rawStop,"R","bus",stop.routes,ss));
  assert(!odptBoardingDuplicate("f-nishitokyocity~alllines~jp",{...rawStop,stop_id:"S-other-platform"},"R","bus",stop.routes,ss));
  assert(!odptBoardingDuplicate("f-nishitokyocity~alllines~jp",{...rawStop,parent_station:"other-parent"},"R","bus",stop.routes,ss));
  assert(!odptBoardingDuplicate("f-nishitokyocity~alllines~jp",{...rawStop,geometry:{coordinates:[0,0]}},"R","bus",stop.routes,ss));
  const before=(await pool.query("SELECT data FROM transit_feed_snapshots WHERE id='odpt-hana:static' AND mode='live'")).rows[0].data;
  fail=true;await assert.rejects(importGtfs(hana.id),/previous complete generation retained/);
  assert.deepEqual((await pool.query("SELECT data FROM transit_feed_snapshots WHERE id='odpt-hana:static' AND mode='live'")).rows[0].data,before);
  assert.equal((await pool.query("SELECT count(*) FROM transit_stops WHERE mode='live' AND agency='odpt-sendai'")).rows[0].count,"2");
  const tableParams={mode:"live" as const,routeId:"odpt-hana:R",from:"00:00",offset:0,limit:40};
  const table=await timetable({...tableParams,date:"2026-10-31"});
  assert.equal(table.total,2);assert(table.departures.every(d=>d.timezone==="Asia/Tokyo"));
  assert(table.departures.some(d=>d.time==="2026-10-31T15:20:00.000Z"));
  assert.equal((await timetable({...tableParams,date:"2026-11-03"})).total,0);
  assert.equal((await timetable({...tableParams,date:"2026-12-01"})).total,0,"Resource expiry narrower than GTFS calendar");
  const arrivals=await scheduledArrivals(stop,new Set(),fixed);
  assert.equal(arrivals[0].destination,"終点");assert.equal(arrivals[0].minutes,10);assert.equal(arrivals[0].timezone,"Asia/Tokyo");
  assert(!(await scheduledArrivals(stop,new Set(),Date.parse("2026-12-01T00:00:00Z"))).length);
  const d=await routeDetail("odpt-tosaden:R","live");
  assert(d?.stops.length===2&&d.shape.length===2);assert(d.directions.includes("0 · 終点"));
  const map=await network({mode:"live",west:139.5,east:139.6,south:35.7,north:35.8,zoom:14,agency:"odpt-tosaden"});
  assert.equal(map.stops.length,2);assert.equal(map.lines.length,1);
  assert.equal((await nearby({mode:"live",lat:35.75,lon:139.54,agency:"odpt-hana"})).stops.length,2);
  const update={id:"u",tripUpdate:{trip:{tripId:"J",routeId:"R",startDate:"20261031"},timestamp:fixed/1000,
    stopTimeUpdate:[{stopId:"S",stopSequence:1,departure:{time:fixed/1000+600}},{stopId:"BAD",stopSequence:2}]}};
  const matched=await matchOdptRealtime([update,{...update,id:"bad",tripUpdate:{...update.tripUpdate,trip:{...update.tripUpdate.trip,routeId:"bad"}}}],"odpt-sendai",fixed);
  assert.equal(matched.length,1);assert.equal(matched[0].tripUpdate.stopTimeUpdate.length,1);
  assert.equal((await matchOdptRealtime([update],"odpt-sendai",fixed,"different-version")).length,0);
  const cancelled={...update,tripUpdate:{...update.tripUpdate,trip:{...update.tripUpdate.trip,scheduleRelationship:3},stopTimeUpdate:[]}};
  assert.equal((await matchOdptRealtime([cancelled],"odpt-sendai",fixed))[0].tripUpdate.trip.scheduleRelationship,3);
  const skipped={...update,tripUpdate:{...update.tripUpdate,stopTimeUpdate:[{stopId:"S",stopSequence:1,scheduleRelationship:1},{stopId:"T",stopSequence:2,scheduleRelationship:2}]}};
  assert.deepEqual((await matchOdptRealtime([skipped],"odpt-sendai",fixed))[0].tripUpdate.stopTimeUpdate.map((s:any)=>s.scheduleRelationship),[1,2]);
  assert.equal((await matchOdptRealtime([{id:"notice",alert:{informedEntity:[{routeId:"R"},{routeId:"unimported"}]}}],"odpt-sendai",fixed))[0].alert.informedEntity.length,1);
  assert.equal((await matchOdptRealtime([{...update,tripUpdate:{...update.tripUpdate,timestamp:fixed/1000-61}}],"odpt-sendai",fixed)).length,0);
  assert(observationFresh(fixed/1000,fixed));assert(!observationFresh(fixed/1000+31,fixed));
  process.env.ODPT_ENABLED="false";
  assert(!(await allStops("live")).some(s=>s.odpt));assert(!(await scheduledArrivals(stop,new Set(),fixed)).length);
  await assert.rejects(odptFetch(edition(hana).url,hana,"static"),/disabled/);
  console.log("ODPT fixtures: license, windows, URL/redirect, bounds, atomic failure, Unicode, Tokyo calendars/clocks, browsing, realtime and disabled-source checks passed.");
}finally{Date.now=realNow;globalThis.fetch=nativeFetch;delete process.env.ODPT_ENABLED;await pool.end();}
