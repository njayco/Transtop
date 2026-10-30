import test,{mock} from "node:test";
import assert from "node:assert/strict";
import { pool,db } from "@workspace/db";
import { pollAmtrak,amtrakPositions,amtrakHealth } from "./amtrak-live";

test("offered API polling is bounded, deduplicated, owned, cached and backs off on decoding failures",async()=>{
  let clock=Date.parse("2026-10-31T14:00:00Z"),fetches=0,failed=false,owned=true,released=0;
  const snapshots:any[]=[];
  const date=mock.method(Date,"now",()=>clock);
  const connect=mock.method(pool,"connect",async()=>({
    query:async(sql:string)=>sql.includes("pg_try")?{rows:[{locked:owned}]}:{rows:[]},release:()=>released++,
  })) as any;
  const query=mock.method(pool,"query",async()=>({rows:[]})) as any;
  const insert=mock.method(db,"insert",()=>({values:(v:any)=>({onConflictDoUpdate:async()=>{snapshots.push(v);}})})) as any;
  const fetcher=mock.method(globalThis,"fetch",async(input:any,init:any)=>{
    fetches++;assert.ok(init.headers["User-Agent"].startsWith("Transtop/"));
    assert.equal(init.redirect,"error");assert.ok(init.signal);
    const url=String(input);assert.ok(["https://api.amtraker.com/v3/trains","https://api.amtraker.com/v3/stations"].includes(url));
    if(url.endsWith("/stations"))return Response.json({CHI:{tz:"America/Chicago"},DEN:{tz:"America/Denver"}});
    return Response.json(failed?{changed:"invalid"}:{"5":[{
      provider:"Amtrak",trainNum:"5",routeName:"California Zephyr",lastValTS:new Date(clock).toISOString(),
      trainState:"Active",lat:39.8,lon:-105,stations:[
        {code:"CHI",status:"Departed",schDep:"2026-10-31T08:00:00-05:00",dep:"2026-10-31T08:00:00-05:00"},
        {code:"DEN",status:"Enroute",schDep:"2026-10-31T09:30:00-06:00",dep:"2026-10-31T09:40:00-06:00"}],
    }]});
  });
  try{
    await Promise.all([pollAmtrak(),pollAmtrak()]);assert.equal(fetches,2);assert.equal(released,1);
    assert.equal(amtrakPositions().length,1);assert.equal(amtrakPositions()[0].routeId,undefined);
    assert.equal(amtrakHealth().unresolved,1);assert.equal(snapshots.length,1);
    for(let i=0;i<5;i++)amtrakPositions();
    await pollAmtrak();assert.equal(fetches,2); // no browser-triggered upstream work
    clock+=60_000;failed=true;await pollAmtrak();
    assert.equal(amtrakPositions().length,0);assert.equal(amtrakHealth().fresh,0);
    assert.match(amtrakHealth().error!,/format/);assert.equal(snapshots.length,2);
    clock+=60_000;await pollAmtrak();assert.equal(fetches,4); // failure backoff
    clock+=120_000;owned=false;await pollAmtrak();assert.equal(fetches,4); // another process owns collection
  }finally{date.mock.restore();connect.mock.restore();query.mock.restore();insert.mock.restore();fetcher.mock.restore();}
});
