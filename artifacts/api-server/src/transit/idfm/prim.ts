import { pool, type PoolClient } from "@workspace/db";
import type { TransitStop } from "../types";
import { idfmEnabled } from "./model";
import { fetchPrimStop } from "./prim-client";
import { parsePrim, primReference, primEnabled, PRIM_DAILY_LIMIT, PRIM_SOURCE } from "./prim-model";
import { reservePrimRequest } from "./prim-budget";
const LOCK=735119,STATUS="idfm:prim-status";
type Result=ReturnType<typeof parsePrim>;
function attach(stop:TransitStop,result:Result|undefined,message:string,checkedAt?:string){
  const now=Date.now(),rows=(result?.arrivals||[]).filter(r=>Date.parse(r.expiresAt!)>now&&Date.parse(r.scheduledAt)>=now-15_000&&stop.routes.some(s=>s.id===r.routeId))
    .map(r=>({...r,minutes:Math.max(0,Math.ceil((Date.parse(r.scheduledAt)-now)/60000))}));
  const effectiveMessage=result?.arrivals.length&&!rows.length?"PRIM predictions expired. Published schedules remain available.":
    message.replace(/^\d+ fresh PRIM predictions\./,`${rows.length} fresh PRIM predictions.`);
  return {...stop,arrivals:[...rows,...stop.arrivals].sort((a,b)=>a.minutes-b.minutes).slice(0,36),
    alerts:[...stop.alerts,...(result?.alerts||[]).filter(a=>Date.parse(a.expiresAt)>now)],
    idfm:stop.idfm?{...stop.idfm,realtimeStatus:effectiveMessage,realtimeCheckedAt:checkedAt,
      realtimeUrl:PRIM_SOURCE,realtimeLicense:"ODbL notice; catalog also lists Licence Mobilités — see publisher terms"}:undefined};
}
/** Only selected stop details call PRIM: never fan out over Nearby or map results. */
export async function enrichPrim(stop:TransitStop):Promise<TransitStop>{
  if(!idfmEnabled()||!primEnabled())
    return attach(stop,undefined,"PRIM is disabled, unconfigured or awaiting public license confirmation. Published schedules only.");
  const ref=primReference(stop);
  if(!ref)return attach(stop,undefined,"No verified PRIM reference for this stop. Published schedules only.");
  let client:PoolClient|undefined,locked=false;
  let cached:Result|undefined;
  const cacheId=`idfm:prim-stop:${stop.id}`,now=Date.now();
  try{
    client=await pool.connect();
    await client.query("SET statement_timeout='2s'; SET lock_timeout='250ms'");
    const existing=(await client.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[cacheId])).rows[0]?.data;
    cached=existing?.result;
    if(existing?.nextAttemptAt>now)return attach(stop,cached,existing.message,existing.checkedAt);
    locked=(await client.query("SELECT pg_try_advisory_lock($1) AS locked",[LOCK])).rows[0].locked;
    if(!locked)return attach(stop,cached,"Another PRIM check is in progress; published schedules remain available.");
    const status=(await client.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[STATUS])).rows[0]?.data;
    if(status?.nextAttemptAt>now)return attach(stop,cached,"PRIM request pacing/backoff active. Published schedules remain available.",status.checkedAt);
    const consumed=await reservePrimRequest(client,new Date(now).toISOString().slice(0,10));
    if(consumed===undefined)return attach(stop,cached,`PRIM local daily request limit (${PRIM_DAILY_LIMIT}) reached. Published schedules remain available.`);
    const save=async(id:string,data:object)=>client!.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data)
      VALUES($1,'live','idfm',$2::jsonb) ON CONFLICT(mode,id) DO UPDATE SET data=$2::jsonb,updated_at=now()`,[id,JSON.stringify(data)]);
    // Persist pacing before network I/O, so failures/restarts cannot cause a burst.
    await save(STATUS,{checkedAt:new Date(now).toISOString(),message:"PRIM check in progress",nextAttemptAt:now+15_000});
    let result:Result|undefined,message:string,backoff=60_000,globalBackoff=15_000;
    try{
      const allowedRefs=new Set([ref]);
      if(ref.startsWith("STIF:StopArea:")){
        const children=await client.query(`SELECT data FROM transit_stops WHERE mode='live' AND agency='idfm' AND data->>'parent'=$1 ORDER BY id LIMIT 128`,[stop.rawId||stop.id.slice(5)]);
        for(const child of children.rows){const mapped=primReference(child.data);if(mapped)allowedRefs.add(mapped);}
      }
      result=parsePrim(await fetchPrimStop(ref),stop,ref,Date.now(),allowedRefs);message=result.message;
    }catch(error){
      const candidate=error instanceof Error?error.message:"";
      message=/^PRIM (?:HTTP \d{3}|response |reports )/.test(candidate)?candidate:"PRIM request failed or timed out";
      if(/HTTP (401|403|429)/.test(message))globalBackoff=backoff=3600_000;
      else {backoff=5*60_000;if(!message.startsWith("PRIM reports"))globalBackoff=backoff;}
      message+=". Published schedules remain available.";
    }
    const checkedAt=new Date().toISOString();
    await save(cacheId,{result:result||cached,message,checkedAt,nextAttemptAt:Date.now()+backoff});
    await save(STATUS,{checkedAt,message,nextAttemptAt:Date.now()+globalBackoff,used:consumed,
      lastSuccess:result?checkedAt:status?.lastSuccess});
    // Retain only a bounded recent working cache, not a historical live database.
    await client.query(`DELETE FROM transit_feed_snapshots WHERE (mode,id) IN(
      SELECT mode,id FROM transit_feed_snapshots WHERE mode='live' AND agency='idfm'
      AND (id LIKE 'idfm:prim-stop:%' OR id LIKE 'idfm:prim-budget:%')
      AND updated_at<now()-interval '2 days' ORDER BY updated_at LIMIT 50)`);
    return attach(stop,result||cached,message,checkedAt);
  }catch{return attach(stop,cached,"PRIM check unavailable. Published schedules remain available.");}
  finally{
    if(client){let failed=false;try{
      await client.query("RESET statement_timeout; RESET lock_timeout");
      if(locked)await client.query("SELECT pg_advisory_unlock($1)",[LOCK]);
    }catch{failed=true;}client.release(failed?new Error("PRIM connection reset failed"):undefined);}
  }
}
