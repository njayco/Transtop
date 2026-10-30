import {test} from "node:test";
import assert from "node:assert/strict";
import {adapters} from "./adapters";
import {GtfsSelection,isExpressRoute} from "./gtfs-selection";
import {officialAlert} from "./official-alert";
import {normalizeCtRealtime} from "./ct-realtime";

test("Connecticut adapters are unique, public, correctly typed and SLE operator-filtered",()=>{
  assert.equal(new Set(adapters.map(a=>a.id)).size,adapters.length);
  const bus=adapters.find(a=>a.id==="cttransit")!;
  assert.equal(bus.type,"bus");assert.equal(bus.realtimeUrls.length,3);
  assert.ok(bus.realtimeUrls.every(u=>u.startsWith("https://cttprdtmgtfs.ctttrpcloud.com/")&&!u.includes("key=")));
  assert.equal(adapters.find(a=>a.id==="ctrail-hartford")!.type,"rail");
  const sle=adapters.find(a=>a.id==="ctrail-sle")!;
  assert.deepEqual(sle.staticAgencyIds,["1230"]);
  assert.equal(sle.routeName,"Shore Line East");assert.deepEqual(sle.realtimeUrls,[]);
});
test("shared national GTFS imports only selected operator dependencies, including parent stops",()=>{
  const s=new GtfsSelection(["1230"]);
  assert.equal(s.accept("agency",{agency_id:"51"}),false);
  assert.ok(s.accept("agency",{agency_id:"1230"}));
  assert.equal(s.accept("routes",{agency_id:"51",route_id:"NATIONAL"}),false);
  assert.ok(s.accept("routes",{agency_id:"1230",route_id:"SLE"}));
  assert.equal(s.accept("trips",{route_id:"NATIONAL",trip_id:"OTHER",service_id:"OTHER"}),false);
  assert.ok(s.accept("trips",{route_id:"SLE",trip_id:"TRAIN",service_id:"DAILY",shape_id:"PATH"}));
  assert.equal(s.accept("calendar",{service_id:"OTHER"}),false);
  assert.ok(s.accept("calendar",{service_id:"DAILY"}));
  assert.ok(s.accept("calendar_dates",{service_id:"DAILY"}));
  assert.equal(s.accept("stop_times",{trip_id:"OTHER",stop_id:"CALIFORNIA"}),false);
  assert.ok(s.accept("stop_times",{trip_id:"TRAIN",stop_id:"PLATFORM"}));
  assert.ok(s.accept("shapes",{shape_id:"PATH"}));
  assert.equal(s.accept("shapes",{shape_id:"OTHER_PATH"}),false);
  const stops=new Map<string,Record<string,string>>([["PLATFORM",{parent_station:"STATION"}],["STATION",{}],["CALIFORNIA",{}]]);
  s.retainStops(stops);assert.deepEqual([...stops.keys()],["PLATFORM","STATION"]);
});
test("unfiltered MTA and regional adapters preserve previous import behavior",()=>{
  const s=new GtfsSelection();
  for(const table of ["agency","routes","trips","calendar","calendar_dates","stop_times","shapes"])assert.ok(s.accept(table,{}));
  const stops=new Map([["original",{}]]);s.retainStops(stops);assert.equal(stops.size,1);
});
test("CT express classes preserve CTfastrak local buses and existing MTA classifications",()=>{
  for(const name of ["904","904/914","950"])assert.ok(isExpressRoute("cttransit",name,""));
  for(const name of ["101","102","24","91"])assert.equal(isExpressRoute("cttransit",name,""),false);
  assert.equal(isExpressRoute("mta-bus","950",""),false);
  for(const name of ["SIM1","QM2","BxM3"])assert.ok(isExpressRoute("mta-bus",name,""));
});
test("Connecticut alerts are scoped to CT routes and keep existing MTA IDs unchanged",()=>{
  const e={id:"notice",alert:{headerText:{translation:[{language:"en",text:"Detour"}]},descriptionText:{translation:[{text:"Use other stop"}]},effect:3,
    informedEntity:[{routeId:"16470"},{routeId:"16470"}]}};
  const a=officialAlert(e,"cttransit");
  assert.equal(a.id,"cttransit-alert:notice");assert.deepEqual(a.routeIds,["cttransit:16470"]);assert.equal(a.severity,"delay");
  assert.equal(officialAlert(e,"mta-bus").id,"mta-bus-alert:notice");
  const rail=officialAlert({...e,alert:{...e.alert,informedEntity:[{agencyId:"MNR",routeId:"1"}]}});
  assert.equal(rail.id,"mta-alert:notice");assert.deepEqual(rail.routeIds,["mta-mnr:1"]);
});
test("CT optional control-encoded headsigns cannot break JSONB snapshots or valid trip updates",()=>{
  const entities=[{tripUpdate:{trip:{tripId:"1952561",routeId:"16470"},
    tripProperties:{tripShortName:"\n\u0000CT",shapeId:"valid-shape"},stopTimeUpdate:[
    {stopId:"1994",arrival:{time:1793391000},stopTimeProperties:{stopHeadsign:"\n\u0006\n\u0000\u0012\u0002en"}},
    {stopId:"2285",arrival:{time:1793391100},stopTimeProperties:{stopHeadsign:"Hartford"}},
  ]}}];
  normalizeCtRealtime(entities);
  assert.ok(!JSON.stringify(entities).includes("\\u0000"));
  assert.deepEqual(entities[0].tripUpdate.trip,{tripId:"1952561",routeId:"16470"});
  assert.equal(entities[0].tripUpdate.tripProperties.shapeId,"valid-shape");
  assert.equal(entities[0].tripUpdate.stopTimeUpdate[0].arrival.time,1793391000);
  assert.equal(entities[0].tripUpdate.stopTimeUpdate[1].stopTimeProperties.stopHeadsign,"Hartford");
});
