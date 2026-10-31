import assert from "node:assert/strict";
import test from "node:test";
import { parsePrim,primReference,primEnabled } from "./prim-model";
import { fetchPrimStop } from "./prim-client";
import type { TransitStop } from "../types";
const now=Date.parse("2026-10-31T02:56:00Z"),ref="STIF:StopPoint:Q:37380:";
const stop={id:"idfm:IDFM:37380",rawId:"IDFM:37380",location_type:"0",routes:[
  {id:"idfm:IDFM:C01414",name:"N02",color:"#123456",type:"bus",agency:"RATP"}]} as unknown as TransitStop;
function payload(){
  return {Siri:{ServiceDelivery:{ResponseTimestamp:new Date(now).toISOString(),StopMonitoringDelivery:[{Status:"true",MonitoredStopVisit:[
    {RecordedAtTime:new Date(now-30_000).toISOString(),MonitoringRef:{value:ref},MonitoredVehicleJourney:{
      LineRef:{value:"STIF:Line::C01414:"},DestinationName:[{value:"Châtelet"}],DirectionName:[{value:"Circulaire extérieure"}],
      FramedVehicleJourneyRef:{DatedVehicleJourneyRef:"technical-counter-not-a-GTFS-id"},
      MonitoredCall:{ExpectedDepartureTime:new Date(now+300_000).toISOString(),DepartureStatus:"onTime",DeparturePlatformName:{value:"Quai A"}}}}
  ]}]}}};
}
const visit=(p:ReturnType<typeof payload>)=>p.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit[0];
test("PRIM public access requires its own confirmation, not just a schedule confirmation or valid key",()=>{
  const options={enabled:true,hasKey:true,production:true,publicConfirmed:false};
  assert.equal(primEnabled(options),false);
  assert.equal(primEnabled({...options,publicConfirmed:true}),true);
  assert.equal(primEnabled({...options,production:false}),true);
  assert.equal(primEnabled({...options,production:false,enabled:false}),false);
  assert.equal(primEnabled({...options,production:false,hasKey:false}),false);
});
test("PRIM expected fields become timestamped predictions with supplied French names, never GPS or invented trip matches",()=>{
  const r=parsePrim(payload(),stop,ref,now),a=r.arrivals[0];
  assert.equal(a.source,"live");assert.equal(a.minutes,5);assert.equal(a.destination,"Châtelet");
  assert.equal(a.direction,"Circulaire extérieure");assert.equal(a.platform,"Quai A");assert.equal(a.timezone,"Europe/Paris");
  assert.equal(Date.parse(a.expiresAt!),now+90_000);assert.equal(a.tripId,undefined);assert.equal((a as any).lat,undefined);
  assert.equal(primReference(stop),ref);
  assert.equal(primReference({...stop,location_type:"1"} as any),"STIF:StopArea:SP:37380:");
  assert.equal(primReference({...stop,rawId:"unknown"}),undefined);
});
test("fresh HTTP replies cannot refresh old production timestamps or theoretical-only times",()=>{
  const stale=payload();visit(stale).RecordedAtTime=new Date(now-121_000).toISOString();
  assert.equal(parsePrim(stale,stop,ref,now).arrivals.length,0);
  const aimed=payload(),call=visit(aimed).MonitoredVehicleJourney.MonitoredCall as any;
  call.AimedDepartureTime=call.ExpectedDepartureTime;delete call.ExpectedDepartureTime;
  assert.equal(parsePrim(aimed,stop,ref,now).arrivals.length,0);
  const unmonitored=payload();(visit(unmonitored).MonitoredVehicleJourney as any).Monitored=false;
  assert.equal(parsePrim(unmonitored,stop,ref,now).arrivals.length,0);
  const noOffset=payload();visit(noOffset).MonitoredVehicleJourney.MonitoredCall.ExpectedDepartureTime="2026-10-31T03:01:00";
  assert.equal(parsePrim(noOffset,stop,ref,now).arrivals.length,0);
});
test("unknown lines, different platforms, stale deliveries and false statuses cannot become live arrivals",()=>{
  const wrongLine=payload();visit(wrongLine).MonitoredVehicleJourney.LineRef.value="STIF:Line::C99999:";
  assert.equal(parsePrim(wrongLine,stop,ref,now).arrivals.length,0);
  const wrongStop=payload();visit(wrongStop).MonitoringRef.value="STIF:StopPoint:Q:99:";
  assert.equal(parsePrim(wrongStop,stop,ref,now).arrivals.length,0);
  const wrongPlatform=payload();(visit(wrongPlatform).MonitoredVehicleJourney.MonitoredCall as any).StopPointRef={value:"STIF:StopPoint:Q:99:"};
  assert.equal(parsePrim(wrongPlatform,stop,ref,now).arrivals.length,0);
  const old=payload();old.Siri.ServiceDelivery.ResponseTimestamp=new Date(now-121_000).toISOString();
  assert.throws(()=>parsePrim(old,stop,ref,now),/fresh timestamp/);
  const failed=payload();failed.Siri.ServiceDelivery.StopMonitoringDelivery[0].Status="false";
  assert.throws(()=>parsePrim(failed,stop,ref,now),/unavailable/);
});
test("cancelled calls are expiring notices, not boardable arrivals or whole-route cancellations",()=>{
  const p=payload();visit(p).MonitoredVehicleJourney.MonitoredCall.DepartureStatus="cancelled";
  const result=parsePrim(p,stop,ref,now);
  assert.equal(result.arrivals.length,0);assert.equal(result.alerts.length,1);
  assert.match(result.alerts[0].description,/does not cancel the whole route/);
  assert.equal(Date.parse(result.alerts[0].expiresAt),now+90_000);
});
test("transport keeps credentials in headers, refuses redirects/oversize/error bodies and sanitizes JSON errors",async()=>{
  let requests=0;
  const fake=(async(url:any,options:any)=>{
    requests++;assert.equal(new URL(url).hostname,"prim.iledefrance-mobilites.fr");
    assert.equal(new URL(url).searchParams.has("apikey"),false);
    assert.equal(options.headers.apikey,"fixture-key");assert.equal(options.redirect,"error");
    return new Response(JSON.stringify(payload()));
  }) as typeof fetch;
  await fetchPrimStop(ref,fake,"fixture-key");assert.equal(requests,1);
  await assert.rejects(fetchPrimStop("https://evil.example",fake,"fixture-key"),/Unsupported/);
  await assert.rejects(fetchPrimStop(ref,async()=>new Response("private error body",{status:403}),"fixture-key"),/^Error: PRIM HTTP 403$/);
  await assert.rejects(fetchPrimStop(ref,async()=>new Response("private invalid JSON"),"fixture-key"),/^Error: PRIM returned invalid JSON$/);
  await assert.rejects(fetchPrimStop(ref,async()=>new Response(" ".repeat(2*1024*1024+1)),"fixture-key"),/exceeds 2 MiB/);
});
