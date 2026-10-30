import {test} from "node:test";
import assert from "node:assert/strict";
import {applyVehicleRoutes} from "./vehicle-trips";
test("commuter routes use exact scoped trip matches, leaving source route IDs and unknown trips unchanged",()=>{
  const entities=[{vehicle:{trip:{tripId:"1248",routeId:""},position:{latitude:41,longitude:-73},timestamp:100}},
    {vehicle:{trip:{tripId:"unknown",routeId:""}}},{vehicle:{trip:{tripId:"1248",routeId:"publisher-route"}}},
    {tripUpdate:{trip:{tripId:"1248",routeId:""}}}];
  applyVehicleRoutes(entities,"mta-mnr",[{id:"mta-mnr:1248",data:{route_id:"1"}},{id:"mta-lirr:1248",data:{route_id:"wrong"}}]);
  assert.equal(entities[0].vehicle!.trip.routeId,"1");assert.equal(entities[0].vehicle!.timestamp,100);
  assert.equal(entities[1].vehicle!.trip.routeId,"");assert.equal(entities[2].vehicle!.trip.routeId,"publisher-route");
  assert.equal(entities[3].tripUpdate!.trip.routeId,"1");
});
