import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIbg, ibgProvider, nearbyIbg, referenceTimetable, serviceOn, type IbgData } from "./ibg-model";
import { decodeIbg } from "./ibg-store";

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
