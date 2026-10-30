import { DateTime } from "luxon";
import { pool } from "@workspace/db";
import { amtrakTrains,amtrakAvailable,publishedTrains } from "./amtrak-live";
import { observationFresh,type AmtrakTrain,type PublishedTrain } from "./amtrak-model";
import { activeService,serviceInstant } from "./time";
import type { Arrival,TransitStop } from "./types";

export const scheduledRunId=(trip:string,date:string)=>`amtrak:trip:${trip.slice("amtrak:".length)}:${date}`;
export function amtrakDates(now:number,maxSeconds:number) {
  const today=DateTime.fromMillis(now,{zone:"America/New_York"});
  // Derived from the feed's elapsed time range, not a two-day regional window.
  return Array.from({length:Math.ceil(maxSeconds/86400)+3},(_,i)=>today.minus({days:i-1}).toFormat("yyyyMMdd"));
}
export async function amtrakArrivals(stop:TransitStop,now=Date.now()):Promise<Arrival[]> {
  return amtrakArrivalsFor(stop,await publishedTrains(),amtrakAvailable()?amtrakTrains():[],now);
}
export function amtrakArrivalsFor(stop:TransitStop,published:PublishedTrain[],reports:AmtrakTrain[],now:number):Arrival[] {
  const result:Arrival[]=[];
  const raw=stop.rawId||stop.id.slice(7);
  const candidates=published.filter(p=>p.calls.some(c=>c.code===raw));
  const maxSeconds=Math.max(0,...candidates.flatMap(p=>p.calls.map(c=>c.departure)));
  const observations=reports.filter(t=>t.matched&&observationFresh(t,now));
  for(const p of candidates)for(const date of amtrakDates(now,maxSeconds)){
    if(!activeService(p.calendar,p.exceptions,date))continue;
    const call=p.calls.find(c=>c.code===raw)!;
    if(call===p.calls.at(-1))continue; // terminal arrival is not a boarding departure
    if(call.departure<0||call.pickup==="1")continue;
    const scheduled=serviceInstant(date,call.departure,p.trip.agency_timezone);
    const tracking=observations.filter(t=>t.tripId===p.id&&t.serviceDate===date);
    // Multiple observations for one dated trip are ambiguous, not two live trains.
    const live=tracking.length===1?tracking[0]:undefined;
    const observed=live?.calls.find(c=>c.code===raw);
    if(live&&/^(Canceled|Cancelled)$/.test(live.state)||observed?.actualDeparture||observed?.status==="Skipped")continue;
    const estimate=live?.state==="Active"?observed?.estimatedDeparture:null;
    const at=estimate?Date.parse(estimate):scheduled;
    if(at<now-30_000||at>now+2*3600_000)continue;
    result.push({id:`amtrak:${p.id}:${date}:${raw}`,routeId:p.route.id,routeName:p.route.name,color:"#CAE4F1",
      direction:p.trip.direction_id==="1"?"Inbound":"Outbound",destination:p.trip.trip_headsign||"See published route",
      minutes:Math.max(0,Math.ceil((at-now)/60_000)),source:estimate?"live":"scheduled",
      updatedAt:estimate?live!.updatedAt!:stop.updatedAt,
      status:estimate?"Amtraker · estimated departure (unofficial)":"Scheduled · not a live prediction",
      scheduledAt:new Date(at).toISOString(),publishedAt:new Date(scheduled).toISOString(),
      ...(estimate?{expiresAt:live!.expiresAt!}:{}),tripId:p.id,trainNumber:p.trip.trip_short_name,
      timezone:stop.stop_timezone,runId:scheduledRunId(p.id,date)});
  }
  return result.sort((a,b)=>a.minutes-b.minutes).slice(0,36);
}
export async function amtrakTrainDetail(id:string):Promise<AmtrakTrain|undefined> {
  const observed=amtrakTrains().find(t=>t.id===id);
  if(observed){
    const fresh=amtrakAvailable()&&observationFresh(observed);
    return {...observed,message:observed.message+(fresh?"":" Tracking unavailable or stale; estimates and coordinates are withheld."),
      expiresAt:fresh?observed.expiresAt:null,
      lat:fresh?observed.lat:null,lon:fresh?observed.lon:null,
      calls:observed.calls.map(c=>({...c,estimatedArrival:fresh?c.estimatedArrival:null,estimatedDeparture:fresh?c.estimatedDeparture:null}))};
  }
  const match=/^amtrak:trip:([^:]+):(\d{8})$/.exec(id);
  if(!match)return;
  const date=match[2],p=(await publishedTrains()).find(t=>t.id===`amtrak:${match[1]}`);
  if(DateTime.fromFormat(date,"yyyyMMdd").toFormat("yyyyMMdd")!==date)return;
  if(!p||!activeService(p.calendar,p.exceptions,date))return;
  const live=amtrakTrains().filter(t=>t.tripId===p.id&&t.serviceDate===date);
  if(live.length===1)return amtrakTrainDetail(live[0].id);
  const {rows}=await pool.query("SELECT data FROM transit_stops WHERE mode='live' AND agency='amtrak'");
  const metadata=new Map(rows.map(r=>[r.data.rawId,r.data]));
  const zone=p.trip.agency_timezone||"America/New_York";
  const instant=(seconds:number)=>seconds<0?null:new Date(serviceInstant(date,seconds,zone)).toISOString();
  return {id,trainNumber:p.trip.trip_short_name,routeName:p.route.name,destination:p.trip.trip_headsign||"See route",
    serviceDate:date,source:"Amtrak · published GTFS schedule",updatedAt:null,expiresAt:null,state:"Scheduled",lat:null,lon:null,
    routeId:p.route.id,tripId:p.id,matched:true,message:"Published service-day schedule. No live observation is associated with this run.",
    calls:p.calls.map((c,i)=>({code:c.code,name:metadata.get(c.code)?.name||c.code,sequence:i+1,
      timezone:metadata.get(c.code)?.stop_timezone||null,status:"Scheduled",
      scheduledArrival:instant(c.arrival),scheduledDeparture:instant(c.departure),estimatedArrival:null,estimatedDeparture:null,
      actualArrival:null,actualDeparture:null}))};
}
