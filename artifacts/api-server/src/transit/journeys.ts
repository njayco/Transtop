import type { Request,Response,NextFunction } from "express";
import type { z } from "zod";
import { PlanJourneyBody, PlanJourneyResponse } from "@workspace/api-zod";

type JourneyInput=z.infer<typeof PlanJourneyBody>;
type JourneyResults=z.infer<typeof PlanJourneyResponse>;
const buckets=new Map<string,{count:number;expires:number}>();
let inFlight=0,windowStart=Date.now(),windowRequests=0;
let lastCheck:{status:string;message?:string;updatedAt:string}|undefined;
export function journeyHealth(){
  return !process.env.GOOGLE_MAPS_ROUTES_API_KEY?{status:"awaiting credentials",updatedAt:null}:
    lastCheck||{status:"configured · verify API access",updatedAt:null};
}
export function journeyLimit(req:Request,res:Response,next:NextFunction) {
  const now=Date.now(),key=req.ip||"unknown";
  for(const [id,b] of buckets)if(b.expires<now)buckets.delete(id);
  const bucket=buckets.get(key)||{count:0,expires:now+60000};bucket.count++;buckets.set(key,bucket);
  if(now-windowStart>60000){windowStart=now;windowRequests=0;}
  if(bucket.count>10||++windowRequests>100||inFlight>=6||buckets.size>10000){
    res.set("Retry-After","60").status(429).json({error:"Trip planning is busy. Wait a minute before trying again; agency timetables still work."});return;
  }
  next();
}
function seconds(duration:string|undefined){return Number.parseFloat(duration||"0")||0;}
export function decodePolyline(encoded:string):number[][] {
  const points:number[][]=[];let index=0,lat=0,lon=0;
  const part=()=>{
    let value=0,shift=0,byte:number;
    do{if(index>=encoded.length||shift>30)throw new Error("Invalid route geometry");byte=encoded.charCodeAt(index++)-63;value|=(byte&31)<<shift;shift+=5;}while(byte>=32);
    return value&1?~(value>>1):value>>1;
  };
  while(index<encoded.length){lat+=part();lon+=part();points.push([lon/1e5,lat/1e5]);}
  return points;
}
export class JourneyError extends Error {
  constructor(public status:number,message:string){super(message);}
}
export async function planJourney(input:JourneyInput):Promise<JourneyResults> {
  const key=process.env.GOOGLE_MAPS_ROUTES_API_KEY;
  if(!key)return {journeys:[],configured:false,provider:"Google Maps",message:"Google trip planning is not configured. Enable Routes API with billing and add a separate server credential named GOOGLE_MAPS_ROUTES_API_KEY in Replit Secrets. Agency routes and timetables remain available."};
  const when=input.time?input.time.getTime():Date.now()+60000;
  if(!Number.isFinite(when)||when<Date.now()-7*86400000||when>Date.now()+100*86400000)throw new JourneyError(400,"Choose a valid journey time within Google's transit planning window (7 days past to 100 days ahead).");
  const body={
    origin:{address:input.origin.trim()},destination:{address:input.destination.trim()},
    travelMode:"TRANSIT",computeAlternativeRoutes:true,languageCode:"en-US",regionCode:"US",
    [input.timeType==="arrival"?"arrivalTime":"departureTime"]:new Date(when).toISOString(),
    ...(input.modes?.length?{transitPreferences:{allowedTravelModes:input.modes}}:{}),
  };
  inFlight++;
  try{
    const response=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{
      method:"POST",signal:AbortSignal.timeout(20000),headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,
        "X-Goog-FieldMask":"routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.transitDetails"},
      body:JSON.stringify(body),
    });
    if(!response.ok){
      // Provider error bodies may contain user addresses or credential context.
      // Do not log or return them, and never retry a billable request silently.
      if(response.status===403||response.status===401){
        const info=await response.json().catch(()=>null) as any;
        const reasons=new Set((info?.error?.details||[]).map((d:any)=>d.reason));
        let message="Google authorization failed. Verify Routes API is enabled, billing is active, and the server Routes key has the correct API/application restrictions.";
        // Return only fixed, allowlisted diagnostic text. Never forward Google's
        // raw messages, project identifiers, key fragments or arbitrary metadata.
        if(reasons.has("SERVICE_DISABLED"))message="Google Routes API is disabled for this key's Google Cloud project. Enable Routes API in Google Cloud, then try again.";
        else if(reasons.has("BILLING_DISABLED")||reasons.has("BILLING_NOT_ACTIVE"))message="Google Cloud billing is not active for this Routes API project. Enable billing in Google Cloud, then try again.";
        else if(reasons.has("API_KEY_SERVICE_BLOCKED"))message="This server key's API restrictions block Routes API. Authorize Routes API for the server key in Google Cloud.";
        else if(reasons.has("API_KEY_HTTP_REFERRER_BLOCKED"))message="This key has website-referrer restrictions and cannot authorize the server journey planner. Add a separate server Routes key; do not loosen your browser key.";
        else if(reasons.has("API_KEY_IP_ADDRESS_BLOCKED"))message="The server key's Google Cloud IP restrictions block this server. Verify the allowed server egress addresses without changing your browser key.";
        else if(reasons.has("API_KEY_INVALID")||info?.error?.status==="UNAUTHENTICATED")message="Google rejected the server Routes key as invalid. Replace GOOGLE_MAPS_ROUTES_API_KEY through Replit Secrets with a valid separate server credential.";
        lastCheck={status:"Google authorization blocked",message,updatedAt:new Date().toISOString()};
        throw new JourneyError(503,message+" Published agency timetables still work.");
      }
      if(response.status===429)throw new JourneyError(429,"Google's trip-planning quota was reached. Try later or browse the agency timetables.");
      if(response.status===400)throw new JourneyError(400,"Google could not plan that request. Check both locations, time and transit preferences.");
      throw new JourneyError(502,"Google trip planning is temporarily unavailable. Try again or use the published timetables.");
    }
    const result=await response.json() as {routes?:unknown[]};
    lastCheck={status:"working",updatedAt:new Date().toISOString()};
    const point=(p:any)=>p?.latLng?{lat:p.latLng.latitude,lon:p.latLng.longitude}:undefined;
    return {configured:true,provider:"Google Maps",
      message:result.routes?.length?"Transit journey information from Google Maps, not an official live arrival feed. Service and coverage can change.":"Google found no transit journey. Try nearby stations, a different time or fewer mode restrictions. This does not prove an agency has no service.",
      journeys:(result.routes||[]).slice(0,5).map((r:any,index:number)=>({
        id:String(index),durationSeconds:seconds(r.duration),distanceMeters:r.distanceMeters||0,shape:decodePolyline(r.polyline?.encodedPolyline||""),
        steps:(r.legs||[]).flatMap((leg:any)=>(leg.steps||[]).map((s:any)=>{
          const t=s.transitDetails,l=t?.transitLine;
          return {mode:s.travelMode||"WALK",instruction:s.navigationInstruction?.instructions||t?.headsign||"Continue",
            durationSeconds:seconds(s.staticDuration),line:l?.nameShort||l?.name,agency:l?.agencies?.map((a:any)=>a.name).join(", "),
            agencies:(l?.agencies||[]).map((a:any)=>({name:a.name||"Transit agency",url:/^https?:\/\//i.test(a.uri||"")?a.uri:undefined})),
            departureStop:t?.stopDetails?.departureStop?.name,arrivalStop:t?.stopDetails?.arrivalStop?.name,
            departureTime:t?.stopDetails?.departureTime,arrivalTime:t?.stopDetails?.arrivalTime,
            start:point(t?.stopDetails?.departureStop?.location||s.startLocation),end:point(t?.stopDetails?.arrivalStop?.location||s.endLocation)};
        })),
      }))};
  }catch(error){
    if(error instanceof JourneyError)throw error;
    throw new JourneyError(502,"Google trip planning timed out or returned an unreadable response. Please try again; agency timetables are still available.");
  }finally{inFlight--;}
}
