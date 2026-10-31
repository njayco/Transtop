import { z } from "zod";
import { DateTime } from "luxon";
import { createHash } from "node:crypto";
import { catalogUrl, odptEnabled, sendaiRealtimeCatalog, sendaiRealtimeTermsHash, type OdptSource } from "./registry";

export const METADATA="https://members-portal.odpt.org/api/v1/resources";
const resourceSchema=z.object({
  url:z.string().max(1000),start_at:z.string(),end_at:z.string().nullable(),
  uploaded_at:z.string(),feed_start_date:z.string(),feed_end_date:z.string(),feed_version:z.string().max(500),
});
const datasetSchema=z.object({
  label:z.string(),format_type:z.literal("GTFS/GTFS-JP"),license_type:z.literal("CC BY 4.0"),
  explain_ja:z.string(),mode_list:z.array(z.string()),is_gtfsrt:z.boolean(),
  license_explain:z.string().nullish(),license_url_ja:z.string().nullish(),license_url_en:z.string().nullish(),
  license_name_ja:z.string().nullish(),license_name_en:z.string().nullish(),
  dataresource:z.array(resourceSchema).max(500),
});
export type Edition=z.infer<typeof resourceSchema>;
export function safeUrl(value:string,s?:OdptSource,kind:"static"|"realtime"|"catalog"|"metadata"="static"){
  let u:URL;try{u=new URL(value);}catch{throw new Error("Untrusted ODPT URL");}
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash)throw new Error("Untrusted ODPT URL");
  if(kind==="metadata"&&u.href===METADATA)return u.href;
  if(kind==="catalog"&&s&&(u.href===catalogUrl(s)||s.id==="odpt-sendai"&&u.href===sendaiRealtimeCatalog))return u.href;
  if(u.host!=="api-public.odpt.org"||!s)throw new Error("Untrusted ODPT URL");
  if(kind==="static"&&u.pathname===`/api/v4/files/odpt/${s.organization}/${s.dataset}.zip`&&
    [...u.searchParams.keys()].length===1&&/^\d{8}$/.test(u.searchParams.get("date")||""))return u.href;
  if(kind==="realtime"&&!u.search&&s.realtime.some(k=>u.pathname===`/api/v4/gtfs/realtime/odpt_${s.organization}_${s.dataset}_${k}`))return u.href;
  throw new Error("Untrusted ODPT URL");
}
/** ODPT's public file endpoint redirects to a short-lived Azure read URL.
 * Validate its exact edition path; never retain, log or expose the signed URL. */
export function safeStorageRedirect(value:string,origin:string,s:OdptSource){
  const source=new URL(safeUrl(origin,s));let u:URL;
  try{u=new URL(value);}catch{throw new Error("Untrusted ODPT storage redirect");}
  if(u.protocol!=="https:"||u.host!=="dataodpt.blob.core.windows.net"||u.port||u.username||u.password||u.hash||
    u.pathname!==`/files-open/odpt/${s.organization}/${s.dataset}-${source.searchParams.get("date")}.zip`||
    [...u.searchParams.keys()].some(k=>!["st","se","sp","sv","sr","sig"].includes(k))||
    u.searchParams.get("sp")!=="r"||!u.searchParams.get("sig"))throw new Error("Untrusted ODPT storage redirect");
  return u.href;
}
// Single upstream request at a time, hard daily ceiling independent of Transitland.
let tail:Promise<unknown>=Promise.resolve(),day="",requests=0;
const inflight=new Map<string,Promise<Buffer>>(),cache=new Map<string,{at:number;value:Buffer}>();
const failures=new Map<string,number>();
export async function odptFetch(url:string,s:OdptSource|undefined,kind:"static"|"realtime"|"catalog"|"metadata",ttl=0){
  safeUrl(url,s,kind);
  if(!odptEnabled())throw new Error("ODPT disabled");
  const hit=cache.get(url);if(hit&&Date.now()-hit.at<ttl)return hit.value;
  const active=inflight.get(url);if(active)return active;
  const task=tail.catch(()=>{}).then(async()=>{
    if(Date.now()<(failures.get(url)||0))throw new Error("ODPT source backoff");
    const today=new Date().toISOString().slice(0,10);
    if(today!==day){day=today;requests=0;}
    if(requests>=5000)throw new Error("ODPT daily request ceiling reached");
    requests++;
    const max=kind==="static"?30*1024*1024:kind==="metadata"?8*1024*1024:2*1024*1024;
    try{
      let response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(kind==="static"?60000:20000)});
      if(kind==="static"&&s&&[301,302,303,307,308].includes(response.status)){
        const target=safeStorageRedirect(response.headers.get("location")||"",url,s);
        await response.body?.cancel();
        response=await fetch(target,{redirect:"error",signal:AbortSignal.timeout(60000)});
      }
      if(!response.ok||!response.body)throw new Error(`ODPT source HTTP ${response.status}`);
      const chunks:Uint8Array[]=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>max)throw new Error("ODPT response exceeds limit");chunks.push(chunk);}
      const value=Buffer.concat(chunks);
      if(ttl){cache.set(url,{at:Date.now(),value});if(cache.size>12)cache.delete(cache.keys().next().value!);}
      failures.delete(url);return value;
    }catch{failures.set(url,Date.now()+60000);throw new Error("ODPT source unavailable or exceeds limits");}
  });
  tail=task;inflight.set(url,task);
  try{return await task;}finally{inflight.delete(url);}
}
export function selectEdition(raw:unknown,s:OdptSource,now=Date.now()):Edition{
  let d:z.infer<typeof datasetSchema>;
  try{d=datasetSchema.parse(raw);}catch{throw new Error("Invalid or unapproved ODPT metadata");}
  if(d.label!==s.dataset||d.explain_ja!==s.description||d.license_explain||d.license_url_ja||d.license_url_en||d.license_name_ja||d.license_name_en||
    d.mode_list.length!==1||d.mode_list[0]!== (s.type==="bus"?"bus":"railway"))throw new Error("ODPT terms or modes changed; review required");
  const today=DateTime.fromMillis(now,{zone:"Asia/Tokyo"}).toISODate()!;
  const date=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&DateTime.fromISO(v).isValid;
  const eligible=d.dataresource.filter(r=>[r.start_at,r.feed_start_date,r.feed_end_date,...(r.end_at?[r.end_at]:[])].every(date)&&
    Number.isFinite(Date.parse(r.uploaded_at))&&Date.parse(r.uploaded_at)<=now&&
    r.start_at<=today&&(!r.end_at||r.end_at>=today)&&r.feed_start_date<=today&&r.feed_end_date>=today);
  eligible.sort((a,b)=>b.start_at.localeCompare(a.start_at)||b.uploaded_at.localeCompare(a.uploaded_at)||b.url.localeCompare(a.url));
  if(!eligible.length)throw new Error("No current approved ODPT edition");
  safeUrl(eligible[0].url,s);
  return eligible[0];
}
async function metadataDataset(s:OdptSource){
  const body=JSON.parse((await odptFetch(METADATA,undefined,"metadata",3600000)).toString());
  if(!Array.isArray(body)||body.length>300)throw new Error("Invalid ODPT metadata");
  const org=body.filter(o=>o?.label===s.organization);
  const datasets=org.length===1&&Array.isArray(org[0].datasets)?org[0].datasets.filter((d:any)=>d?.label===s.dataset):[];
  if(datasets.length!==1)throw new Error("ODPT approved dataset missing or ambiguous");
  return datasets[0];
}
export async function resolveEdition(s:OdptSource){
  const dataset=await metadataDataset(s);
  const html=(await odptFetch(catalogUrl(s),s,"catalog",3600000)).toString();
  if(!html.includes('https://creativecommons.org/licenses/by/4.0/')||/odpt-ptodcll/.test(html))throw new Error("ODPT catalog license requires review");
  verifyCatalogTerms(html,s);
  const resourceLinks=[...new Set([...html.matchAll(/href="(\/dataset\/[^"]+\/resource\/[a-f0-9-]+)"/g)]
    .map(m=>m[1]).filter(p=>p.startsWith(`/dataset/${s.catalog}/resource/`)))].slice(0,60)
    .map(p=>`https://ckan.odpt.org${p}`);
  if(!resourceLinks.length)throw new Error("ODPT resource provenance missing");
  return {...selectEdition(dataset,s),resourceLinks};
}
export function verifyCatalogTerms(html:string,s:OdptSource,expected=s.catalogTermsHash){
  const notes=html.match(/<div class="notes embedded-content">([\s\S]*?)<\/div>/)?.[1];
  if(!notes||createHash("sha256").update(notes.replace(/\s+/g," ").trim()).digest("hex")!==expected)
    throw new Error("ODPT catalog terms changed; review required");
}
export async function verifyRealtimeAccess(s:OdptSource,url:string){
  safeUrl(url,s,"realtime");
  const d=await metadataDataset(s),edition=selectEdition(d,s);
  const key=url.endsWith("_vehicle")?"vehicle_position":url.endsWith("_trip_update")?"trip_update":"alert";
  if(!d.is_gtfsrt||d[key]?.is_operated!==true||d[key]?.url!==url)throw new Error("ODPT companion no longer published");
  const html=(await odptFetch(sendaiRealtimeCatalog,s,"catalog",3600000)).toString();
  verifyCatalogTerms(html,s,sendaiRealtimeTermsHash);
  return edition.feed_version;
}
