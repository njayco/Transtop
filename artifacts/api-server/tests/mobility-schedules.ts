import assert from "node:assert/strict";
import { test, mock, after } from "node:test";

const prefix="mobility-mdb-test",now=Date.parse("2026-11-01T05:00:00Z");
let selectedIds:string[]=[];
mock.module("@workspace/db",{exports:{pool:{async query(sql:string,params:any[]){
  if(sql.includes("parent_station"))return {rows:[{id:`${prefix}:platform`,data:{name:"Platform 1"}}]};
  if(sql.includes("FROM transit_stop_times")){
    selectedIds=params[0];
    return {rows:[{arrival_seconds:57900,trip_id:`${prefix}:T1`,
      timing:{stop_id:"platform",departure_time:"16:05:00",pickup_type:"0"},
      trip:{route_id:"R1",service_id:"S1",trip_headsign:"City"},
      calendar:{start_date:"20260101",end_date:"20261231",sunday:"1"}}]};
  }
  if(sql.includes("FROM transit_calendar_exceptions"))return {rows:[]};
  throw new Error("Unexpected SQL");
}}}});
after(()=>mock.restoreAll());
const {scheduledArrivals}=await import("../src/transit/schedules");
const route={id:`${prefix}:R1`,name:"1",color:"#123456",type:"rail" as const,agency:"Test"};
const stop:any={id:`${prefix}:station`,rawId:"station",parent:"",routes:[route],type:"rail",updatedAt:new Date(now).toISOString(),
  mobility:{feedId:"mdb-test",timezone:"Australia/Sydney"}};
test("station arrivals aggregate supplied platforms in the source timezone",async()=>{
  const arrivals=await scheduledArrivals(stop,new Set(),now);
  assert.deepEqual(selectedIds,[`${prefix}:station`,`${prefix}:platform`]);
  assert.equal(arrivals.length,1);assert.equal(arrivals[0].minutes,5);
  assert.equal(arrivals[0].timezone,"Australia/Sydney");
  assert.equal(arrivals[0].destination,"City");assert.equal(arrivals[0].source,"scheduled");
});
test("dated cancellations do not suppress another service date",async()=>{
  assert.equal((await scheduledArrivals(stop,new Set([`${prefix}:T1|date:20261101`]),now)).length,0);
  assert.equal((await scheduledArrivals(stop,new Set([`${prefix}:T1|date:20261031`]),now)).length,1);
});
