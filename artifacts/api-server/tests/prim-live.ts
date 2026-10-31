// Opt-in, one authenticated request. Never outputs credentials or error bodies.
import { fetchPrimStop } from "../src/transit/idfm/prim-client";
if(process.env.PRIM_LIVE_SMOKE!=="true")throw new Error("Set PRIM_LIVE_SMOKE=true for one verified-account request");
const result=await fetchPrimStop(process.argv[2]||"STIF:StopPoint:Q:22086:");
const service=result.Siri?.ServiceDelivery;
const deliveries=service?.StopMonitoringDelivery;
const delivery=Array.isArray(deliveries)?deliveries[0]:deliveries;
const visits=delivery?.MonitoredStopVisit;
const first=(Array.isArray(visits)?visits:[visits]).filter(Boolean)[0];
console.log(JSON.stringify({responseTimestamp:service?.ResponseTimestamp,status:delivery?.Status,
  serviceKeys:Object.keys(service||{}),deliveryKeys:Object.keys(delivery||{}),visits:Array.isArray(visits)?visits.length:visits?1:0,
  first:first?{RecordedAtTime:first.RecordedAtTime,MonitoringRef:first.MonitoringRef,
    MonitoredVehicleJourney:first.MonitoredVehicleJourney}:undefined},null,2));
