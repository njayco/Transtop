import { createHash } from "node:crypto";
import { Open } from "unzipper";
import { parse } from "csv-parse/sync";
import { pool } from "@workspace/db";
import { logger } from "../../lib/logger";
import { buildIbg, IBG_URL, IBG_ARTICLE, ibgProvider, sourceFor, type IbgData, type Row, type IbgPoint } from "./ibg-model";
import type { Provider } from "./providers";
import { IBG_COMMIT, IBG_SHA } from "./ibg-verification";
export { IBG_COMMIT, IBG_SHA } from "./ibg-verification";

const ROOT=`https://raw.githubusercontent.com/UTEL-UIUC/intercity-bus-gtfs/${IBG_COMMIT}/`;
let cached:IbgData|undefined,compiled:ReturnType<typeof buildIbg>|undefined,loaded=0;
export async function ibgDataset(){
  if(Date.now()-loaded>60000){
    const {rows}=await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='reference' AND id='ibg:dataset'");
    const next=rows[0]?.data as IbgData|undefined;
    if(next?.importedAt!==cached?.importedAt)compiled=undefined;
    cached=next;loaded=Date.now();
  }
  return cached;
}
export async function ibgCatalog(){
  const data=await ibgDataset();
  if(!data)return {routes:[],stops:[],coverageWarning:""};
  return compiled??=(buildIbg(data));
}
export async function ibgCompiled(){await ibgCatalog();return compiled;}
async function download(name:string,limit:number){
  const r=await fetch(ROOT+name,{signal:AbortSignal.timeout(60000),redirect:"error",
    headers:{"User-Agent":"Transtop/1.0 IBG reference dataset importer"}});
  if(!r.ok||!r.body)throw new Error("IBG download unavailable");
  const chunks:Uint8Array[]=[];let size=0;
  for await(const chunk of r.body){size+=chunk.length;if(size>limit)throw new Error("IBG download exceeds limit");chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export async function decodeIbg(bytes:Buffer,sourcesText:string):Promise<IbgData>{
  if(createHash("sha256").update(bytes).digest("hex")!==IBG_SHA)throw new Error("IBG archive checksum mismatch");
  const zip=await Open.buffer(bytes),tables:Record<string,Row[]>={};
  // Shapes are intentionally not imported: the research processing can replace
  // geometry with routing queries and snap stops. No verified road-path claim.
  for(const name of ["agency","routes","stops","trips","stop_times","calendar","calendar_dates"]){
    const f=zip.files.find(f=>f.path===`${name}.txt`);
    if(!f||f.uncompressedSize>2_000_000)throw new Error(`Invalid IBG ${name} table`);
    tables[name]=parse(await f.buffer(),{columns:true,bom:true,skip_empty_lines:true});
  }
  for(const [table,key] of [["agency","agency_id"],["routes","route_id"],["stops","stop_id"],["trips","trip_id"],["calendar","service_id"]]){
    if(tables[table].some(r=>!r[key])||new Set(tables[table].map(r=>r[key])).size!==tables[table].length)throw new Error(`Duplicate or missing IBG ${table} identifiers`);
  }
  const ids=(table:string,key:string)=>new Set(tables[table].map(r=>r[key]));
  const agencyIds=ids("agency","agency_id"),routeIds=ids("routes","route_id"),stopIds=ids("stops","stop_id"),tripIds=ids("trips","trip_id");
  const serviceIds=new Set([...tables.calendar,...tables.calendar_dates].map(r=>r.service_id));
  if(tables.routes.some(r=>!agencyIds.has(r.agency_id))||tables.trips.some(t=>!routeIds.has(t.route_id)||!serviceIds.has(t.service_id))||
    tables.stops.some(s=>!Number.isFinite(+s.stop_lat)||!Number.isFinite(+s.stop_lon)||Math.abs(+s.stop_lat)>90||Math.abs(+s.stop_lon)>180))
    throw new Error("IBG contains invalid route, calendar or coordinate references");
  const points=new Map<string,IbgPoint[]>();
  for(const p of tables.stop_times){
    if(!tripIds.has(p.trip_id)||!stopIds.has(p.stop_id)||!Number.isInteger(+p.stop_sequence))throw new Error("IBG stop-time reference invalid");
    const list=points.get(p.trip_id)||[];
    list.push({stopId:p.stop_id,sequence:+p.stop_sequence,arrival:p.arrival_time,departure:p.departure_time,pickup:p.pickup_type||"0"});
    points.set(p.trip_id,list);
  }
  for(const list of points.values()){
    list.sort((a,b)=>a.sequence-b.sequence);
    if(new Set(list.map(p=>p.sequence)).size!==list.length)throw new Error("Duplicate IBG trip stop sequences");
  }
  return {version:IBG_COMMIT,sha256:IBG_SHA,importedAt:new Date().toISOString(),agencies:tables.agency,routes:tables.routes,stops:tables.stops,
    calendars:tables.calendar,exceptions:tables.calendar_dates,sources:parse(sourcesText,{columns:true,bom:true,skip_empty_lines:true}),
    trips:tables.trips.map(t=>({id:t.trip_id,routeId:t.route_id,serviceId:t.service_id,headsign:t.trip_headsign,direction:t.direction_id,points:points.get(t.trip_id)||[]}))};
}
export async function ensureIbg(bytes?:Buffer){
  const old=await ibgDataset();
  if(old?.sha256===IBG_SHA&&!bytes)return old;
  const [archive,sources]=await Promise.all([bytes??download("Merged_GTFS_Feed.zip",45_000_000),download("Data_Source.csv",20000)]);
  const next=await decodeIbg(archive,sources.toString("utf8"));
  // One complete, isolated structured snapshot. Never overwrite live calendars,
  // provider schedules, source freshness or realtime feeds.
  await pool.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data) VALUES('ibg:dataset','reference','ibg',$1::jsonb)
    ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`,[JSON.stringify(next)]);
  cached=next;compiled=undefined;loaded=Date.now();
  logger.info({agencies:next.agencies.length,routes:next.routes.length,stops:next.stops.length,trips:next.trips.length},"IBG research reference dataset imported; current departures remain withheld");
  return next;
}
export async function mergeIbgProviders(existing:Provider[]){
  const d=await ibgDataset();if(!d)return existing;
  const catalog=await ibgCompiled();
  const result=new Map(existing.map(p=>[p.id,{...p}]));
  for(const a of d.agencies){
    const id=ibgProvider(a),source=sourceFor(d,a),base=result.get(id);
    const affected=catalog&&[...catalog.quarantinedStops.keys()].some(key=>key.startsWith(`ibg:${id}:stop:`));
    const note=`IBG research reference (${source?.source_date||"collection date not supplied"}); historical stops/routes/timetables only, not verified current service. ${IBG_ARTICLE}${affected?` ${catalog.coverageWarning}`:""}`;
    if(base){
      if(!base.description.includes("IBG research reference"))base.description+=` ${note}`;
      if(!base.status.startsWith("imported"))base.status="research reference · current times withheld";
    }else{
      let url=IBG_URL;
      try{const u=new URL(a.agency_url);if(["https:","http:"].includes(u.protocol)&&u.hostname!=="example.com")url=u.href;}catch{}
      result.set(id,{id,name:a.agency_name,status:"research reference · current times withheld",description:note,url,
        checkedAt:d.importedAt,terminalService:"Research stop coordinates only; current boarding locations require confirmation.",
        access:"Public factual research records with author attribution. Separate dataset/upstream reuse terms have not been independently established.",
        aliases:[]});
    }
  }
  return [...result.values()];
}
