import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, pool, rideSessions, locationSamples, riderReports, trips } from "@workspace/db";
import { StartRideBody, SubmitSampleBody, SubmitReportBody } from "@workspace/api-zod";
import { allStops } from "./service";
import { project, tripShape, SAMPLE_FRESH_MS } from "./estimator";
import { distance } from "./types";
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const limits=new Map<string,{count:number;until:number}>();
export function contributionLimit(req:Request,res:Response,next:NextFunction) {
  const key=req.ip||"unknown",now=Date.now();
  const l=limits.get(key);
  if(!l||l.until<now)limits.set(key,{count:1,until:now+60000});
  else if(++l.count>40){res.status(429).json({error:"Too many contributions. Please wait one minute."});return;}
  if(limits.size>10000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
  next();
}
function browserId(req:Request,res:Response) {
  const cookie=req.headers.cookie?.split(";").map(s=>s.trim()).find(s=>s.startsWith("transtop-device="))?.split("=")[1];
  if(cookie&&/^[a-f0-9]{64}$/.test(cookie))return cookie;
  const id=randomBytes(32).toString("hex");
  res.cookie("transtop-device",id,{httpOnly:true,secure:true,sameSite:"strict",maxAge:86400000,path:"/api/transit"});
  return id;
}
export async function start(req:Request,res:Response):Promise<void> {
  const parsed=StartRideBody.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Valid ride details and consent required"});return;}
  const v=parsed.data;
  if(!v.consent){res.status(400).json({error:"Explicit contribution consent is required"});return;}
  const stop=(await allStops(v.mode)).find(s=>s.id===v.stopId&&s.routes.some(r=>r.id===v.routeId));
  if(!stop||v.routeId.split(":")[0]!==v.agency){res.status(400).json({error:"Boarding stop, agency and route do not match"});return;}
  let tripId:string|undefined;
  if(v.tripId) {
    const [trip]=await db.select().from(trips).where(and(eq(trips.mode,v.mode),eq(trips.id,v.tripId)));
    if(!trip||`${trip.agency}:${trip.data.route_id}`!==v.routeId){res.status(400).json({error:"Trip does not match route"});return;}
    // Do not associate an opposite-direction selection with the supplied trip.
    const direction=v.direction==="Downtown"||v.direction==="Inbound"?"1":"0";
    if(trip.data.direction_id!==direction){res.status(400).json({error:"Trip does not match selected direction"});return;}
    tripId=trip.id;
  }
  const allowed=stop.type==="rail"?["Inbound","Outbound"]:["Uptown","Downtown"];
  if(!allowed.includes(v.direction)){res.status(400).json({error:"Invalid direction"});return;}
  const contributorHash=hash(browserId(req,res)), id=randomUUID(),token=randomBytes(32).toString("hex");
  const expiresAt=new Date(Date.now()+2*3600000);
  // One active contribution per browser pseudonym. Starting again revokes the old capability.
  await db.transaction(async tx=>{
    await tx.update(rideSessions).set({active:false}).where(eq(rideSessions.contributorHash,contributorHash));
    await tx.insert(rideSessions).values({id,tokenHash:hash(token),contributorHash,mode:v.mode,agency:v.agency,
      routeId:v.routeId,direction:v.direction,stopId:v.stopId,tripId:tripId||null,expiresAt});
  });
  res.status(201).json({id,token,expiresAt:expiresAt.toISOString(),status:"active"});
}
export async function authorize(req:Request,res:Response,next:NextFunction):Promise<void> {
  const token=req.get("x-ride-token"),id=String(req.params.id);
  if(!token||!/^[a-f0-9]{64}$/.test(token)){res.status(401).json({error:"Ride capability required"});return;}
  const [s]=await db.select().from(rideSessions).where(eq(rideSessions.id,id));
  if(!s||!timingSafeEqual(Buffer.from(hash(token),"hex"),Buffer.from(s.tokenHash,"hex"))){res.status(401).json({error:"Invalid ride capability"});return;}
  // Revocation is idempotent even after expiry.
  if(req.method!=="DELETE"&&(!s.active||s.expiresAt.getTime()<Date.now())){
    res.status(410).json({error:"Ride ended or expired. Start a new ride to contribute."});return;
  }
  res.locals.ride=s;next();
}
export async function end(_req:Request,res:Response):Promise<void> {
  await db.update(rideSessions).set({active:false}).where(eq(rideSessions.id,res.locals.ride.id));
  res.json({status:"ended"});
}
export async function sample(req:Request,res:Response):Promise<void> {
  const parsed=SubmitSampleBody.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid location sample or GPS accuracy above 100m"});return;}
  const v=parsed.data,at=Date.parse(v.timestamp),now=Date.now(),ride=res.locals.ride;
  if(!Number.isFinite(at)||at<now-SAMPLE_FRESH_MS||at>now+10000||v.accuracy<=0){
    res.status(400).json({error:"Sample must be recent and have measured GPS accuracy"});return;
  }
  const last=(await db.select().from(locationSamples).where(eq(locationSamples.rideId,ride.id)).orderBy(desc(locationSamples.timestamp)).limit(1))[0];
  if(last){
    const dt=(at-last.timestamp.getTime())/1000;
    if(dt<5){res.status(429).json({error:"Duplicate or too-frequent sample"});return;}
    const speed=distance(last.lat,last.lon,v.lat,v.lon)/dt;
    if(speed>80){res.status(400).json({error:"Implausible GPS jump rejected"});return;}
  }
  // If a trip is ambiguous, keep reports but do not collect unmatchable raw GPS.
  if(!ride.tripId){res.status(202).json({status:"No identifiable trip; raw location not stored and no community ETA published"});return;}
  const shape=await tripShape(ride.mode,ride.tripId);
  if(!shape||shape.length<2){res.status(202).json({status:"Trip shape unavailable; location not stored"});return;}
  const progress=project(v.lat,v.lon,shape);
  if(progress.distance>150+v.accuracy){res.status(400).json({error:"Location is too far from the selected trip shape"});return;}
  if(last&&progress.progress<last.progress-100){res.status(400).json({error:"Movement contradicts selected trip direction"});return;}
  await db.transaction(async tx=>{
    // Lock and recheck inside the write transaction so ending a ride cannot race
    // authorization and allow a sample to be written after revocation.
    const locked=await tx.execute(sql`SELECT active,expires_at FROM transit_ride_sessions WHERE id=${ride.id} FOR UPDATE`);
    const current=locked.rows[0] as any;
    if(!current?.active||new Date(current.expires_at).getTime()<Date.now())throw new Error("Ride has ended");
    await tx.insert(locationSamples).values({id:randomUUID(),rideId:ride.id,lat:v.lat,lon:v.lon,accuracy:v.accuracy,progress:progress.progress,timestamp:new Date(at)});
    await tx.update(rideSessions).set({lastSampleAt:new Date(at)}).where(eq(rideSessions.id,ride.id));
  });
  res.status(202).json({status:"accepted"});
}
export async function report(req:Request,res:Response):Promise<void> {
  const p=SubmitReportBody.safeParse(req.body),ride=res.locals.ride;
  if(!p.success){res.status(400).json({error:"Invalid report"});return;}
  const s=(await allStops(ride.mode)).find(s=>s.id===p.data.stopId&&s.routes.some(r=>r.id===ride.routeId));
  if(!s){res.status(400).json({error:"Report stop is not on the selected route"});return;}
  const duplicates=await db.select().from(riderReports).where(and(eq(riderReports.rideId,ride.id),eq(riderReports.kind,p.data.kind),gt(riderReports.createdAt,new Date(Date.now()-60000)))).limit(1);
  if(duplicates.length){res.status(429).json({error:"This report was already submitted recently"});return;}
  await db.transaction(async tx=>{
    const locked=await tx.execute(sql`SELECT active,expires_at FROM transit_ride_sessions WHERE id=${ride.id} FOR UPDATE`);
    const current=locked.rows[0] as any;
    if(!current?.active||new Date(current.expires_at).getTime()<Date.now())throw new Error("Ride has ended");
    await tx.insert(riderReports).values({id:randomUUID(),rideId:ride.id,kind:p.data.kind,stopId:p.data.stopId});
  });
  res.status(202).json({status:"accepted"});
}
export async function cleanup() {
  // Raw samples and reports are kept for no longer than 24h (+ cleanup cadence).
  // Sessions without foreground updates do not count as fresh evidence after 90s.
  await pool.query("DELETE FROM transit_location_samples WHERE timestamp < now()-interval '24 hours'");
  await pool.query("DELETE FROM transit_rider_reports WHERE created_at < now()-interval '24 hours'");
  await pool.query("UPDATE transit_ride_sessions SET active=false WHERE expires_at<now()");
  await pool.query("DELETE FROM transit_ride_sessions WHERE expires_at<now()-interval '24 hours'");
  await pool.query("DELETE FROM transit_derived_estimates WHERE updated_at<now()-interval '5 minutes'");
}
