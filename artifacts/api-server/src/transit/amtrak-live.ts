import { pool, db, feedSnapshots } from "@workspace/db";
import { stopTimesMode } from "./generations";
import { normalizeAmtraker, matchAmtrakTrain, observationFresh,trainPosition, type AmtrakTrain,type PublishedTrain } from "./amtrak-model";
import { logger } from "../lib/logger";

const ROOT="https://api.amtraker.com/v3/";
let trains:AmtrakTrain[]=[],error:string|undefined="Tracking has not been fetched",checkedAt:string|null=null;
let inFlight:Promise<void>|undefined,nextAttempt=0,failures=0;
let candidates:{generation:string;trains:PublishedTrain[]}|undefined;
async function readJson(path:"trains"|"stations") {
  const r=await fetch(ROOT+path,{headers:{"User-Agent":"Transtop/1.0 (Amtrak tracking integration)","Accept":"application/json"},
    signal:AbortSignal.timeout(15_000),redirect:"error"});
  if(!r.ok)throw new Error(`Amtraker HTTP ${r.status}`);
  if(!r.body)throw new Error("Amtraker response has no body");
  const chunks:Uint8Array[]=[];let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.length;if(bytes>10*1024*1024)throw new Error("Amtraker response exceeds size limit");chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function publishedTrains():Promise<PublishedTrain[]> {
  const {rows:v}=await pool.query("SELECT data->>'stopTimesMode' AS generation FROM transit_feed_snapshots WHERE mode='live' AND id='amtrak:static'");
  const generation=v[0]?.generation||"none";
  if(candidates&&candidates.generation===generation)return candidates.trains;
  const {rows}=await pool.query(`SELECT t.id,t.data AS trip,r.data AS route,c.data AS calendar,
    (SELECT json_agg(json_build_object('code',st.data->>'stop_id','arrival',st.arrival_seconds,'departure',st.departure_seconds,'pickup',st.data->>'pickup_type') ORDER BY st.sequence)
      FROM transit_stop_times st WHERE st.mode=${stopTimesMode("'amtrak'")} AND st.trip_id=t.id) AS calls
    FROM transit_trips t JOIN transit_routes r ON r.mode='live' AND r.id='amtrak:'||(t.data->>'route_id')
    LEFT JOIN transit_calendars c ON c.mode='live' AND c.id='amtrak:'||(t.data->>'service_id')
    WHERE t.mode='live' AND t.agency='amtrak'`);
  const {rows:ex}=await pool.query("SELECT data FROM transit_calendar_exceptions WHERE mode='live' AND agency='amtrak'");
  candidates={generation,trains:rows.map(row=>({...row,calls:row.calls||[],exceptions:ex.filter(e=>e.data.service_id===row.trip.service_id).map(e=>e.data)}))};
  return candidates.trains;
}
export function pollAmtrak() {
  if(inFlight)return inFlight;
  if(Date.now()<nextAttempt)return Promise.resolve();
  inFlight=(async()=>{
    const lock=await pool.connect();let owned=false;
    try {
      owned=(await lock.query("SELECT pg_try_advisory_lock(721051) AS locked")).rows[0].locked;
      if(!owned){
        const {rows}=await lock.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='amtrak:tracking'");
        if(rows[0]){trains=rows[0].data.trains||[];error=rows[0].data.error;checkedAt=rows[0].data.checkedAt;}
        return;
      }
      const {rows:cached}=await lock.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='amtrak:tracking'");
      if(cached[0]?.data.nextAttempt>Date.now()){
        trains=cached[0].data.trains||[];error=cached[0].data.error;checkedAt=cached[0].data.checkedAt;
        nextAttempt=cached[0].data.nextAttempt;return;
      }
      try {
        const [data,meta,published]=await Promise.all([readJson("trains"),readJson("stations"),publishedTrains()]);
        if(!meta||typeof meta!=="object"||Array.isArray(meta))throw new Error("Amtraker station metadata changed format");
        trains=normalizeAmtraker(data,meta).map(t=>matchAmtrakTrain(t,published));
        error=undefined;failures=0;nextAttempt=Date.now()+55_000;
      }catch(e){
        error=e instanceof Error?e.message:"Amtraker unavailable";
        failures++;nextAttempt=Date.now()+Math.min(15*60_000,60_000*2**Math.min(failures,4));
        logger.warn({error},"Amtraker unavailable; live observations withheld");
      }
      checkedAt=new Date().toISOString();
      const data={trains,error,checkedAt,nextAttempt};
      await db.insert(feedSnapshots).values({id:"amtrak:tracking",agency:"amtrak",mode:"live",data})
        .onConflictDoUpdate({target:[feedSnapshots.mode,feedSnapshots.id],set:{data,updatedAt:new Date()}});
    }finally{if(owned)await lock.query("SELECT pg_advisory_unlock(721051)");lock.release();}
  })().finally(()=>{inFlight=undefined;});
  return inFlight;
}
export function amtrakTrains(){return trains;}
export function amtrakAvailable(){return !error;}
export function amtrakPositions(){return error?[]:trains.flatMap(t=>{const p=trainPosition(t);return p?[p]:[];});}
export function amtrakHealth(){
  const fresh=error?0:trains.filter(t=>observationFresh(t)).length;
  return {fresh,total:trains.length,unresolved:trains.filter(t=>!t.matched).length,error,checkedAt,
    updatedAt:trains.map(t=>t.updatedAt).filter((s):s is string=>!!s&&Date.parse(s)<=Date.now()+30_000).sort().at(-1)||null};
}
