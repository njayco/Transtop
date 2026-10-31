import assert from "node:assert/strict";
import { test, mock, after } from "node:test";
let allowed=true, reserved=0;
mock.module("@workspace/db",{exports:{pool:{async query(sql:string){
  if(sql.includes("INSERT INTO transit_feed_snapshots")){reserved++;return {rowCount:allowed?1:0,rows:[]};}
  throw new Error("Unexpected database access");
}}}});
const original=process.env.MOBILITY_DATABASE_REFRESH_TOKEN;
process.env.MOBILITY_DATABASE_REFRESH_TOKEN="fixture-not-a-real-token";
let calls:{url:string;init:any}[]=[];
let httpStatus=200;
mock.method(globalThis,"fetch",async(input:any,init:any)=>{
  const url=String(input);calls.push({url,init});
  if(url.endsWith("/tokens/access"))return new Response(JSON.stringify({access_token:"fixture-access",expiration_datetime_utc:new Date(Date.now()+3600_000).toISOString()}),{status:200});
  return new Response(httpStatus===200?JSON.stringify([]):"provider error",{status:httpStatus});
});
after(()=>{mock.restoreAll();if(original===undefined)delete process.env.MOBILITY_DATABASE_REFRESH_TOKEN;else process.env.MOBILITY_DATABASE_REFRESH_TOKEN=original;});
const {request}=await import("../src/transit/mobility/client");
test("token exchange, same-resource singleflight and no credential in data URL",async()=>{
  await Promise.all(Array.from({length:5},()=>request("gtfs_feeds",{limit:20})));
  assert.equal(calls.length,2);assert.equal(reserved,1);
  assert.equal(calls[0].init.method,"POST");
  assert.equal(JSON.parse(calls[0].init.body).refresh_token,"fixture-not-a-real-token");
  assert.equal(calls[1].init.headers.Authorization,"Bearer fixture-access");
  assert.equal(new URL(calls[1].url).origin,"https://api.mobilitydatabase.org");
  assert.equal(calls[1].url.includes("fixture"),false);
  assert.equal(calls[1].init.redirect,"error");
});
test("invalid resources and exhausted quotas never issue network requests",async()=>{
  const before=calls.length;
  await assert.rejects(request("../private"));
  allowed=false;await assert.rejects(request("gtfs_feeds/mdb-2"),/allowance/);allowed=true;
  assert.equal(calls.length,before);
});
test("provider throttling is sanitized and starts a bounded cooldown",async()=>{
  httpStatus=429;
  await assert.rejects(request("gtfs_feeds/mdb-3"),/temporarily unavailable/);
  const before=calls.length;
  await assert.rejects(request("gtfs_feeds/mdb-4"),/cooling down/);
  assert.equal(calls.length,before);
});
