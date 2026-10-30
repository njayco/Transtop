import {test} from "node:test";
import assert from "node:assert/strict";
import {catalogVehicles,trackedVehicleId} from "./vehicle-catalog";
import type {TransitStop,TransitRoute} from "./types";
const route={id:"mta-subway:2",name:"2",color:"#EE352E"} as TransitRoute;
const stop={id:"mta-subway:127",lat:40.75,lon:-73.99,name:"Times Sq",routes:[route]} as TransitStop;
const report={id:"mta-subway:train-1",routeId:route.id,stopId:"mta-subway:127N",currentStatus:2,source:"MTA Subway",updatedAt:"2026-10-30T21:00:00Z",agencyId:"mta-subway"};
test("physical vehicle and trip identities stay stable across feed entity renumbering without cross-feed collisions",()=>{
  const a={id:"000001",vehicle:{trip:{tripId:"run-2",routeId:"2"}}};
  const b={id:"000001",vehicle:{trip:{tripId:"run-A",routeId:"A"}}};
  assert.notEqual(trackedVehicleId("mta-subway",a),trackedVehicleId("mta-subway",b));
  assert.equal(trackedVehicleId("mta-subway",a),trackedVehicleId("mta-subway",{...a,id:"000999"}));
  assert.equal(trackedVehicleId("mta-bus",{...a,vehicle:{vehicle:{id:"bus-5"},trip:{tripId:"next-trip"}}}),"mta-bus:bus-5");
});
test("subway station reports resolve platforms, retain route 2 and explicitly deny GPS accuracy",()=>{
  const [v]=catalogVehicles([],[report],[stop]);
  assert.equal(v.routeName,"2");assert.equal(v.lat,stop.lat);assert.equal(v.lon,stop.lon);
  assert.match(v.source,/next station report \(not GPS\)/);
  assert.equal(v.updatedAt,report.updatedAt);
});
test("unresolved stations/routes never invent a vehicle location",()=>{
  assert.deepEqual(catalogVehicles([],[{...report,stopId:"mta-subway:unknown"}],[stop]),[]);
  assert.deepEqual(catalogVehicles([],[{...report,routeId:"mta-subway:unknown"}],[stop]),[]);
});
test("observed GPS wins over a duplicate station report and preserves timestamp",()=>{
  const gps={id:report.id,lat:40.753,lon:-73.981,source:"official live vehicle",routeId:route.id,updatedAt:report.updatedAt};
  const [v]=catalogVehicles([gps],[report],[stop]);assert.equal(v.lat,gps.lat);assert.equal(v.source,gps.source);
  assert.equal(v.agencyId,"mta-subway");assert.equal(v.routeName,"2");assert.equal(v.updatedAt,gps.updatedAt);
});
test("unscoped bus routes match only a unique agency route, never another operator",()=>{
  const bus={...route,id:"mta-bus:m~MTA NYCT_M104",name:"M104"};
  const station={...stop,id:"mta-bus:m~123",routes:[bus]};
  const gps={id:"mta-bus:bus-5",lat:40.75,lon:-73.99,routeId:"mta-bus:MTA NYCT_M104",source:"official",updatedAt:report.updatedAt};
  assert.equal(catalogVehicles([gps],[],[station])[0].routeId,bus.id);
  const duplicate={...station,id:"another",routes:[{...bus,id:"mta-bus:other~M104"}]};
  assert.equal(catalogVehicles([gps],[],[station,duplicate])[0].routeId,gps.routeId);
});
