import assert from "node:assert/strict";
import { test, mock, after } from "node:test";

const agency="mobility-mdb-test";
const now=Date.parse("2026-11-01T05:00:00Z");
let changed=false;
const queries:string[]=[];
const snapshot={stopTimesMode:"import-test",mobility:{datasetId:"d"}};
const pool={async query(sql:string){
  queries.push(sql);
  if(sql.includes("data->>'stopTimesMode'"))return {rows:[{generation:changed?"import-new":"import-test"}]};
  if(sql.includes("SELECT data FROM transit_feed_snapshots"))return {rows:[{data:snapshot}]};
  if(sql.includes("FROM transit_trips"))return {rows:[{id:`${agency}:T1`,data:{route_id:"R1",service_id:"S1",trip_headsign:"City"},calendar:{start_date:"20260101",end_date:"20261231",sunday:"1"}}]};
  if(sql.includes("FROM transit_stop_times"))return {rows:[{trip_id:`${agency}:T1`,data:{stop_id:"B1",stop_sequence:"1",pickup_type:"0"}}]};
  if(sql.includes("FROM transit_calendar_exceptions"))return {rows:[]};
  if(sql.includes("FROM transit_routes"))return {rows:[{id:`${agency}:R1`}]};
  throw new Error("Unexpected SQL");
}};
mock.module("@workspace/db",{exports:{pool}});
mock.module(new URL("../src/transit/mobility/registry.ts",import.meta.url).href,{exports:{
  recordFor:(id:string)=>id===agency?{timezone:"Australia/Sydney",datasetId:"d"}:undefined
}});
after(()=>mock.restoreAll());
const {matchRealtime}=await import("../src/transit/mobility/realtime");
const trip={tripId:"T1",routeId:"R1",startDate:"20261101",scheduleRelationship:0};
const update={id:"tu",tripUpdate:{timestamp:now/1000,trip,stopTimeUpdate:[{stopId:"B1",stopSequence:1,arrival:{time:now/1000+120}}]}};
const vehicle={id:"vp",vehicle:{timestamp:now/1000,trip,position:{latitude:-35.2,longitude:149.1},stopId:"B1"}};
test("exact active identities retain absolute predictions and observed GPS",async()=>{
  const result=await matchRealtime([update,vehicle],agency,now);
  assert.equal(result.length,2);
  assert.equal(result[0].tripUpdate.transtopHeadsign,"City");
  assert.equal(result[1].vehicle.position.latitude,-35.2);
});
test("stale, undated, unknown, inconsistent and deleted entities never become live",async()=>{
  for(const patch of [
    {timestamp:now/1000-61},{timestamp:now/1000+31},
    {trip:{...trip,tripId:"unknown"}},{trip:{...trip,routeId:"other"}},
    {trip:{...trip,startDate:""}},{trip:{...trip,startDate:"20300101"}},
  ])assert.equal((await matchRealtime([{...update,tripUpdate:{...update.tripUpdate,...patch}}],agency,now)).length,0);
  assert.equal((await matchRealtime([{...vehicle,isDeleted:true}],agency,now)).length,0);
  assert.equal((await matchRealtime([vehicle],"mobility-unknown",now)).length,0);
  const mismatched=await matchRealtime([{...update,tripUpdate:{...update.tripUpdate,stopTimeUpdate:[{stopId:"wrong",stopSequence:1}]}}],agency,now);
  assert.equal(mismatched[0].tripUpdate.stopTimeUpdate.length,0);
});
test("version changes withhold an entire response rather than mixing generations",async()=>{
  changed=true;assert.deepEqual(await matchRealtime([update,vehicle],agency,now),[]);changed=false;
});
test("only exact imported route selectors qualify for fresh-feed alerts",async()=>{
  const result=await matchRealtime([{id:"a",alert:{headerText:{translation:[{text:"Service notice"}]},
    informedEntity:[{routeId:"R1"},{routeId:"unknown"}]}}],agency,now);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].alert.informedEntity,[{routeId:"R1"}]);
  assert.deepEqual(await matchRealtime([{id:"a",alert:{informedEntity:[{stopId:"unverified"}]}}],agency,now),[]);
});
