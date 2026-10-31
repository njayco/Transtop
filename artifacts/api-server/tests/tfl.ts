import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { createClient, allowedPath, TflError, REQUEST_SPACING, type Store, type CacheEntry } from "../src/transit/tfl/client";
import { line, normalizeStop, prediction, rawStop, rawLine, suppliedShapes, notices, findStopRecord,boardingPoints } from "../src/transit/tfl/model";
import { boundedArea } from "../src/transit/tfl/service";
import { preferDirect, matchedRoutes, resultRouteAliases } from "../src/transit/tfl/crosswalk";
import { directDuplicate } from "../src/transit/transitland/model";
import { routeDetail } from "../src/transit/service";
import { identity } from "../src/transit/transitland/model";

const now=Date.parse("2026-10-30T12:00:00Z");
assert.equal(Math.ceil(60000/REQUEST_SPACING),17);
assert.ok(2*Math.ceil(60000/REQUEST_SPACING)<50); // Separate dev + production DBs stay below public baseline.
const r=line({id:"mildmay",name:"Mildmay",modeName:"overground"})!;
const bus=line({id:"139",name:"139",modeName:"bus"})!;
assert.equal(r.type,"rail");assert.equal(r.name,"Mildmay");assert.equal(bus.type,"bus");
assert.equal(line({id:"national-rail",name:"NR",modeName:"national-rail"}),undefined);
assert.equal(line({id:"thames-river-services",name:"Boat",modeName:"river-bus"}),undefined);
const boarding={id:"490013767X",naptanId:"490013767X",commonName:"Northumberland Avenue / Trafalgar Square",lat:51.50764,lon:-.12954,
  lines:[{id:"139"}],stopType:"NaptanPublicBusCoachTram"};
const cluster={id:"490G000804",naptanId:"490G000804",stopType:"NaptanOnstreetBusCoachStopCluster",lat:51.507,lon:-.13,
  children:[{...boarding,id:"490013767Y",naptanId:"490013767Y"},boarding]};
assert.equal(findStopRecord(cluster,"490013767X"),boarding);
assert.equal(findStopRecord(cluster,"490013767Z"),undefined); // Never the centroid or similarly named sibling.
assert.equal(normalizeStop(findStopRecord(cluster,"490013767X"),[bus])?.id,"tfl:stop:490013767X");
assert.deepEqual(boardingPoints(cluster).map(s=>s.id),["490013767Y","490013767X"]);
assert.equal(boardingPoints({id:"940GZZLUOXC",stopType:"NaptanMetroStation",children:[boarding]})[0].id,"940GZZLUOXC");
assert.throws(()=>rawStop("tfl:stop:../bad"));assert.throws(()=>rawLine("tfl:line:bad?app_key=test"));
assert.equal(rawStop("tfl:stop:910GTEST"),"910GTEST");
const s=normalizeStop({id:"910GTEST",name:"Test station",lat:51.5,lon:-.1,lines:[{id:"mildmay"}]},[r],now)!;
assert.equal(normalizeStop({id:"910GTEST",name:"Bad",lat:200,lon:0,lines:[{id:"mildmay"}]},[r]),undefined);
const p={id:"1",naptanId:"910GTEST",lineId:"mildmay",destinationName:"Richmond",direction:"inbound",platformName:"Platform 2",
  timestamp:new Date(now-5000).toISOString(),expectedArrival:new Date(now+300000).toISOString(),timeToLive:new Date(now+300000).toISOString()};
const a=prediction(p,s,now)!;
assert.equal(a.source,"live");assert.equal(a.timezone,"Europe/London");assert.equal(a.platform,"Platform 2");
assert.equal(a.expiresAt,new Date(now+85000).toISOString());
assert.notEqual(a.id,prediction({...p,platformName:"Platform 1"},s,now)?.id);
assert.notEqual(a.id,prediction({...p,direction:"outbound"},s,now)?.id);
for(const bad of [{timestamp:new Date(now-91000).toISOString()},{timestamp:new Date(now+31000).toISOString()},
  {timestamp:"2026-10-30T12:00:00"},{timestamp:"not a date"},{timeToLive:new Date(now-1).toISOString()},
  {expectedArrival:new Date(now-1).toISOString()},{naptanId:"910GOTHER"},{lineId:"uncovered"},{destinationName:""},{operationType:2}]){
  assert.equal(prediction({...p,...bad},s,now),undefined);
}
assert.equal(DateTime.fromISO("2026-03-29T00:59:00Z").setZone("Europe/London").toFormat("HH:mm ZZZZ"),"00:59 GMT");
assert.equal(DateTime.fromISO("2026-03-29T01:01:00Z").setZone("Europe/London").toFormat("HH:mm ZZZZ"),"02:01 GMT+1");
assert.equal(DateTime.fromISO("2026-10-25T01:01:00Z").setZone("Europe/London").offset,0);
assert.equal(DateTime.fromISO("2026-10-25T00:59:00Z").setZone("Europe/London").offset,60);
const foreign={...s,id:identity("reviewed-feed","910GTEST"),routes:[{...r,id:identity("reviewed-feed","mildmay")}],
  transitland:{feedId:"reviewed-feed",fetchedAt:new Date(now).toISOString(),license:"OGL-UK-3.0",attribution:"TfL",url:"https://example.test"}};
assert.equal(matchedRoutes(foreign,s).length,1);
assert.equal(resultRouteAliases([foreign],[s]).get(foreign.routes[0].id),r.id);
// Another boarding point on the SAME feed/route is never suppressed by the first match.
const unmatched={...foreign,id:identity("reviewed-feed","other-point"),rawId:"910GOTHER"};
const separatePlatform={...foreign,id:identity("reviewed-feed","platform"),transitland:{...foreign.transitland,platform:"Separate platform"}};
assert.equal(directDuplicate(foreign.routes[0],[r]),false);
for(const other of [unmatched,separatePlatform]){
  const visible=preferDirect([foreign,other,s]);
  assert.equal(visible.some(x=>x.id===other.id&&x.routes.some(q=>q.id===foreign.routes[0].id)),true);
  assert.equal(resultRouteAliases([foreign,other],[s]).has(foreign.routes[0].id),false);
}
assert.equal(resultRouteAliases([unmatched],[s]).size,0); // No state carried into another query.
// Saved worldwide route dispatch is stable before AND after disabling TfL.
const oldEnabled=process.env.TFL_ENABLED;
try{
  for(const enabled of ["true","false"]){
    process.env.TFL_ENABLED=enabled;
    matchedRoutes(foreign,s);
    const record={route:foreign.routes[0],stops:[foreign,unmatched],shape:[],directions:[],vehicles:[],alerts:[],mode:"live" as const,updatedAt:new Date(now).toISOString()};
    const result=await routeDetail(foreign.routes[0].id,"live","original pattern",async(id,dir)=>{
      assert.equal(id,foreign.routes[0].id);assert.equal(dir,"original pattern");return record;
    });
    assert.equal(result?.route.id,foreign.routes[0].id);
    assert.equal(result?.stops.length,2);
  }
}finally{if(oldEnabled===undefined)delete process.env.TFL_ENABLED;else process.env.TFL_ENABLED=oldEnabled;}
assert.equal(preferDirect([foreign,s]).length,1);
assert.equal(preferDirect([{...foreign,lat:51.6},s]).length,2);
assert.equal(preferDirect([{...foreign,transitland:{...foreign.transitland,platform:"Separate platform"}},s]).length,2);
assert.equal(preferDirect([{...foreign,rawId:"different"},s]).length,2);
assert.equal(preferDirect([{...foreign,routes:[...foreign.routes,{...r,id:identity("reviewed-feed","uncovered")}]},s])[0].routes.length,1);
assert.equal(boundedArea({west:-.2,east:-.15,south:51.49,north:51.51}),true);
assert.equal(boundedArea({west:-.8,east:.3,south:51.3,north:51.7}),false);
assert.equal(boundedArea({west:-74,east:-73.99,south:40.7,north:40.71}),false);
assert.deepEqual(suppliedShapes({lineStrings:['[[[-.1,51.5],[-.2,51.6]]]']}),[]); // Invalid JSON.
assert.deepEqual(suppliedShapes({lineStrings:['[[[-0.1,51.5],[-0.2,51.6]],[[-0.3,51.5],[-0.4,51.6]]]']}),
  [[[-.1,51.5],[-.2,51.6]],[[-.3,51.5],[-.4,51.6]]]); // No fabricated branch connector.
assert.equal(notices([{id:"mildmay",name:"Mildmay",lineStatuses:[{statusSeverity:10,statusSeverityDescription:"Good service"}]}],now).length,0);
const status={statusSeverity:6,statusSeverityDescription:"Delays",validityPeriods:[{fromDate:"2026-10-30T11:00:00Z",toDate:"2026-10-30T13:00:00Z"}]};
assert.equal(notices([{id:"mildmay",name:"Mildmay",lineStatuses:[status]}],now).length,1);
assert.equal(notices([{id:"mildmay",name:"Mildmay",lineStatuses:[status]}],now+7200000).length,0);
assert.equal(allowedPath("https://attacker.test"),false);
assert.equal(allowedPath("StopPoint/../Line"),false);
assert.equal(allowedPath("StopPoint/910GTEST,940GZZLUOXC"),true);

function fixture(){
  let clock=now,calls=0,http=200,fail=false,timeout=false,rawBody:string|undefined,body:any={ok:true,echo:"fixture-secret",app_key:"fixture-secret"};
  const cache=new Map<string,CacheEntry>();
  let next=0,enabled=true,key:string|undefined="fixture-secret";
  const store:Store={async get(k){return cache.get(k);},async put(k,e){cache.set(k,e);},
    async reserve(n){if(n<next)return false;next=n+REQUEST_SPACING;return true;},async block(n){next=Math.max(next,n);}};
  const client=createClient({store,now:()=>clock,sleep:async ms=>{clock+=ms;},enabled:()=>enabled,key:()=>key,
    fetch:async (url,opts)=>{
      calls++;assert.equal(new URL(String(url)).searchParams.has("app_key"),false);
      assert.equal((opts?.headers as Record<string,string>).app_key,"fixture-secret");
      assert.equal(opts?.redirect,"error");
      if(fail)throw new Error("fixture-secret in unsafe network message");
      if(timeout)throw new DOMException("fixture-secret","TimeoutError");
      return new Response(rawBody??JSON.stringify(body),{status:http,headers:{"retry-after":"60"}});
    }});
  return {client,cache,calls:()=>calls,advance:(n:number)=>{clock+=n;},status:(n:number)=>{http=n;},fail:()=>{fail=true;},
    body:(b:any)=>{body=b;},raw:(b:string)=>{rawBody=b;},timeout:(b:boolean)=>{timeout=b;},
    disable:()=>{enabled=false;},noKey:()=>{key=undefined;}};
}
const f=fixture();
await Promise.all(Array.from({length:20},()=>f.client.request("StopPoint/940GZZLUOXC/Arrivals",{},20000)));
assert.equal(f.calls(),1);
const value=await f.client.request("StopPoint/940GZZLUOXC/Arrivals",{},20000);
assert.equal(value.echo,"[redacted]");assert.equal(value.app_key,undefined);
assert.equal(f.calls(),1);
assert.equal(f.client.health().status,"healthy");
f.advance(21000);await f.client.request("StopPoint/940GZZLUOXC/Arrivals",{},20000);assert.equal(f.calls(),2);
for(const code of [401,403,429,500]){
  const x=fixture();x.status(code);
  await assert.rejects(x.client.request("StopPoint/940GZZLUOXC/Arrivals"),(e:any)=>e instanceof TflError&&!e.message.includes("fixture-secret"));
  assert.equal(x.calls(),1);
  await assert.rejects(x.client.request("StopPoint/940GZZLUOXC/Arrivals"));assert.equal(x.calls(),1); // No anonymous retry.
  assert.equal(x.client.health().status,code===429?"quota-limited":"unavailable");
  x.advance(61000);x.status(200);await x.client.request("StopPoint/940GZZLUOXC/Arrivals");
  assert.equal(x.client.health().status,"healthy");
}
for(const action of ["disable","noKey"] as const){const x=fixture();x[action]();await assert.rejects(x.client.request("StopPoint/940GZZLUOXC/Arrivals"));assert.equal(x.calls(),0);}
const x=fixture();x.fail();await assert.rejects(x.client.request("StopPoint/940GZZLUOXC/Arrivals"),(e:any)=>!e.message.includes("fixture-secret"));
const timed=fixture();timed.timeout(true);await assert.rejects(timed.client.request("StopPoint/940GZZLUOXC/Arrivals"));
timed.advance(31000);timed.timeout(false);await timed.client.request("StopPoint/940GZZLUOXC/Arrivals");assert.equal(timed.client.health().status,"healthy");
const malformed=fixture();malformed.raw("not JSON fixture-secret");
await assert.rejects(malformed.client.request("StopPoint/940GZZLUOXC/Arrivals"),(e:any)=>!e.message.includes("fixture-secret"));
const big=fixture();big.body("x".repeat(4_000_001));await assert.rejects(big.client.request("StopPoint/940GZZLUOXC/Arrivals"));
const metadata=fixture();await metadata.client.request("StopPoint/940GZZLUOXC",{},3600000);
metadata.advance(3600001);metadata.status(500);
assert.equal((await metadata.client.request("StopPoint/940GZZLUOXC",{},3600000)).ok,true);
assert.equal(metadata.client.health().status,"stale"); // Retained metadata is explicitly disclosed, not relabeled healthy.
assert.match(metadata.client.health().message,/Cached TfL metadata retained/);
await assert.rejects(f.client.request("StopPoint",{app_key:"forbidden"}));
// Two independent clients simulate replicas, not merely one client's in-flight map.
const sharedCache=new Map<string,CacheEntry>(),locks=new Set<string>();let sharedCalls=0;
const sharedStore:Store={async get(k){return sharedCache.get(k);},async put(k,v){sharedCache.set(k,v);},
  async reserve(){return true;},async block(){},
  async lock(k){if(locks.has(k))return;locks.add(k);return async()=>{locks.delete(k);};}};
const deps={store:sharedStore,now:()=>now,key:()=>"fixture-secret",enabled:()=>true,
  sleep:()=>new Promise<void>(r=>setTimeout(r,1)),fetch:async()=>{
    sharedCalls++;await new Promise(r=>setTimeout(r,3));return new Response("[]");
  }};
const replicaA=createClient(deps),replicaB=createClient(deps);
await Promise.all([replicaA.request("StopPoint/940GZZLUOXC/Arrivals"),replicaB.request("StopPoint/940GZZLUOXC/Arrivals")]);
assert.equal(sharedCalls,1);assert.equal(locks.size,0);
console.log("TfL isolated fixtures passed: identities, DST, expiry, exact crosswalks, bounds, notices, cache concurrency, redaction, denial, quota and recovery.");
// Importing db creates no connection in these isolated fixtures.
