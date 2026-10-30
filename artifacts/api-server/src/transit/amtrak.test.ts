import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAmtraker,matchAmtrakTrain,observationFresh,trainPosition,AMTRAK_FRESH_MS,type PublishedTrain } from "./amtrak-model";
import { amtrakArrivalsFor,amtrakDates } from "./amtrak-service";
import { serviceInstant } from "./time";
import { GtfsSelection } from "./gtfs-selection";
import { GetTrainResponse,GetMapVehiclesResponse,GetTimetableResponse } from "@workspace/api-zod";
import type { TransitStop } from "./types";

const now=Date.parse("2026-10-31T14:00:00Z");
function raw(){
  return {provider:"Amtrak",trainNum:"5",routeName:"California Zephyr",destName:"Emeryville",lastValTS:new Date(now).toISOString(),
    trainID:"5-31",trainState:"Active",lat:40.3,lon:-105.1,stations:[
      {code:"CHI",name:"Chicago",tz:"America/Chicago",status:"Departed",schDep:"2026-10-31T08:00:00-05:00",schArr:"2026-10-31T08:00:00-05:00",arr:"2026-10-31T08:00:00-05:00",dep:"2026-10-31T08:00:00-05:00"},
      {code:"DEN",name:"Denver",tz:"America/Denver",status:"Enroute",schArr:"2026-10-31T09:15:00-06:00",schDep:"2026-10-31T09:30:00-06:00",arr:"2026-10-31T09:20:00-06:00",dep:"2026-10-31T09:40:00-06:00"},
      {code:"EMY",name:"Emeryville",tz:"America/Los_Angeles",status:"Enroute",schArr:"2026-11-01T08:00:00-08:00",schDep:"2026-11-01T08:00:00-08:00"},
    ]};
}
const calendar={start_date:"20260101",end_date:"20271231",monday:"1",tuesday:"1",wednesday:"1",thursday:"1",friday:"1",saturday:"1",sunday:"1"};
function published():PublishedTrain {
  return {id:"amtrak:5",trip:{trip_short_name:"5",agency_timezone:"America/New_York",direction_id:"0",trip_headsign:"Emeryville"},
    route:{id:"amtrak:96",name:"California Zephyr"},calendar,exceptions:[],
    calls:[{code:"CHI",arrival:9*3600,departure:9*3600},{code:"DEN",arrival:11.25*3600,departure:11.5*3600},{code:"EMY",arrival:36*3600,departure:36*3600}]};
}
const stop={id:"amtrak:DEN",rawId:"DEN",stop_timezone:"America/Denver",updatedAt:new Date(now).toISOString()} as TransitStop;
function train(){return normalizeAmtraker({"5":[raw()]})[0];}
function matched(){return matchAmtrakTrain(train(),[published()]);}

test("Amtraker preserves coordinates and actual source observation time, never fetch/update time",()=>{
  const t=train();assert.equal(t.lat,40.3);assert.equal(t.lon,-105.1);assert.equal(Date.parse(t.updatedAt!),now);
  const r={...raw(),lastValTS:"",updatedAt:new Date(now).toISOString()};
  const unknown=normalizeAmtraker({"5":[r]})[0];assert.equal(unknown.updatedAt,null);assert.equal(trainPosition(unknown,now),undefined);
});
test("separates scheduled, estimated and actual times according to station state",()=>{
  const t=train();assert.ok(t.calls[0].actualDeparture);assert.equal(t.calls[0].estimatedDeparture,null);
  assert.equal(t.calls[1].actualArrival,null);assert.equal(t.calls[1].estimatedDeparture,"2026-10-31T15:40:00.000Z");
});
test("unknown timezones stay unknown and station metadata handles Arizona rather than guessing Mountain DST",()=>{
  const r=raw();r.stations[1].tz="Q";
  assert.equal(normalizeAmtraker({"5":[r]})[0].calls[1].timezone,null);
  assert.equal(normalizeAmtraker({"5":[r]},{DEN:{tz:"America/Phoenix"}})[0].calls[1].timezone,"America/Phoenix");
});
test("malformed/null trains and station calls are isolated; different providers excluded",()=>{
  const r=raw();(r.stations as any[]).push(null);
  assert.equal(normalizeAmtraker({"5":[null,r,{...raw(),provider:"Via"}]}).length,1);
  assert.throws(()=>normalizeAmtraker(null),/dictionary/);assert.throws(()=>normalizeAmtraker({error:"changed"}),/format/);
});
test("invalid coordinates never turn into a position",()=>{
  assert.equal(trainPosition({...train(),lat:null},now),undefined);
  assert.equal(normalizeAmtraker({"5":[{...raw(),lon:300} ]})[0].lon,null);
});
test("source expiry and future clock thresholds are explicit",()=>{
  const t=train();
  for(const age of [-30_001,-30_000,0,AMTRAK_FRESH_MS,AMTRAK_FRESH_MS+1]){
    assert.equal(observationFresh(t,now+age),age>=-30_000&&age<=AMTRAK_FRESH_MS);
  }
  assert.equal(observationFresh(t,now+AMTRAK_FRESH_MS+1),false);
});
test("predeparture, completed, canceled and all-departed trains have no moving marker",()=>{
  for(const state of ["Predeparture","Completed","Canceled","Unknown"])assert.equal(trainPosition({...train(),state},now),undefined);
  assert.equal(trainPosition({...train(),calls:train().calls.map(c=>({...c,status:"Departed"}))},now),undefined);
});
test("dated identity includes full origin instant, not repeating provider day-of-month ID",()=>{
  const r=raw();r.stations[0].schDep="2026-11-30T08:00:00-06:00";
  assert.notEqual(normalizeAmtraker({"5":[r]})[0].id,train().id);
  assert.equal(train().serviceDate,"20261031");
});
test("matching requires unique service date, number, route and ordered scheduled calls",()=>{
  assert.equal(matched().matched,true);
  assert.equal(matchAmtrakTrain(train(),[published(),{...published(),id:"amtrak:other"}]).matched,false);
  assert.equal(matchAmtrakTrain({...train(),routeName:"Other"},[published()]).matched,false);
  assert.equal(matchAmtrakTrain({...train(),trainNumber:"55"},[published()]).matched,false);
  assert.equal(matchAmtrakTrain({...train(),calls:[...train().calls].reverse()},[published()]).matched,false);
  assert.equal(matchAmtrakTrain(train(),[{...published(),exceptions:[{date:"20261031",exception_type:"2"}]}]).matched,false);
});
test("one live prediction replaces exactly one dated schedule; unmatched observations do not",()=>{
  const at=Date.parse("2026-10-31T14:00:00Z");
  const scheduled=amtrakArrivalsFor(stop,[published()],[],at);assert.equal(scheduled.length,1);assert.equal(scheduled[0].source,"scheduled");
  const live=amtrakArrivalsFor(stop,[published()],[matched()],at);assert.equal(live.length,1);assert.equal(live[0].source,"live");
  assert.equal(live[0].scheduledAt,"2026-10-31T15:40:00.000Z");
  assert.equal(amtrakArrivalsFor(stop,[published()],[train()],at)[0].source,"scheduled");
});
test("stale, unavailable and ambiguous observations retain scheduled fallback",()=>{
  assert.equal(amtrakArrivalsFor(stop,[published()],[{...matched(),updatedAt:new Date(now-300001).toISOString()}],now)[0].source,"scheduled");
  assert.equal(amtrakArrivalsFor(stop,[published()],[matched(),matched()],now)[0].source,"scheduled");
});
test("explicit cancellation, skipped stop, actual departure and no-pickup stops suppress departures",()=>{
  assert.equal(amtrakArrivalsFor(stop,[published()],[{...matched(),state:"Canceled"}],now).length,0);
  for(const changes of [{status:"Skipped"},{actualDeparture:new Date(now).toISOString()}]){
    const t=matched();t.calls[1]={...t.calls[1],...changes};
    assert.equal(amtrakArrivalsFor(stop,[published()],[t],now).length,0);
  }
  const p=published();p.calls[1].pickup="1";
  assert.equal(amtrakArrivalsFor(stop,[p],[],now).length,0);
  assert.equal(amtrakArrivalsFor({...stop,rawId:"EMY"},[published()],[],Date.parse("2026-11-01T15:00:00Z")).length,0);
});
test("inactive dates never produce departures and old dates are not shifted",()=>{
  assert.equal(amtrakArrivalsFor(stop,[{...published(),exceptions:[{date:"20261031",exception_type:"2"}]}],[],now).length,0);
  assert.equal(amtrakArrivalsFor(stop,[{...published(),calendar:{...calendar,end_date:"20251031"}}],[],now).length,0);
});
test("national service-day lookback derives from elapsed schedule range and includes long runs",()=>{
  assert.ok(amtrakDates(now,126*3600).includes("20261025"));
  assert.equal(new Date(serviceInstant("20261031",73*3600)).toISOString(),"2026-11-03T05:00:00.000Z");
});
test("GTFS noon-minus-twelve handles DST and agency zone, not the stop's local zone",()=>{
  assert.equal(new Date(serviceInstant("20261101",0,"America/New_York")).toISOString(),"2026-11-01T05:00:00.000Z");
  assert.equal(new Date(serviceInstant("20260308",0,"America/New_York")).toISOString(),"2026-03-08T04:00:00.000Z");
  assert.equal(new Date(serviceInstant("20261031",3600,"America/New_York")).toLocaleString("en-US",{timeZone:"America/Los_Angeles"}),"10/30/2026, 10:00:00 PM");
});
test("agency 51 rail import excludes buses and other agencies; SLE isolation is preserved",()=>{
  const selection=new GtfsSelection(["51"],["2"]);
  assert.equal(selection.accept("routes",{agency_id:"51",route_id:"bus",route_type:"3"}),false);
  for(const agency_id of ["1230","157","1228"])assert.equal(selection.accept("routes",{agency_id,route_id:agency_id,route_type:"2"}),false);
  assert.equal(selection.accept("routes",{agency_id:"51",route_id:"rail",route_type:"2"}),true);
  assert.equal(selection.accept("trips",{route_id:"bus",trip_id:"bus"}),false);
  const sle=new GtfsSelection(["1230"]);assert.equal(sle.accept("routes",{agency_id:"51",route_id:"national"}),false);
});
test("generated API contracts retain train details, timestamps and unresolved optional route IDs",()=>{
  assert.equal(GetTrainResponse.parse(train()).calls.length,3);
  assert.equal(GetMapVehiclesResponse.parse([trainPosition(train(),now)])[0].trainNumber,"5");
  assert.equal(GetTimetableResponse.parse({date:"2026-10-31",offset:0,limit:40,total:0,departures:[],message:"No service"}).total,0);
});
