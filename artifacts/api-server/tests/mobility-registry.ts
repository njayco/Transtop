import assert from "node:assert/strict";
import { test,mock,after } from "node:test";
process.env.MOBILITY_DATABASE_REFRESH_TOKEN="fixture-not-a-secret";
let candidate:any,measured={zipBytes:83_251_265,expandedBytes:670_521_491},downloads=0,registrations=0;
const base={id:"mdb-registry-fixture",kind:"gtfs",provider:"Fixture",name:"Fixture",official:true,status:"active",
  reason:"Withheld: feed exceeds the bounded importer capacity",eligible:false,countries:["DE"],regions:["Berlin"],
  timezone:"Europe/Berlin",license:"CC-BY-4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/",
  producerUrl:"https://example.org/fixture.zip",datasetId:"fixture",
  hostedUrl:"https://files.mobilitydatabase.org/mdb-registry-fixture/fixture/fixture.zip",
  downloadedAt:"2026-10-30T00:00:00Z",validFrom:"2020-01-01",validThrough:"2099-01-01"};
mock.module("@workspace/db",{exports:{pool:{
  async query(q:string,params:any[]){
    assert(q.includes("(data->>'expires')::bigint>$1"));
    assert.equal(typeof params[0],"number");
    return {rows:candidate?[{f:candidate}]:[]};
  },
  async connect(){return {async query(q:string){
    if(q.includes("pg_try_advisory_lock"))return {rows:[{locked:true}]};
    if(q.includes("count(*)"))return {rows:[{count:0}]};
    if(q.includes("INSERT INTO"))registrations++;
    return {rows:[]};
  },release(){}};}
}}});
mock.module("../src/transit/mobility/archive",{exports:{async openArchive(){downloads++;return measured;}}});
const {prepareCachedRegional,recordFor}=await import("../src/transit/mobility/registry");
const {adapters}=await import("../src/transit/adapters");
const native=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error("Cached import must not spend a catalog request");};
after(()=>{globalThis.fetch=native;mock.restoreAll();});
test("fresh search evidence without sizes is measured and registered scheduled-only",async()=>{
  candidate={...base};
  const record=await prepareCachedRegional(base.id);
  assert.equal(record.regional,true);assert.equal(record.eligible,true);assert.equal(downloads,1);assert.equal(registrations,1);
  assert(record.sizeMb!>20);assert(record.uncompressedMb!>100);
  assert.equal(recordFor("mobility-"+base.id)?.datasetId,"fixture");
  assert.deepEqual(adapters.find(a=>a.id==="mobility-"+base.id)?.realtimeUrls,[]);
});
test("cached metadata cannot bypass rights, timezones, dates, direct sources or measured bounds",async()=>{
  const before=registrations;
  for(const patch of [
    {licenseUrl:"https://example.org/license"},{official:false},{status:"inactive"},{timezone:"Not/AZone"},
    {reason:"Withheld: provider requires separate access credentials"},{validThrough:"2020-01-01"},
    {validFrom:"2098-01-01"},{producerUrl:adapters.find(a=>a.id==="mta-subway")!.staticUrl},
  ]){
    candidate={...base,...patch};await assert.rejects(prepareCachedRegional(base.id));
  }
  candidate=undefined;await assert.rejects(prepareCachedRegional(base.id));
  candidate={...base};measured={zipBytes:97*1024**2,expandedBytes:670_521_491};
  await assert.rejects(prepareCachedRegional(base.id));
  assert.equal(registrations,before);
});
