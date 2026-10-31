import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { cityDatabasePath, createLocationLookup, loadCityReader, locationFromRecord, unknownLocation, type EntryLocation } from "../src/lib/entry-location";
import { createEntryRouter } from "../src/routes/entry";

function record(city:string,state:string,country="US") {
  return {country:{iso_code:country},city:{names:{en:city}},subdivisions:[{iso_code:state,names:{en:state}}]};
}
test("all nine supplied cities match only their supplied municipality and state",()=>{
  for(const [city,state,theme] of [
    ["San Francisco","CA","san-francisco"],["Philadelphia","PA","philadelphia"],
    ["Dallas","TX","dallas"],["Miami","FL","miami"],["Atlanta","GA","atlanta"],
    ["Detroit","MI","detroit"],["Cincinnati","OH","cincinnati"],
    ["Chicago","IL","chicago"],["Los Angeles","CA","los-angeles"]
  ]){
    const match=locationFromRecord(record(city,state));
    assert.equal(match.theme,theme);assert.equal(match.matchedBy,"city");
    assert.ok(match.operator);assert.equal(match.accuracy,"approximate");
    assert.equal(locationFromRecord(record(city,"ZZ")).theme,"default");
    assert.equal(locationFromRecord(record(city,state,"CA")).theme,"default");
  }
  for(const [city,state] of [["Oakland","CA"],["Evanston","IL"],["Fort Worth","TX"],["Beverly Hills","CA"]])
    assert.equal(locationFromRecord(record(city,state)).theme,"default");
});
test("New Jersey and Connecticut are statewide; New York keeps its city design",()=>{
  for(const city of ["Newark","Trenton","Atlantic City"])assert.equal(locationFromRecord(record(city,"NJ")).theme,"new-jersey");
  for(const city of ["Hartford","New Haven","Stamford"])assert.equal(locationFromRecord(record(city,"CT")).theme,"connecticut");
  for(const city of ["New York City","Manhattan","Brooklyn","Queens","Bronx","Staten Island"])
    assert.equal(locationFromRecord(record(city,"NY")).theme,"new-york");
  assert.equal(locationFromRecord(record("Buffalo","NY")).theme,"default");
  assert.equal(locationFromRecord({country:{iso_code:"US"},subdivisions:[{names:{en:"Connecticut"}}]}).theme,"connecticut");
});
test("unmatched places use honest city/operator labels, never an invented agency",()=>{
  assert.equal(locationFromRecord(record("Boston","MA")).operator,"MBTA");
  assert.equal(locationFromRecord(record("Unlisted municipality","MA")).operator,null);
  const london=locationFromRecord(record("London","England","GB"));
  assert.equal(london.theme,"default");assert.equal(london.city,"London");assert.equal(london.operator,null);
  assert.deepEqual(locationFromRecord(null),unknownLocation());
  assert.equal(locationFromRecord({country:{iso_code:"US"},city:{names:{en:"<script>bad</script>"}}}).city,null);
  assert.deepEqual(locationFromRecord({country:{iso_code:"invalid"}}),unknownLocation());
});
test("lookup refuses private/invalid addresses and never forwards a visitor externally",async()=>{
  let calls=0;
  const lookup=createLocationLookup(Promise.resolve({get(){calls++;return record("Chicago","IL");}}));
  for(const ip of [null,"127.0.0.1","10.1.2.3","192.0.2.1","not-an-address"])assert.deepEqual(await lookup(ip),unknownLocation());
  assert.equal(calls,0);
  assert.equal((await lookup("8.8.8.8")).theme,"chicago");assert.equal(calls,1);
  const failure=createLocationLookup(Promise.resolve({get(){throw new Error("private lookup details");}}));
  assert.deepEqual(await failure("8.8.8.8"),unknownLocation());
});
test("packaged local city database is usable without an outgoing visitor lookup",async()=>{
  const reader=await loadCityReader(cityDatabasePath);
  assert.ok(reader,"City database must be packaged before this integration test");
  const result=await createLocationLookup(Promise.resolve(reader))("8.8.8.8");
  assert.equal(result.accuracy,"approximate");assert.equal(result.source,"db-ip-lite");
  assert.equal("latitude" in result,false);assert.equal("ip" in result,false);
});
test("HTTP metadata is no-store, bounded, sanitized and ignores location query/header overrides",async()=>{
  const app=express();
  const chicago=locationFromRecord(record("Chicago","IL"));
  app.use("/api",createEntryRouter(undefined,async address=>address==="8.8.8.8"?{...chicago,ip:"never-expose",latitude:1} as EntryLocation:unknownLocation()));
  app.use("/slow",createEntryRouter(undefined,()=>new Promise(()=>{})));
  app.use("/fail",createEntryRouter(undefined,async()=>{throw new Error("private lookup details");}));
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
    const r=await fetch(`${base}/api/entry/location?city=Miami&country=FR&ip=1.1.1.1`,{
      headers:{"x-forwarded-for":"8.8.8.8, 10.0.0.4, 127.0.0.1","cf-ipcountry":"JP","x-city":"Los Angeles"}});
    assert.equal(r.status,200);assert.match(r.headers.get("cache-control")!,/private.*no-store/);
    assert.equal(r.headers.get("cdn-cache-control"),"no-store");assert.equal(r.headers.get("surrogate-control"),"no-store");
    assert.equal(r.headers.get("vary"),"*");assert.deepEqual(await r.json(),chicago);
    assert.deepEqual(await (await fetch(`${base}/api/entry/location?city=Chicago`,{headers:{"x-real-ip":"8.8.8.8"}})).json(),unknownLocation());
    const start=Date.now();
    assert.deepEqual(await(await fetch(`${base}/slow/entry/location`)).json(),unknownLocation());
    assert.ok(Date.now()-start<1500);
    assert.deepEqual(await(await fetch(`${base}/fail/entry/location`)).json(),unknownLocation());
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
