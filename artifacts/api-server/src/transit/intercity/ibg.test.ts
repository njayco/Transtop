import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { buildIbg, ibgProvider, nearbyIbg, referenceTimetable, serviceOn, type IbgData } from "./ibg-model";
import { decodeIbg } from "./ibg-store";
import { IBG_COMMIT, IBG_SHA, IBG_LOCATION_WARNING } from "./ibg-verification";
import { db, pool } from "@workspace/db";
import { primaryIbgCatalog, ibgRouteDetail, ibgTimetable } from "./ibg-browse";
import { intercityCatalog, intercityDepartures, intercityProviders } from "./service";
import { nearby, stopDetail, routeDetail, sources } from "../service";
import { invalidateNetwork, network } from "../network";
import { catalog as publicCatalog, timetable } from "../catalog";
import { intercityRoute, intercityTimetable } from "./service";
import { providerInventory } from "./providers";
import { GetCatalogQueryParams, GetTimetableQueryParams } from "@workspace/api-zod";

test("changed or malformed archives fail checksum validation before publication",async()=>{
  await assert.rejects(decodeIbg(Buffer.from("not the pinned archive"),""),/checksum mismatch/);
});

function fixture():IbgData{
  return {version:"test",sha256:"test",importedAt:"2026-10-30T12:00:00Z",
    agencies:[{agency_id:"1",agency_name:"Peter Pan Bus Lines"},{agency_id:"2",agency_name:"Other Carrier"}],
    routes:[{route_id:"r1",agency_id:"1",route_short_name:"NYC",route_long_name:"NYC–Boston",route_color:"123456"},
      {route_id:"r2",agency_id:"2",route_short_name:"B",route_color:"bad"}],
    stops:[{stop_id:"s1",stop_name:"New York",stop_lat:"40.756",stop_lon:"-73.990"},{stop_id:"s2",stop_name:"Boston",stop_lat:"42.35",stop_lon:"-71.05"}],
    calendars:[{service_id:"daily",start_date:"20200101",end_date:"20350815",monday:"1",tuesday:"1",wednesday:"1",thursday:"1",friday:"1",saturday:"1",sunday:"1"}],
    exceptions:[],sources:[{agency_name:"Peter Pan Bus Lines",source_date:"8/15/2025",data_source:"TDS"}],
    trips:[{id:"t1",routeId:"r1",serviceId:"daily",headsign:"Boston",direction:"0",points:[
      {stopId:"s1",sequence:1,arrival:"23:30:00",departure:"23:30:00",pickup:"0"},
      {stopId:"s2",sequence:2,arrival:"25:00:00",departure:"25:00:00",pickup:"1"}]},
      {id:"t2",routeId:"r2",serviceId:"daily",headsign:"Other",direction:"0",points:[
        {stopId:"s1",sequence:1,arrival:"09:00:00",departure:"09:00:00",pickup:"0"}]}]};
}
test("IBG brand aliases share providers while agencies and stop identities remain isolated",()=>{
  assert.equal(ibgProvider({agency_name:"Peter Pan (BZ)",agency_id:"71"}),"peter-pan");
  assert.equal(ibgProvider({agency_name:"FlixBus-us",agency_id:"70"}),"greyhound");
  const c=buildIbg(fixture());
  assert.equal(c.stops.filter(s=>s.rawId==="s1").length,2);
  assert.equal(new Set(c.stops.map(s=>s.id)).size,c.stops.length);
  assert.ok(c.stops.every(s=>s.arrivals.length===0&&s.name.includes("IBG reference")&&s.alerts[0].description.includes("not verified current")));
  assert.ok(c.routes.every(r=>r.referenceDate!<="2026-01-04"));
  assert.deepEqual([...nearbyIbg(c.stops,40.756,-73.990)].sort(),["ibg-2","peter-pan"]);
  assert.equal(nearbyIbg(c.stops,0,0).size,0);
});
test("calendars respect both add/remove exceptions and never turn far-future dates into current predictions",()=>{
  const d=fixture();d.exceptions=[{service_id:"daily",date:"20250815",exception_type:"2"},{service_id:"special",date:"20250815",exception_type:"1"}];
  assert.equal(serviceOn(d,"daily","2025-08-15"),false);
  assert.equal(serviceOn(d,"special","2025-08-15"),true);
  assert.equal(serviceOn(d,"special","2025-08-16"),false);
  assert.equal(serviceOn(d,"daily","2026-10-30"),true);
  const r=referenceTimetable(d,buildIbg(d),{routeId:"ibg:peter-pan:route:r1",date:"2026-10-30"});
  assert.equal(r.total,0);
  assert.match(r.message,/Current departures are withheld/);
});
test("historical timetables filter operator, route, direction, pickup, time and pagination",()=>{
  const d=fixture(),c=buildIbg(d),routeId="ibg:peter-pan:route:r1";
  const p={routeId,date:"2025-08-15",from:"22:00"};
  const r=referenceTimetable(d,c,p);
  assert.equal(r.total,1);assert.equal(r.departures[0].time,"2025-08-16T03:30:00.000Z");
  assert.match(r.message,/not current travel information/);
  assert.equal(referenceTimetable(d,c,{...p,direction:"wrong"}).total,0);
  assert.equal(referenceTimetable(d,c,{...p,stopId:"ibg:ibg-2:stop:s1"}).total,0);
  assert.equal(referenceTimetable(d,c,{...p,stopId:"ibg:peter-pan:stop:s2"}).total,0);
  assert.equal(referenceTimetable(d,c,{...p,from:"23:59"}).total,0);
  assert.equal(referenceTimetable(d,c,{...p,offset:1}).departures.length,0);
  assert.equal(referenceTimetable(d,c,{...p,date:"2025-02-30"}).total,0);
});
test("extended GTFS clocks keep their service day; nonexistent and ambiguous DST times are withheld",()=>{
  const d=fixture();const point=d.trips[0].points[0];const routeId="ibg:peter-pan:route:r1";
  point.departure="25:30:00";
  assert.equal(referenceTimetable(d,buildIbg(d),{routeId,date:"2025-08-15"}).departures[0].time,"2025-08-16T05:30:00.000Z");
  point.departure="02:30:00";
  assert.equal(referenceTimetable(d,buildIbg(d),{routeId,date:"2025-03-09"}).total,0);
  point.departure="01:30:00";
  assert.equal(referenceTimetable(d,buildIbg(d),{routeId,date:"2025-11-02"}).total,0);
});

function contradictoryFixture():IbgData {
  const d=fixture();
  d.version=IBG_COMMIT;d.sha256=IBG_SHA;
  d.stops.push(
    {stop_id:"1#2382",stop_name:"State College Regional Airport",stop_lat:"40.734062",stop_lon:"-74.165535"},
    {stop_id:"2382",stop_name:"State College Regional Airport",stop_lat:"40.85141",stop_lon:"-77.8528"},
    {stop_id:"newark-valid",stop_name:"State College Regional Airport",stop_lat:"40.7341",stop_lon:"-74.1656"},
  );
  const add=(id:string,routeId:string,stopId:string)=>d.trips.push({id,routeId,serviceId:"daily",headsign:"Archive destination",direction:"0",
    points:[{stopId,sequence:1,arrival:"09:00:00",departure:"09:00:00",pickup:"0"}]});
  add("bad","r1","1#2382");add("good","r1","2382");add("unrelated","r2","newark-valid");
  // A shared raw record is still scoped separately for each serving provider.
  add("bad-other","r2","1#2382");
  d.routes.push({route_id:"only-bad",agency_id:"1",route_short_name:"Withheld boarding location"});
  add("only-bad","only-bad","1#2382");
  for(const [agency_id,agency_name] of [["3","Martz Bus"],["4","Trans-Bridge Lines, Inc."]]){
    d.agencies.push({agency_id,agency_name});d.routes.push({route_id:`r${agency_id}`,agency_id,route_short_name:agency_name});
    add(`preferred-${agency_id}`,`r${agency_id}`,"s1");
  }
  return d;
}

test("source-record quarantine preserves archival provenance without relocating or name-wide suppression",()=>{
  const d=contradictoryFixture(),before=JSON.stringify(d),c=buildIbg(d);
  assert.equal(JSON.stringify(d),before);
  assert.equal(c.quarantinedStops.size,2);
  assert.ok(!c.stops.some(s=>s.rawId==="1#2382"));
  const archived=c.archivalStopMap.get("ibg:peter-pan:stop:1#2382")!;
  assert.equal(archived.lat,40.734062);assert.equal(archived.lon,-74.165535);
  assert.equal(c.rawStopMap.get("1#2382"),d.stops.find(s=>s.stop_id==="1#2382"));
  assert.ok(c.quarantinedStops.get(archived.id)!.reason.includes("Newark"));
  assert.ok(c.quarantinedStops.get(archived.id)!.evidence.includes("intercity-gtfs-audit"));
  assert.equal(c.coverageWarning,IBG_LOCATION_WARNING);
  assert.ok(c.routes.find(r=>r.id==="ibg:peter-pan:route:r1")!.scheduleNotes!.includes(IBG_LOCATION_WARNING));
  assert.ok(!c.routes.find(r=>r.id==="ibg:martz:route:r3")!.scheduleNotes!.includes(IBG_LOCATION_WARNING));
  assert.deepEqual([...nearbyIbg(c.stops,40.734062,-74.165535)],["ibg-2"]);
  assert.deepEqual([...nearbyIbg(c.stops,40.85141,-77.8528)],["peter-pan"]);
  assert.equal(c.stopMap.get("ibg:peter-pan:stop:2382")!.lon,-77.8528);
  const p={date:"2025-08-15",routeId:"ibg:peter-pan:route:r1"};
  assert.equal(referenceTimetable(d,c,{...p,stopId:archived.id}).total,0);
  assert.equal(referenceTimetable(d,c,{...p,stopId:"ibg:peter-pan:stop:2382"}).total,1);
  assert.ok(!referenceTimetable(d,c,p).departures.some(s=>s.stopId===archived.id));
  assert.equal(referenceTimetable(d,c,{...p,date:"2026-10-30"}).total,0);
});

test("quarantine decisions do not leak to a different archive or become verified after reimport",()=>{
  const d=contradictoryFixture();
  d.importedAt="2027-01-01T00:00:00Z";
  assert.equal(buildIbg(d).quarantinedStops.size,2);
  d.version="unrelated-source";
  assert.equal(buildIbg(d).quarantinedStops.size,0);
  d.version=IBG_COMMIT;d.sha256="different-checksum";
  assert.equal(buildIbg(d).quarantinedStops.size,0);
});

test("offline archive browsing retains quarantine while public browsing excludes all research records",async()=>{
  const d=contradictoryFixture();
  // Exercise actual public entry points, with no database writes or downloads.
  const query=mock.method(pool,"query",(async(sql:string)=>({
    rows:sql.includes("id='ibg:dataset'")?[{data:d}]:[],
  })) as any);
  const select=mock.method(db,"select",(()=>({from:()=>({where:async()=>[]})})) as any);
  const download=mock.method(globalThis,"fetch",async()=>{throw new Error("External network disabled in archive test");});
  const bad="ibg:peter-pan:stop:1#2382",good="ibg:peter-pan:stop:2382",valid="ibg:ibg-2:stop:newark-valid";
  try {
    const primary=await primaryIbgCatalog(),catalog=await intercityCatalog();
    assert.ok(!primary.stops.some(s=>s.rawId==="1#2382"));
    assert.ok(!primary.routes.some(r=>r.agencyId==="martz"||r.agencyId==="transbridge"));
    assert.ok(!catalog.stops.some(s=>s.id===good));
    for(const agency of [undefined,"peter-pan","ibg-2","ibg"]){
      const result=await nearby({mode:"live",type:"intercity",lat:40.734062,lon:-74.165535,agency});
      assert.ok(!result.stops.some(s=>s.rawId==="1#2382"));
      assert.doesNotMatch(result.message,/IBG|research|quarantined/i);
    }
    const local=await nearby({mode:"live",type:"intercity",lat:40.734062,lon:-74.165535});
    assert.ok(!local.stops.some(s=>s.id===valid));
    const pennsylvania=await nearby({mode:"live",type:"intercity",lat:40.85141,lon:-77.8528,agency:"peter-pan"});
    assert.ok(!pennsylvania.stops.some(s=>s.id===good));
    const name=await nearby({mode:"live",type:"intercity",q:"State College Regional Airport",agency:"peter-pan"});
    assert.deepEqual(name.stops.map(s=>s.id),[]);
    assert.equal(await stopDetail(bad,"live"),undefined);
    for(const provider of [undefined,"peter-pan","ibg-2"]){
      const result=await intercityDepartures({lat:40.734062,lon:-74.165535,date:"2026-10-30",provider});
      assert.ok(!result.providers.some(p=>p.id==="peter-pan"));
      assert.ok(!result.providers.some(p=>p.id==="ibg-2"));
      assert.doesNotMatch(result.message,/IBG|research|quarantined/i);
      assert.ok(!result.departures.some(s=>s.stopId===bad));
    }
    invalidateNetwork();
    for(const filters of [{},{agency:"ibg"},{agency:"peter-pan"},{agency:"ibg-2"},{routeId:"ibg:peter-pan:route:r1"},{agency:"peter-pan",routeId:"ibg:peter-pan:route:r1",zoom:8}]){
      const result=await network({mode:"live",type:"intercity",lat:40.734062,lon:-74.165535,zoom:14,...filters});
      assert.ok(!result.stops.some(s=>s.id.endsWith(":stop:1#2382")));
      assert.doesNotMatch(result.message,/IBG|research|quarantined/i);
    }
    const paNetwork=await network({mode:"live",type:"intercity",lat:40.85141,lon:-77.8528,zoom:14,agency:"peter-pan"});
    assert.ok(!paNetwork.stops.some(s=>s.id===good));
    const otherNetwork=await network({mode:"live",type:"intercity",lat:40.734062,lon:-74.165535,zoom:14,agency:"ibg-2"});
    assert.ok(!otherNetwork.stops.some(s=>s.id===valid));
    const preferred=await network({mode:"live",type:"intercity",lat:40.756,lon:-73.990,zoom:14});
    assert.ok(!preferred.stops.some(s=>s.id.startsWith("ibg:martz:")||s.id.startsWith("ibg:transbridge:")));
    const detail=await ibgRouteDetail("ibg:peter-pan:route:r1");
    assert.ok(!detail!.stops.some(s=>s.id===bad));
    assert.ok(!detail!.timetableStops!.some(s=>s.id===bad));
    assert.ok(detail!.timetableStops!.some(s=>s.id===good));
    assert.ok(detail!.alerts.some(a=>a.description.includes("quarantined")));
    const onlyBad=await ibgRouteDetail("ibg:peter-pan:route:only-bad");
    assert.equal(onlyBad!.stops.length,0);
    assert.equal(onlyBad!.timetableStops!.length,0);
    assert.ok(onlyBad!.alerts.some(a=>a.description.includes("quarantined")));
    const withheld=await ibgTimetable({date:"2025-08-15",stopId:bad});
    assert.equal(withheld.total,0);assert.match(withheld.message,/quarantined/);
    const providers=await intercityProviders();
    assert.doesNotMatch(providers.find(p=>p.id==="peter-pan")!.description,/IBG|research|quarantined/i);
    assert.ok(!providers.find(p=>p.id==="martz")!.description.includes("quarantined"));
  } finally {
    query.mock.restore();select.mock.restore();download.mock.restore();invalidateNetwork();
  }
});

test("public entry points ignore a retained snapshot and reject every mixed historical identity before dispatch",async()=>{
  const d=contradictoryFixture(),before=JSON.stringify(d),queries:string[]=[];
  const query=mock.method(pool,"query",(async(sql:string)=>{
    queries.push(sql);
    return {rows:sql.includes("id='ibg:dataset'")?[{data:d}]:[]};
  }) as any);
  const select=mock.method(db,"select",(()=>({from:()=>({where:async()=>[]})})) as any);
  const download=mock.method(globalThis,"fetch",async()=>{throw new Error("External network disabled in removal test");});
  const stopId="ibg:peter-pan:stop:s1",routeId="ibg:peter-pan:route:r1";
  const clean=(result:unknown)=>assert.doesNotMatch(JSON.stringify(result),/ibg:|IBG|research reference|historical timetable|quarantined/i);
  try{
    clean(await intercityCatalog());
    const providers=await intercityProviders();
    assert.deepEqual(providers.map(p=>p.id),providerInventory.map(p=>p.id));
    clean(providers);clean(await sources());
    for(const mode of ["live","demo"] as const){
      assert.equal(await stopDetail(stopId,mode),undefined);
      assert.equal(await routeDetail(routeId,mode),undefined);
      for(const selection of [
        {stopId},{routeId},{stopId,routeId},
        {stopId,routeId:"transbridge:test"},{stopId:"transbridge:test",routeId},
        {stopId,routeId:"martz:test"},{stopId:"martz:NY",routeId},
        {stopId,routeId:"nj-transit:890"},{stopId:"nj-transit:test",routeId},
        {stopId,routeId:"amtrak:test"},{stopId:"amtrak:NYP",routeId},
        {stopId,routeId:"tl:invalid"},{stopId:"tl:invalid",routeId},
        {stopId,routeId:"tfl:line:central"},{stopId:"tfl:stop:940GZZLUOXC",routeId},
      ]){
        const result=await timetable(GetTimetableQueryParams.parse({...selection,mode,date:"2025-08-15",offset:2,limit:5}));
        assert.deepEqual(result.departures,[]);assert.equal(result.total,0);
        assert.equal(result.offset,2);assert.equal(result.limit,5);clean(result);
        assert.equal((await intercityTimetable({...selection,date:"2025-08-15"})).total,0);
      }
    }
    assert.equal(await intercityRoute(routeId),undefined);
    for(const agency of ["ibg","peter-pan","ibg-2","transbridge","nj-transit"]){
      clean(await publicCatalog(GetCatalogQueryParams.parse({mode:"live",agency})));
      clean(await nearby({mode:"live",agency,type:"intercity",lat:40.756,lon:-73.990}));
    }
    clean(await publicCatalog(GetCatalogQueryParams.parse({mode:"live"})));
    for(const provider of [undefined,"peter-pan","ibg-2","transbridge"]){
      clean(await intercityDepartures({lat:40.756,lon:-73.990,date:"2026-10-30",provider}));
    }
    invalidateNetwork();
    for(const filters of [{},{agency:"ibg"},{agency:"peter-pan"},{routeId}]){
      clean(await network({mode:"live",lat:40.756,lon:-73.990,zoom:14,...filters}));
    }
    const imported=await intercityCatalog();
    assert.ok(imported.routes.some(r=>r.id.startsWith("transbridge:")));
    assert.ok(imported.routes.some(r=>r.id.startsWith("nj-transit:")));
    const retained=await timetable(GetTimetableQueryParams.parse({mode:"live",routeId:imported.routes.find(r=>r.id.startsWith("nj-transit:"))!.id,date:"2026-10-30"}));
    assert.ok(retained.total>0);
    assert.ok(!queries.some(sql=>sql.includes("ibg:dataset")),"public paths must not even read the retained archive");
    assert.equal(JSON.stringify(d),before);
  }finally{
    query.mock.restore();select.mock.restore();download.mock.restore();invalidateNetwork();
  }
});
