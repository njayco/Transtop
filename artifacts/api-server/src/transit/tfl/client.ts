import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

export class TflError extends Error {
  constructor(message:string, public state="unavailable") { super(message); }
}
export const configured=()=>!!process.env.TFL_API_KEY&&process.env.TFL_ENABLED!=="false";
export const CREDIT="Powered by TfL Open Data · Data provided by Transport for London";
export const TERMS="https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service";
export const COVERAGE="London buses, Underground, DLR, Elizabeth line and current London Overground lines where TfL supplies predictions. Not all National Rail or UK transport. No GPS tracking or bulk timetables.";
export const REQUEST_SPACING=3600;
export interface CacheEntry {value:any;expires:number;fetchedAt?:string}
export interface Store {
  get(key:string):Promise<CacheEntry|undefined>;
  put(key:string,entry:CacheEntry):Promise<void>;
  reserve(now:number):Promise<boolean>;
  block(until:number):Promise<void>;
  lock?(key:string):Promise<(()=>Promise<void>)|undefined>;
}
/** One shared next-request time, not fixed minute buckets which can double-burst.
 * 3,600ms spacing caps replicas sharing this DB at 17/minute. Reserving half of
 * a 34/minute total for each of dev/production also covers their separate DBs.
 * The public 50/min baseline is verified; account-specific 500/min is NOT assumed.
 */
const store:Store={
  async lock(key){
    // Short DB statements only: never hold a pool connection across HTTP/waits.
    // Otherwise many distinct cache misses can occupy every connection and deadlock
    // their own cache reads. Leases survive crashed replicas and expire automatically.
    const lease=key.replace("tfl:cache:","tfl:lease:"),owner=randomUUID(),now=Date.now();
    const acquired=(await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
      VALUES('live',$1,'tfl',jsonb_build_object('owner',$2::text,'expires',$3::bigint+45000))
      ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()
      WHERE (transit_feed_snapshots.data->>'expires')::bigint<=$3::bigint RETURNING id`,
      [lease,owner,now])).rows.length;
    if(!acquired)return;
    return async()=>{await pool.query("DELETE FROM transit_feed_snapshots WHERE mode='live' AND id=$1 AND data->>'owner'=$2",[lease,owner]);};
  },
  async get(key){return (await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[key])).rows[0]?.data;},
  async put(key,entry){await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data) VALUES('live',$1,'tfl',$2)
    ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`,[key,entry]);
    await pool.query(`DELETE FROM transit_feed_snapshots WHERE mode='live' AND id IN (
      SELECT id FROM transit_feed_snapshots WHERE mode='live' AND id LIKE 'tfl:cache:%'
      AND (data->>'expires')::bigint<$1 LIMIT 10)`,[Date.now()-86400000]);
    await pool.query(`DELETE FROM transit_feed_snapshots WHERE mode='live' AND id IN (
      SELECT id FROM transit_feed_snapshots WHERE mode='live' AND id LIKE 'tfl:cache:%'
      ORDER BY updated_at DESC OFFSET 500 LIMIT 10)`);},
  async reserve(now){return !!(await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
    VALUES('live','tfl:rate','tfl',jsonb_build_object('next',$1::bigint+$2::int))
    ON CONFLICT(mode,id) DO UPDATE SET data=jsonb_build_object('next',$1::bigint+$2::int),updated_at=now()
    WHERE (transit_feed_snapshots.data->>'next')::bigint<=$1::bigint RETURNING id`,[now,REQUEST_SPACING])).rows.length;},
  async block(until){await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
    VALUES('live','tfl:rate','tfl',jsonb_build_object('next',$1::bigint))
    ON CONFLICT(mode,id) DO UPDATE SET data=jsonb_build_object('next',GREATEST(
      (transit_feed_snapshots.data->>'next')::bigint,$1::bigint)),updated_at=now()`,[until]);},
};
export function allowedPath(path:string) {
  return /^(Line\/Mode\/(?:bus|tube|dlr|elizabeth-line|overground)(?:,(?:bus|tube|dlr|elizabeth-line|overground))*|Line\/[a-z0-9-]{1,60}(?:,[a-z0-9-]{1,60}){0,29}\/Status|Line\/[a-z0-9-]{1,60}\/Route\/Sequence\/(?:inbound|outbound)|StopPoint(?:\/Search|\/[A-Za-z0-9]{5,40}(?:,[A-Za-z0-9]{5,40}){0,11}(?:\/Arrivals)?)?)$/.test(path);
}
const paramsAllowed=new Set(["query","modes","maxResults","lat","lon","radius","stopTypes","page"]);
export function createClient(deps:{store:Store;fetch:typeof fetch;key:()=>string|undefined;enabled:()=>boolean;now:()=>number;sleep:(ms:number)=>Promise<void>}) {
  const inflight=new Map<string,Promise<any>>();
  let lastSuccess:string|undefined,lastError="",state="configured",blockedUntil=0;
  function health(){
    return {status:!deps.enabled()?"setup required":blockedUntil>deps.now()?state:lastError?state:
      lastSuccess&&deps.now()-Date.parse(lastSuccess)>300000?"stale":lastSuccess?"healthy":"configured",
      message:!deps.enabled()?"TfL disabled or server credential missing.":lastError||COVERAGE,
      lastSuccess,attribution:CREDIT,url:TERMS,timezone:"Europe/London",limit:17};
  }
  async function request(path:string,params:Record<string,string|number>={},ttl=86400000) {
    if(!allowedPath(path)||Object.keys(params).some(k=>!paramsAllowed.has(k))||
      Object.values(params).some(v=>String(v).length>180))throw new TflError("Invalid TfL request");
    if(!deps.enabled()||!deps.key())throw new TflError("TfL disabled or server credential missing.","setup required");
    const url=new URL(path,"https://api.tfl.gov.uk/");
    for(const [k,v] of Object.entries(params).sort())url.searchParams.set(k,String(v));
    const key="tfl:cache:"+createHash("sha256").update(url.toString()).digest("hex");
    const pending=inflight.get(key);if(pending)return pending;
    let previous:CacheEntry|undefined;
    const work=(async()=>{
      const cached=await deps.store.get(key);
      previous=cached;
      if(cached&&cached.expires>deps.now()){
        if(cached.fetchedAt&&(!lastSuccess||cached.fetchedAt>lastSuccess))lastSuccess=cached.fetchedAt;
        return cached.value;
      }
      if(blockedUntil>deps.now())throw new TflError(lastError,state);
      let release:(()=>Promise<void>)|undefined;
      if(deps.store.lock){
        for(let n=0;n<8;n++){
          release=await deps.store.lock(key);if(release)break;
          await deps.sleep(1800);
          const shared=await deps.store.get(key);
          if(shared&&shared.expires>deps.now()){lastSuccess=shared.fetchedAt||lastSuccess;return shared.value;}
        }
        if(!release)throw new TflError("TfL request already in progress; retry shortly.","quota-limited");
      }
      try{
      // A different replica may have completed between the first read and acquiring the lock.
      const shared=await deps.store.get(key);
      if(shared&&shared.expires>deps.now()){lastSuccess=shared.fetchedAt||lastSuccess;return shared.value;}
      // A bounded wait smooths simultaneous metadata loads. No retry of HTTP failures.
      let reserved=false;
      for(let n=0;n<8;n++){if(await deps.store.reserve(deps.now())){reserved=true;break;}await deps.sleep(1800);}
      if(!reserved)throw new TflError("TfL shared request allowance is busy; retry shortly. Cached map data remain available.","quota-limited");
      try{
        const res=await deps.fetch(url,{headers:{app_key:deps.key()!,"User-Agent":"Transtop/1.0"},
          redirect:"error",signal:AbortSignal.timeout(10000)});
        if(!res.ok){
          state=res.status===429?"quota-limited":"unavailable";
          lastError=res.status===401||res.status===403?"TfL access denied. Check the saved server key and product access in the TfL portal.":
            res.status===429?"TfL rate limit reached; retry later.":"TfL data unavailable for this request; no replacement times are generated.";
          const retry=res.headers.get("retry-after"),seconds=Number(retry);
          const delay=retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-deps.now()):60000;
          blockedUntil=deps.now()+Math.min(900000,Math.max(30000,Number.isFinite(delay)?delay:60000));
          if(res.status===429||res.status===401||res.status===403||res.status>=500)await deps.store.block(blockedUntil);
          throw new TflError(lastError,state);
        }
        if(!res.body)throw new Error();
        const reader=res.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
          if(size>4_000_000){await reader.cancel();throw new Error();}chunks.push(value);}}
        finally{reader.releaseLock();}
        // Remove credential echoes even if an upstream error is incorrectly returned as 200.
        const clean=(v:any):any=>typeof v==="string"?v.replaceAll(deps.key()!,"[redacted]"):
          Array.isArray(v)?v.map(clean):v&&typeof v==="object"?Object.fromEntries(Object.entries(v)
            .filter(([k])=>!/(app.?key|authorization|subscription.?key)/i.test(k)).map(([k,x])=>[k,clean(x)])):v;
        const value=clean(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        await deps.store.put(key,{value,expires:deps.now()+ttl,fetchedAt:new Date(deps.now()).toISOString()});
        lastSuccess=new Date(deps.now()).toISOString();lastError="";state="healthy";blockedUntil=0;
        return value;
      }catch(err){
        if(err instanceof TflError)throw err;
        state="unavailable";lastError="TfL connection or response failed. Cached map data and other providers remain available.";
        blockedUntil=deps.now()+30000;await deps.store.block(blockedUntil);
        throw new TflError(lastError,state);
      }
      }finally{await release?.();}
    })().catch(err=>{if(err instanceof TflError){lastError=err.message;state=err.state;}else{
      lastError="TfL shared cache is unavailable.";state="unavailable";throw new TflError(lastError);}
      // Only slow-changing metadata can be retained during an outage, explicitly stale.
      // Never serve an expired prediction/status cache as live, or bypass disable/missing key.
      if(ttl>=3600000&&previous&&previous.expires>deps.now()-7*86400000){
        state="stale";lastError=`Cached TfL metadata retained; ${lastError}`;
        lastSuccess=previous.fetchedAt||lastSuccess;return previous.value;
      }
      throw err;
    }).finally(()=>inflight.delete(key));
    inflight.set(key,work);return work;
  }
  return {request,health};
}
const client=createClient({store,fetch:(...args)=>fetch(...args),key:()=>process.env.TFL_API_KEY,enabled:configured,now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))});
export const request=client.request;
export const health=client.health;
export const safeMessage=(err:unknown)=>err instanceof TflError?err.message:"TfL is temporarily unavailable; other sources remain usable.";
