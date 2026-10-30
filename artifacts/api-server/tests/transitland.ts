import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { classify, licensed, identity, parseIdentity, normalizeRoute, normalizeStop, directDuplicate, coordinates, geometryParts } from "../src/transit/transitland/model";
import { normalizeDeparture, eligibleDate, freshTimestamp } from "../src/transit/transitland/departures";
import { cursorState, nextCursor, request, enabled,allocatedLimit } from "../src/transit/transitland/client";
import { pool } from "@workspace/db";
import { normalizeVehicle } from "../src/transit/transitland/vehicles";
import { splitBounds, contains, validBounds, intersects } from "../src/transit/map-geometry";
import { serviceInstant } from "../src/transit/time";

const info={feedId:"f-test",fetchedAt:new Date().toISOString(),license:"CC-BY-4.0",attribution:"Test agency",url:"https://www.transit.land/terms",timezone:"Asia/Tokyo"};
for(const limit of [0,1,99,1000,9999])assert.equal(allocatedLimit(limit,false)+allocatedLimit(limit,true),limit);
assert.equal(allocatedLimit(9999,false),999);assert.equal(allocatedLimit(9999,true),9000);
const raw={route_id:"a:/日本",route_short_name:"2",route_type:1,route_color:"EF3434",agency:{agency_id:"a",agency_name:"Test"}};
const route=normalizeRoute(raw,info)!;
const stop=normalizeStop({stop_id:"s:1",stop_name:"Platform 1",geometry:{type:"Point",coordinates:[139,35]},wheelchair_boarding:0},[route],info)!;
assert.deepEqual(parseIdentity(identity("f-unicode","日本:a/b")),["f-unicode","日本:a/b"]);
assert.throws(()=>parseIdentity("tl:not-valid-json"));
assert.equal(classify(1)?.type,"subway");
assert.equal(classify(109)?.detail,"Commuter rail");
assert.equal(classify(702)?.type,"bus");
assert.equal(classify(201)?.type,"intercity");
assert.equal(classify(208)?.type,"bus");
assert.equal(classify(3)?.type,"bus"); // Never turn all buses into intercity.
assert.equal(classify(4),undefined); // Ferry remains out of scope.
assert.equal(licensed({license:{spdx_identifier:"CC-BY-4.0"}}),true);
assert.equal(licensed({license:{commercial_use_allowed:"",redistribution_allowed:"yes",create_derived_product:"yes"}}),false);
assert.equal(licensed({license:{spdx_identifier:"CC-BY-4.0",commercial_use_allowed:"no"}}),false);
assert.equal(stop.accessible,false);assert.equal(stop.transitland?.accessibility,"Wheelchair boarding unknown");
assert.equal(stop.transitland?.timezone,"Asia/Tokyo");
assert.equal(normalizeStop({stop_id:"bad",stop_name:"Bad",geometry:{coordinates:[400,0]}},[route],info),undefined);
assert.deepEqual(coordinates({type:"LineString",coordinates:[[0,0],[999,2]]}),[]);
assert.deepEqual(geometryParts({type:"MultiLineString",coordinates:[[[0,0],[1,0]],[[10,0],[11,0]]]}),[[[0,0],[1,0]],[[10,0],[11,0]]]); // No invented connector.
const local={...route,id:"mta-subway:2",agency:"MTA New York City Transit"};
assert.equal(directDuplicate({...route,agency:local.agency},[local]),true);
assert.equal(directDuplicate({...route,agency:"Different agency"},[local]),false);
assert.equal(directDuplicate({...route,agency:"NJ Transit",name:"300"},[{...local,id:"nj-transit:890",agency:"NJ Transit",name:"890"}]),false);
const date="2026-10-30",now=Date.parse("2026-10-30T01:00:00Z");
const d={service_date:date,departure_time:"10:05:00",stop_sequence:1,pickup_type:0,trip:{trip_id:"t",direction_id:0,trip_headsign:"東京",route:raw,timestamp:now/1000},
  departure:{scheduled_utc:"2026-10-30T01:05:00",estimated_utc:"2026-10-30T01:06:00"},schedule_relationship:"SCHEDULED"};
assert.equal(eligibleDate({...d,service_date:"2025-10-30"},date),false);
assert.equal(eligibleDate({...d,pickup_type:1},date),false);
assert.equal(eligibleDate({...d,interpolated:1},date),false);
assert.equal(eligibleDate({...d,schedule_relationship:"CANCELED"},date),false);
assert.equal(eligibleDate({...d,schedule_relationship:"NO_DATA"},date),false);
assert.equal(normalizeDeparture(d,stop,date,"Asia/Tokyo",now)?.arrival.source,"live");
assert.equal(normalizeDeparture({...d,trip:{...d.trip,timestamp:(now-61000)/1000}},stop,date,"Asia/Tokyo",now)?.arrival.source,"scheduled");
assert.equal(normalizeDeparture(d,stop,date,"Asia/Tokyo",now)?.time,"2026-10-30T01:05:00.000Z");
assert.equal(freshTimestamp((now+31000)/1000,now),undefined);
assert.equal(new Date(serviceInstant("20261030",25.5*3600,"Asia/Tokyo")).toISOString(),"2026-10-30T16:30:00.000Z");
assert.equal(new Date(serviceInstant("20260308",3*3600,"America/New_York")).toISOString(),"2026-03-08T07:00:00.000Z");
assert.equal(DateTime.fromMillis(serviceInstant("20261030",25*3600,"Australia/Sydney")).setZone("Australia/Sydney").toFormat("yyyy-MM-dd HH:mm"),"2026-10-31 01:00");
const cursor=nextCursor({meta:{hasNext:true,after:123}},{meta:{hasNext:true,after:456}});
assert.deepEqual(cursorState(cursor),{s:"123",r:"456"});
assert.throws(()=>cursorState(Buffer.from("https://attacker.example").toString("base64url")));
const b={west:179,east:-179,south:-20,north:20};
assert.equal(validBounds(b),true);assert.equal(splitBounds(b).length,2);assert.equal(contains(b,179.5,0),true);assert.equal(contains(b,-179.5,0),true);assert.equal(contains(b,0,0),false);
assert.equal(intersects([[179.1,0],[179.9,0]],b),true);
const rr=new Map([[raw.route_id,route]]);
const v={id:"vehicle",vehicle:{timestamp:now/1000,trip:{routeId:raw.route_id},position:{latitude:35,longitude:139}}};
assert.ok(normalizeVehicle(v,info.feedId,rr,now));
assert.equal(normalizeVehicle({...v,vehicle:{...v.vehicle,timestamp:undefined}},info.feedId,rr,now),undefined);
assert.equal(normalizeVehicle({...v,vehicle:{...v.vehicle,position:undefined}},info.feedId,rr,now),undefined); // Station-only is not GPS.
assert.equal(normalizeVehicle({...v,vehicle:{...v.vehicle,trip:{routeId:"unknown"}}},info.feedId,rr,now),undefined);
console.log("Transitland fixture checks passed: identity, licensing, modes, precedence, dates/DST, expiry, pagination, bounds and real GPS only.");

// Test the production transport with an isolated fake database and fetch. No real
// upstream request or usage counter is touched. In unconfigured CI, the pure
// normalization suite above still runs; configure a test process to exercise transport.
if(enabled()){
  const originalFetch=globalThis.fetch,originalQuery=pool.query,originalNow=Date.now;
  const cache=new Map<string,any>();let calls=0,reserved=0,clock=originalNow();
  Date.now=()=>clock;
  (pool as any).query=async(sql:string,p:any[])=>{
    if(sql.includes("jsonb_build_object")){
      if(reserved+p[1]>p[2])return {rows:[]};
      reserved+=p[1];return {rows:[{data:{used:reserved}}]};
    }
    if(sql.startsWith("SELECT data"))return {rows:cache.has(p[0])?[{data:cache.get(p[0])}]:[]};
    if(sql.includes("VALUES('live',$1,'transitland',$2)"))cache.set(p[0],p[1]);
    return {rows:[]};
  };
  globalThis.fetch=async(input:any)=>{
    calls++;const q=new URL(String(input)).searchParams.get("search");
    if(q==="denied")return new Response("private upstream error",{status:401});
    if(q==="rate")return new Response("rate limit",{status:429});
    if(q==="failure")throw new Error("private upstream network details");
    return new Response(JSON.stringify({stops:[],meta:{after:42,next:"https://untrusted.example/?apikey=do-not-retain"}}),{status:200});
  };
  try{
    const both=await Promise.all([request("stops",{search:"cache"},10000),request("stops",{search:"cache"},10000)]);
    assert.equal(calls,1);assert.equal(reserved,1);
    assert.equal(both[0].meta.next,undefined);assert.equal(both[0].meta.hasNext,true);
    assert.equal(JSON.stringify([...cache.values()]).includes("do-not-retain"),false);
    await request("stops",{search:"cache"},10000);assert.equal(calls,1);
    clock+=11000;await request("stops",{search:"cache"},10000);assert.equal(calls,2);
    await assert.rejects(request("stops",{search:"denied"}),/access denied/);
    const deniedCalls=calls;await assert.rejects(request("stops",{search:"denied"}),/access denied/);assert.equal(calls,deniedCalls);
    await request("stops",{search:"other-resource"}); // A resource denial doesn't disable all feeds.
    await assert.rejects(request("stops",{search:"rate"}),/rate\/quota/);
    const rateCalls=calls;await assert.rejects(request("stops",{search:"blocked"}),/rate\/quota/);assert.equal(calls,rateCalls);
    clock+=61000;await assert.rejects(request("stops",{search:"failure"}),/connection failed/);
    clock+=31000;reserved=9999;
    const before=calls;await assert.rejects(request("stops",{search:"budget"}),/Monthly Transitland request limit/);assert.equal(calls,before);
    await assert.rejects(request("feeds/../../external"),/Unsupported/);
    console.log("Transitland transport fixtures passed: cache, singleflight, credential stripping, 401 isolation, 429 backoff, network failure and hard budget.");
  }finally{globalThis.fetch=originalFetch;(pool as any).query=originalQuery;Date.now=originalNow;}
}
