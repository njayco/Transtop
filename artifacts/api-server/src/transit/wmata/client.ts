import { pool } from "@workspace/db";

export const WMATA_DOCS="https://developer.wmata.com/";
export const WMATA_TERMS="https://developer.wmata.com/license";
export const WMATA_CREDIT="Transit data provided by WMATA. Transtop is not affiliated with or endorsed by WMATA. Data supplied as-is.";
export const operations={
  static:"rail-bus-gtfs-static.zip",
  "bus-predictions":"bus-gtfsrt-tripupdates.pb",
  "rail-predictions":"rail-gtfsrt-tripupdates.pb",
  "bus-alerts":"bus-gtfsrt-alerts.pb",
  "rail-alerts":"rail-gtfsrt-alerts.pb",
  "bus-vehicles":"bus-gtfsrt-vehiclepositions.pb",
} as const;
export type Operation=keyof typeof operations;
export const sourceUrl=(op:Operation)=>`https://api.wmata.com/gtfs/${operations[op]}`;
export const operationFor=(url:string)=> (Object.keys(operations) as Operation[]).find(op=>sourceUrl(op)===url);
export const enabled=()=>process.env.WMATA_ENABLED!=="false";
/** The configured value is an owner-verified allowance, not an inferred entitlement.
 * At most 5,000/day total; dev reserves 10%, production 90%, each in its own DB.
 * Other applications using this key are outside this reservation.
 */
export function dailyLimit(env=process.env) {
  const verified=Number(env.WMATA_VERIFIED_DAILY_LIMIT);
  return Number.isSafeInteger(verified)&&verified>=10?
    Math.floor(Math.min(5000,verified)*(env.NODE_ENV==="production"?.9:.1)):0;
}
export function setupStatus() {
  return !enabled()?"disabled":!process.env.WMATA_API_KEY?"credential required":
    !dailyLimit()?"quota confirmation required":"configured";
}
export class WmataError extends Error {
  constructor(public state:string,message:string){super(message);}
}
export interface Budget {
  reserve(op:Operation,now:number,limit:number):Promise<boolean>;
  block(op:Operation|"all",until:number,state?:string):Promise<void>;
  status?(op:Operation,now:number):Promise<string|undefined>;
}
export const budget:Budget={
  async reserve(op,now,limit){
    // One atomic ledger covers all operations and replicas, and survives restarts.
    const day=new Date(now).toISOString().slice(0,10);
    return !!(await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
      VALUES('live','wmata:budget','wmata',jsonb_build_object('day',$1::text,'used',1,'next',$2::bigint+6000))
      ON CONFLICT(mode,id) DO UPDATE SET data=jsonb_build_object('day',$1::text,
        'used',CASE WHEN transit_feed_snapshots.data->>'day'=$1 THEN (transit_feed_snapshots.data->>'used')::int+1 ELSE 1 END,
        'next',$2::bigint+6000),updated_at=now()
      WHERE ((transit_feed_snapshots.data->>'day')<>$1 OR (transit_feed_snapshots.data->>'used')::int<$3)
        AND COALESCE((transit_feed_snapshots.data->>'next')::bigint,0)<=$2
        AND NOT EXISTS(SELECT 1 FROM transit_feed_snapshots b WHERE b.mode='live'
          AND b.id IN('wmata:block:all',$4) AND (b.data->>'until')::bigint>$2)
      RETURNING id`,[day,now,limit,`wmata:block:${op}`])).rows.length;
  },
  async block(op,until,state="limited"){
    await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
      VALUES('live',$1,'wmata',jsonb_build_object('until',$2::bigint,'state',$3::text))
      ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`,[`wmata:block:${op}`,until,state]);
  },
  async status(op,now){
    const row=(await pool.query(`SELECT data->>'state' AS state FROM transit_feed_snapshots
      WHERE mode='live' AND id IN('wmata:block:all',$1) AND (data->>'until')::bigint>$2
      ORDER BY (data->>'until')::bigint DESC LIMIT 1`,[`wmata:block:${op}`,now])).rows[0];
    return row?row.state||"limited":undefined;
  },
};
export function createClient(deps:{fetch:typeof fetch;key:()=>string|undefined;now:()=>number;
  enabled:()=>boolean;limit:()=>number;budget:Budget;sleep?:(ms:number)=>Promise<void>}) {
  const pending=new Map<Operation,Promise<Buffer>>();
  async function download(op:Operation,authorizedCheck=false):Promise<Buffer> {
    if(!Object.hasOwn(operations,op))throw new WmataError("invalid","Unsupported WMATA operation");
    if(!deps.enabled())throw new WmataError("disabled","WMATA requests disabled");
    const key=deps.key();
    if(!key)throw new WmataError("credential required","Add the server-only WMATA_API_KEY");
    const limit=deps.limit()||(authorizedCheck?5:0);
    if(!limit)throw new WmataError("quota confirmation required","Confirm the account allowance and set WMATA_VERIFIED_DAILY_LIMIT before automatic requests");
    const existing=pending.get(op);if(existing)return existing;
    const work=(async()=>{
      const blocked=await deps.budget.status?.(op,deps.now());
      if(blocked)throw new WmataError(blocked,blocked==="access denied"?
        "WMATA denied this product; check the saved key and subscribed GTFS product after backoff":
        blocked==="throttled"?"WMATA throttled requests; retry after backoff":"WMATA product backoff active; schedules remain available");
      let reserved=await deps.budget.reserve(op,deps.now(),limit);
      if(!reserved){
        await (deps.sleep||((ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))))(6100);
        reserved=await deps.budget.reserve(op,deps.now(),limit);
      }
      if(!reserved)
        throw new WmataError("limited","WMATA shared allowance, backoff or request spacing reached; schedules remain available");
      try {
        const response=await deps.fetch(sourceUrl(op),{headers:{api_key:key,"User-Agent":"Transtop/1.0"},
          redirect:"error",signal:AbortSignal.timeout(op==="static"?120000:15000)});
        if(!response.ok){
          const denied=response.status===401||response.status===403;
          const retry=response.headers.get("retry-after"),seconds=Number(retry);
          const delay=retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-deps.now()):60000;
          const until=deps.now()+Math.min(3600_000,Math.max(60_000,Number.isFinite(delay)?delay:60000));
          await deps.budget.block(response.status===429?"all":op,denied?deps.now()+3600_000:until,
            denied?"access denied":response.status===429?"throttled":"unavailable");
          throw new WmataError(denied?"access denied":response.status===429?"throttled":"unavailable",
            denied?"WMATA denied this product; check the saved key and subscribed GTFS product":
              response.status===429?"WMATA throttled requests; retry after backoff":"WMATA product temporarily unavailable");
        }
        if(!response.body)throw new Error();
        const cap=op==="static"?100*1024*1024:12*1024*1024;
        const chunks:Uint8Array[]=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;if(size>cap)throw new Error();chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);
        // Never persist an echoed credential, including an upstream HTML error.
        if(bytes.includes(Buffer.from(key)))throw new Error();
        if(op==="static"&&(bytes[0]!==0x50||bytes[1]!==0x4b))throw new Error();
        return bytes;
      }catch(error){
        if(error instanceof WmataError)throw error;
        await deps.budget.block(op,deps.now()+60_000,"unavailable");
        throw new WmataError("unavailable","WMATA connection or bounded response validation failed");
      }
    })().finally(()=>pending.delete(op));
    pending.set(op,work);return work;
  }
  return {download};
}
const client=createClient({fetch:(...args)=>fetch(...args),key:()=>process.env.WMATA_API_KEY,
  now:Date.now,enabled,limit:dailyLimit,budget});
export const download=client.download;
