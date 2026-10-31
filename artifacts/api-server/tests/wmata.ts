import assert from "node:assert/strict";
import { test } from "node:test";
import GtfsRealtime from "gtfs-realtime-bindings";
import { createClient, dailyLimit, sourceUrl, operationFor, WmataError, type Budget } from "../src/transit/wmata/client";
import { current, matchTrip, normalizePredictions, normalizeAlerts, applies, routeType, locationInfo, boarding, type StaticCatalog } from "../src/transit/wmata/model";
import { predictionArrivals, vehicleObservations, type Feed } from "../src/transit/wmata/realtime";
import { normalizeVehicles, busViewport } from "../src/transit/wmata/vehicles";
import { verifiedFeed, boardingDuplicate } from "../src/transit/wmata/crosswalk";
import { serviceInstant, activeService, gtfsSeconds } from "../src/transit/time";
import type { TransitRoute,TransitStop } from "../src/transit/types";
import { DateTime } from "luxon";
import { validateArchive } from "../src/transit/wmata/archive";
import { Readable } from "node:stream";

const now=Date.parse("2026-10-30T16:00:00Z"),timestamp=now/1000;
test("archive rejects unsafe names, duplicates, excessive entry count and declared expansion",async()=>{
  const entry=(path:string,uncompressedSize=1)=>({path,uncompressedSize,stream:()=>Readable.from([Buffer.from("fixture")])});
  const check=(files:ReturnType<typeof entry>[])=>validateArchive({files} as Parameters<typeof validateArchive>[0]);
  assert.throws(()=>check([entry("../stops.txt")]),/bounds/);
  assert.throws(()=>check([entry("stops.txt"),entry("stops.txt")]),/duplicate/);
  assert.throws(()=>check(Array.from({length:101},(_,i)=>entry(`${i}.txt`))),/entry limit/);
  assert.throws(()=>check([entry("stop_times.txt",401*1024*1024)]),/bounds/);
  assert.throws(()=>check(["stops.txt","stop_times.txt","trips.txt"].map(p=>entry(p,300*1024*1024))),/bounds/);
  const files=[entry("stops.txt")];check(files);
  let text="";for await(const chunk of files[0].stream())text+=chunk;
  assert.equal(text,"fixture");
});
const rail:TransitRoute={id:"wmata:RED",name:"Red Line",longName:"Red",agency:"WMATA",agencyId:"wmata",type:"subway",color:"#C80F2D"};
const bus:TransitRoute={...rail,id:"wmata:C51",name:"C51",type:"bus",color:"#0091C8"};
const stop=(rawId:string,route:TransitRoute,parent?:string):TransitStop=>({
  id:`wmata:${rawId}`,rawId,name:parent?"Metro Center, Red Line Track 1 Platform":"Test boarding stop",type:route.type,agency:"WMATA",routes:[route],
  lat:38.8983,lon:-77.0281,parent,arrivals:[],alerts:[],accessible:false,distance:0,walkingMinutes:0,updatedAt:new Date(now).toISOString(),
  wmata:locationInfo({stop_id:rawId,location_type:parent?"0":"",parent_station:parent||"",stop_desc:parent?"Red Line to Glenmont":""})});
const platform=stop("PF_A01_1",rail,"STN_A01_C01"),busStop=stop("7219",bus);
const parent={...platform,id:"wmata:STN_A01_C01",rawId:"STN_A01_C01",parent:"",name:"Metro Center",wmata:locationInfo({location_type:"1"})};
const calendar={service_id:"friday",monday:"0",tuesday:"0",wednesday:"0",thursday:"0",friday:"1",saturday:"0",sunday:"0",start_date:"20260101",end_date:"20271231"};
const catalog:StaticCatalog={routes:[rail,bus],stops:[platform,busStop,parent],trips:[
  {id:"wmata:11842073_20757",data:{trip_id:"11842073_20757",scheduled_trip_id:"11842073",route_id:"RED",direction_id:"0",service_id:"friday",trip_headsign:"Glenmont"},
    calendar,exceptions:[],calls:[{stop_id:"PF_A01_1",stop_sequence:"1",departure_time:"12:02:00"}]},
  {id:"wmata:34947100",data:{trip_id:"34947100",route_id:"C51",direction_id:"0",service_id:"friday",trip_headsign:"Takoma"},
    calendar,exceptions:[],calls:[{stop_id:"7219",stop_sequence:"1",departure_time:"12:02:00"}]},
]};
const update=(rail=true)=>({id:rail?"rail-run":"bus-run",tripUpdate:{
  trip:{tripId:rail?"11842073_20755":"34947100",routeId:rail?"RED":"C51",directionId:0,startDate:"20261030",startTime:"12:02:00",scheduleRelationship:0},
  timestamp,stopTimeUpdate:[{stopId:rail?"PF_A01_1":"7219",stopSequence:1,arrival:{time:timestamp+120},scheduleRelationship:0}]}});
const feed=(entities:any[],overrides:Partial<Feed>={}):Feed=>({timestamp,fetchedAt:now,entities,state:"fresh",nextPoll:now+30000,...overrides});

const gps=()=>({id:"feed-local-id",vehicle:{vehicle:{id:"4727"},trip:{tripId:"34947100",routeId:"C51",directionId:0},
  timestamp:timestamp-5,position:{latitude:38.9,longitude:-77.03}}});
test("GPS polling is regional, including tight views between stops with no route geometry",()=>{
  const c={...catalog,stops:[{...busStop,lat:38,lon:-78},{...busStop,lat:40,lon:-76},platform]};
  assert.equal(busViewport({west:-77.1,east:-77,south:38.9,north:39},c),true);
  assert.equal(busViewport({west:-75,east:-74,south:38.9,north:39},c),false);
  assert.equal(busViewport({west:175,east:-175,south:38.9,north:39},c),false);
  assert.equal(busViewport(undefined,c),false);
  assert.equal(busViewport({west:-78,east:-76,south:38,north:40},{...c,stops:[]}),false);
});
test("Metrobus GPS retains physical identity, exact static route and older source expiry through protobuf",()=>{
  const raw=gps();
  const decoded=GtfsRealtime.transit_realtime.FeedMessage.decode(GtfsRealtime.transit_realtime.FeedMessage.encode({
    header:{gtfsRealtimeVersion:"1.0",timestamp},entity:[raw]}).finish());
  const rows=normalizeVehicles(decoded.entity,catalog,timestamp,now);
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,"wmata:vehicle:4727");
  assert.equal(rows[0].routeId,bus.id);assert.equal(rows[0].destination,"Takoma");
  assert.equal(rows[0].source,"official WMATA Metrobus GPS");
  assert.equal(rows[0].expiresAt,new Date(now+55000).toISOString());
  const renamed={...raw,id:"different-entity"};
  assert.equal(normalizeVehicles([renamed],catalog,timestamp,now)[0].id,rows[0].id);
  assert.equal(normalizeVehicles([raw],catalog,timestamp-15,now)[0].updatedAt,new Date(now-15000).toISOString());
});
test("Metrobus missing/stale/future GPS, mismatched identities and deleted observations cannot create markers",()=>{
  const raw=gps();
  const variants=[
    {...raw,vehicle:{...raw.vehicle,timestamp:timestamp-61}},
    {...raw,vehicle:{...raw.vehicle,timestamp:timestamp+31}},
    {...raw,vehicle:{...raw.vehicle,timestamp:undefined}},
    {...raw,vehicle:{...raw.vehicle,position:undefined}},
    {...raw,vehicle:{...raw.vehicle,position:{latitude:100,longitude:-77}}},
    {...raw,vehicle:{...raw.vehicle,position:{latitude:38}}},
    {...raw,vehicle:{...raw.vehicle,vehicle:{id:""}}},
    {...raw,vehicle:{...raw.vehicle,trip:{...raw.vehicle.trip,routeId:"RED"}}},
    {...raw,vehicle:{...raw.vehicle,trip:{...raw.vehicle.trip,routeId:"unknown"}}},
    {...raw,vehicle:{...raw.vehicle,trip:{...raw.vehicle.trip,tripId:"unpublished"}}},
    {...raw,vehicle:{...raw.vehicle,trip:{...raw.vehicle.trip,directionId:1}}},
    {...raw,isDeleted:true},update(false),update(true),
  ];
  for(const variant of variants)assert.deepEqual(normalizeVehicles([variant],catalog,timestamp,now),[]);
  for(const header of [timestamp-61,timestamp+31,0,NaN])
    assert.deepEqual(normalizeVehicles([raw],catalog,header,now),[]);
  assert.deepEqual(normalizeVehicles([raw,{...raw,id:"duplicate-entity"}],catalog,timestamp,now),[]);
});
test("persisted GPS is rechecked after restart; failed, empty and expired caches remove markers",()=>{
  const rows=normalizeVehicles([gps()],catalog,timestamp,now);
  const cached=JSON.parse(JSON.stringify(feed([],{vehicles:rows})));
  assert.equal(vehicleObservations(cached,now).length,1);
  assert.deepEqual(vehicleObservations(cached,now+55001),[]);
  assert.deepEqual(vehicleObservations({...cached,error:"access denied"},now),[]);
  assert.deepEqual(vehicleObservations({...cached,timestamp:timestamp-61},now),[]);
  assert.deepEqual(vehicleObservations(feed([]),now),[]);
  assert.deepEqual(vehicleObservations(undefined,now),[]);
});
test("vehicle-product denial backs off persistently and cannot spend requests on retries",async()=>{
  let requests=0,blocked:string|undefined;
  const client=createClient({key:()=>"fixture-only-key",enabled:()=>true,limit:()=>500,now:()=>now,
    budget:{reserve:async()=>true,status:async()=>blocked,block:async(op,until,state)=>{
      assert.equal(op,"bus-vehicles");assert.equal(until,now+3600000);blocked=state;
    }},fetch:async(url)=>{requests++;assert.equal(url,sourceUrl("bus-vehicles"));return new Response(null,{status:403});}});
  for(let i=0;i<2;i++)await assert.rejects(client.download("bus-vehicles"),e=>e instanceof WmataError&&e.state==="access denied");
  assert.equal(requests,1);
});

test("combined modes, station/platform/entrance identity and names remain distinct",()=>{
  assert.equal(routeType("1"),"subway");assert.equal(routeType("3"),"bus");assert.equal(routeType("4"),undefined);
  assert.equal(locationInfo({location_type:"2",parent_station:"STN"}).kind,"entrance");
  assert.equal(locationInfo({location_type:"0",parent_station:"STN"}).kind,"platform");
  assert.equal(boarding({...platform,location_type:"2"} as TransitStop),false);
  assert.notEqual(parent.id,platform.id);assert.equal(platform.wmata?.parentId,parent.id);
});
test("revision crosswalk requires supplied scheduled ID, route, active date, start and every call",()=>{
  const u=update().tripUpdate;
  assert.equal(matchTrip(u,catalog)?.id,catalog.trips[0].id);
  for(const change of [{routeId:"BLUE"},{startDate:"20261031"},{startTime:"12:03:00"},{directionId:1},{tripId:"999_20755"}])
    assert.equal(matchTrip({...u,trip:{...u.trip,...change}},catalog),undefined);
  assert.equal(matchTrip({...u,stopTimeUpdate:[{...u.stopTimeUpdate[0],stopId:"PF_A01_2"}]},catalog),undefined);
  assert.equal(matchTrip(u,{...catalog,trips:[catalog.trips[0],{...catalog.trips[0],id:"wmata:ambiguous"}]}),undefined);
});
test("fresh bus/rail predictions use exact platforms and supplied headsigns; no invented directions or GPS",()=>{
  for(const isRail of [true,false]){
    const entities=normalizePredictions([update(isRail)],catalog,isRail?"subway":"bus",timestamp,now);
    const result=predictionArrivals(isRail?platform:busStop,[feed(entities)],now);
    assert.equal(result.arrivals.length,1);assert.equal(result.arrivals[0].source,"live");
    assert.equal(result.arrivals[0].destination,isRail?"Glenmont":"Takoma");
    assert.equal(result.arrivals[0].minutes,2);assert.equal(result.arrivals[0].timezone,"America/New_York");
    assert.equal(result.arrivals[0].expiresAt,new Date(now+60000).toISOString());
    assert.equal((result.arrivals[0] as any).lat,undefined);
  }
  assert.equal(predictionArrivals(busStop,[feed(normalizePredictions([update()],catalog,"subway",timestamp,now))],now).arrivals.length,0);
  const unresolved=update();unresolved.tripUpdate.trip.tripId="123_999";
  const result=predictionArrivals(platform,[feed(normalizePredictions([unresolved],catalog,"subway",timestamp,now))],now);
  assert.equal(result.arrivals[0].destination,"Destination not supplied");assert.equal(result.arrivals[0].tripId,undefined);
  assert(result.unmatchedRoutes.has("wmata:RED"));
});
test("stale, future, failed, empty and nonnumeric arrivals never become live clocks",()=>{
  const entities=normalizePredictions([update()],catalog,"subway",timestamp,now);
  for(const bad of [feed(entities,{timestamp:timestamp-61}),feed(entities,{timestamp:timestamp+31}),feed(entities,{error:"access denied"}),feed([])])
    assert.equal(predictionArrivals(platform,[bad],now).arrivals.length,0);
  for(const value of ["ARR","BRD","---",0,NaN]){
    const u:any=update();u.tripUpdate.stopTimeUpdate[0].arrival.time=value;
    assert.equal(predictionArrivals(platform,[feed(normalizePredictions([u],catalog,"subway",timestamp,now))],now).arrivals.length,0);
  }
  const old=update();old.tripUpdate.timestamp=timestamp-61;
  assert.equal(normalizePredictions([old],catalog,"subway",timestamp,now).length,0);
  assert.equal(current(timestamp+31,now),false);
});
test("cancellations and skips suppress only verified dated calls; NO_DATA has no live estimate",()=>{
  const canceled:any=update();canceled.tripUpdate.trip.scheduleRelationship=3;canceled.tripUpdate.stopTimeUpdate=[];
  const c=predictionArrivals(platform,[feed(normalizePredictions([canceled],catalog,"subway",timestamp,now))],now);
  assert(c.excluded.has(`${catalog.trips[0].id}|date:20261030`));
  for(const rel of [1,2]){
    const skipped:any=update();skipped.tripUpdate.stopTimeUpdate[0].scheduleRelationship=rel;
    const s=predictionArrivals(platform,[feed(normalizePredictions([skipped],catalog,"subway",timestamp,now))],now);
    assert.equal(s.arrivals.length,0);assert.equal(s.excluded.size,rel===1?1:0);
  }
});
test("alert scopes, sanitization, active periods and independent freshness",()=>{
  const alert=(id:string,scope:any[],periods:any[]=[])=>({id,alert:{informedEntity:scope,activePeriod:periods,
    headerText:{translation:[{language:"en",text:"<b>Notice</b>"}]},descriptionText:{translation:[{text:"Check service"}]}}});
  const rows=normalizeAlerts([alert("system",[]),alert("route",[{routeId:"RED"}]),alert("platform",[{stopId:"PF_A01_1"}]),
    alert("expired",[],[{end:timestamp-1}]),alert("future",[],[{start:timestamp+10}])],catalog,"subway",timestamp,now);
  assert.equal(rows.length,3);assert.equal(rows[0].title,"Notice");assert.equal(rows[0].systemwide,true);
  assert.equal(rows[0].routeIds.length,0);assert.equal(applies(rows[0],busStop),false);
  assert.equal(applies(rows[0],platform),true);assert.equal(applies(rows[2],platform),true);
  assert.equal(applies(rows[2],{...platform,id:"wmata:other",parent:""}),false);
  assert.equal(normalizeAlerts([alert("x",[])],catalog,"subway",timestamp-181,now).length,0);
  const unknown=normalizeAlerts([alert("unknown",[{routeId:"RED",stopId:"unknown"}])],catalog,"subway",timestamp,now)[0];
  assert.equal(applies(unknown,platform),false);assert.equal(unknown.routeIds.length,0);
  const union=normalizeAlerts([alert("union",[{routeId:"RED",stopId:"PF_A01_1"},{stopId:"STN_A01_C01"}])],catalog,"subway",timestamp,now)[0];
  assert.equal(applies(union,parent),true);assert.equal(applies(union,platform),true);
});
test("global precedence requires official resource plus exact stop, parent, route and coordinates",()=>{
  assert(verifiedFeed({urls:{static_current:sourceUrl("static")}}));
  assert.equal(verifiedFeed({urls:{static_current:"https://example.test/wmata.zip"}}),false);
  const raw={stop_id:platform.rawId,parent_station:platform.parent,geometry:{coordinates:[platform.lon,platform.lat]}};
  const route={route_id:"RED",agency:{agency_id:"1"},route_type:1};
  assert(boardingDuplicate(raw,route,[platform]));assert.equal(boardingDuplicate({...raw,stop_id:"same-name"},route,[platform]),false);
  assert.equal(boardingDuplicate({...raw,parent_station:"other"},route,[platform]),false);
});
test("overnight clocks and DST use GTFS elapsed service time with calendar exceptions",()=>{
  assert.equal(DateTime.fromMillis(serviceInstant("20261030",gtfsSeconds("25:10:00")),{zone:"America/New_York"}).toFormat("yyyy-MM-dd HH:mm"),"2026-10-31 01:10");
  assert.equal(serviceInstant("20261101",86400)-serviceInstant("20261101",0),86400000);
  assert.equal(serviceInstant("20260308",86400)-serviceInstant("20260308",0),86400000);
  assert.equal(activeService(calendar,[{date:"20261030",exception_type:"2"}],"20261030"),false);
  assert.equal(activeService(undefined,[{date:"20261031",exception_type:"1"}],"20261031"),true);
});

test("secure client allowlist, no redirects, coalescing, credential and quota gates",async()=>{
  let calls=0,reservations=0;const blocks:string[]=[];
  const budget:Budget={reserve:async()=>{reservations++;return true;},block:async(op)=>{blocks.push(op);}};
  const make=(overrides:Partial<Parameters<typeof createClient>[0]>={})=>createClient({key:()=>"fixture-only-key",enabled:()=>true,limit:()=>500,now:()=>now,
    budget,sleep:async()=>{},fetch:async(url,options)=>{calls++;assert.equal(String(url),sourceUrl("bus-predictions"));assert.equal(options?.redirect,"error");
      assert.equal((options?.headers as any).api_key,"fixture-only-key");return new Response(new Uint8Array([1,2]));},...overrides});
  const client=make();await Promise.all([client.download("bus-predictions"),client.download("bus-predictions")]);
  assert.equal(calls,1);assert.equal(reservations,1);
  await assert.rejects(make({key:()=>undefined}).download("bus-predictions"),/WMATA_API_KEY/);
  await assert.rejects(make({enabled:()=>false}).download("bus-predictions"),/disabled/);
  await assert.rejects(make({limit:()=>0}).download("bus-predictions"),/allowance/);
  await assert.rejects(client.download("https://evil.test" as any),/Unsupported/);
  assert.equal(operationFor(sourceUrl("rail-alerts")),"rail-alerts");assert.equal(operationFor(sourceUrl("rail-alerts")+"?api_key=secret"),undefined);
  assert.equal(dailyLimit({WMATA_VERIFIED_DAILY_LIMIT:"50000",NODE_ENV:"development"} as any),500);
  assert.equal(dailyLimit({WMATA_VERIFIED_DAILY_LIMIT:"50000",NODE_ENV:"production"} as any),4500);
  assert.equal(dailyLimit({WMATA_VERIFIED_DAILY_LIMIT:"unknown"} as any),0);
  for(const status of [401,403,429,503]){
    await assert.rejects(make({fetch:async()=>new Response(null,{status})}).download("bus-predictions"),e=>e instanceof WmataError&&!e.message.includes("fixture-only-key"));
  }
  assert(blocks.includes("all"));
  for(const state of ["access denied","throttled"]){
    await assert.rejects(make({budget:{...budget,status:async()=>state},
      fetch:async()=>{throw new Error("Backoff must not call upstream");}}).download("bus-predictions"),
      e=>e instanceof WmataError&&e.state===state);
  }
  await assert.rejects(make({fetch:async()=>new Response("fixture-only-key")}).download("bus-predictions"),/validation failed/);
  await assert.rejects(make({fetch:async()=>new Response("not a ZIP")}).download("static"),/validation failed/);
  const empty=GtfsRealtime.transit_realtime.FeedMessage.decode(GtfsRealtime.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:"2.0",timestamp},entity:[]}).finish());
  assert.equal(empty.entity.length,0);assert.equal(Number(empty.header.timestamp),timestamp);
});
