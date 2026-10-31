/** Explicit, bounded diagnostic. No key values, request headers or raw errors printed. */
import { pool } from "@workspace/db";
import { lines,discover,enrich,route } from "../src/transit/tfl/service";
import { request,safeMessage } from "../src/transit/tfl/client";
import { normalizeStop } from "../src/transit/tfl/model";
try{
  const catalog=await lines();
  console.log("Current rail lines",catalog.filter(r=>r.type!=="bus").map(r=>({id:r.id,name:r.name})));
  const search=await discover({q:"Oxford Circus"});
  console.log("Station search",{stops:search.stops.length,state:search.tfl?.status});
  const nearby=await discover({lat:51.5152,lon:-.1419,type:"bus"});
  console.log("Bus nearby",{stops:nearby.stops.length,state:nearby.tfl?.status});
  const bus=nearby.stops[0];if(bus){const live=await enrich(bus);console.log("Bus sample",{id:bus.id,routes:bus.routes.map(r=>r.name),fresh:live.arrivals.length,message:live.tfl?.message});}
  for(const [mode,id] of [["tube","victoria"],["dlr","dlr"],["elizabeth-line","elizabeth"],["overground","mildmay"]]){
    const r=catalog.find(r=>r.id===`tfl:line:${id}`);if(!r)continue;
    const seq=await request(`Line/${id}/Route/Sequence/inbound`,{},86400000);
    // Choose a central station rather than a terminal, where arrivals can legitimately be absent.
    const values=seq.stopPointSequences?.[0]?.stopPoint||[],raw=values[Math.floor(values.length/2)];
    if(!raw){console.log(mode,{coverage:"No stop pattern supplied"});continue;}
    const s=normalizeStop({...raw,lines:[{id}]},[r]);if(!s)continue;
    const live=await enrich(s);
    console.log("Rail sample",{mode,id:s.id,name:s.name,fresh:live.arrivals.length,observation:live.arrivals[0]?.updatedAt,expected:live.arrivals[0]?.scheduledAt,message:live.tfl?.message});
  }
  const detail=await route("tfl:line:victoria","inbound",false);
  console.log("Route sample",{stops:detail?.stops.length,shapePoints:detail?.shape.length,vehicles:detail?.vehicles.length});
}catch(err){console.error(safeMessage(err));process.exitCode=1;}
finally{await pool.end();}
