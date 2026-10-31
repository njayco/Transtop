import { Open } from "unzipper";
import { parse } from "csv-parse";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, open, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { IDFM_URL } from "./model";

export const limits={compressed:192*1024*1024,expanded:2*1024*1024*1024,files:32,rows:20_000_000,record:256*1024};
function cacheDirectory(){
  if(process.env.IDFM_ARCHIVE_CACHE)return process.env.IDFM_ARCHIVE_CACHE;
  let root=resolve(process.cwd());
  while(!existsSync(join(root,"pnpm-workspace.yaml"))){
    const parent=dirname(root);if(parent===root)throw new Error("IDFM archive cache requires the workspace root");root=parent;
  }
  return join(root,"generated-artifacts/idfm-cache");
}
async function checksum(path:string){const h=createHash("sha256");for await(const b of createReadStream(path))h.update(b);return h.digest("hex");}
/** Bound central-directory metadata BEFORE unzipper allocates entry objects.
 * ZIP64 / multi-disk archives are unnecessary within this source's 2 GiB bound.
 */
export async function preflightZip(path:string){
  const file=await open(path,"r");
  try{
    const size=(await file.stat()).size;
    if(size<22||size>limits.compressed)throw new Error("IDFM ZIP size bound");
    const tail=Buffer.alloc(Math.min(size,65557));await file.read(tail,0,tail.length,size-tail.length);
    const p=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
    if(p<0||p+22>tail.length||p+22+tail.readUInt16LE(p+20)!==tail.length||
      tail.readUInt16LE(p+4)!==0||tail.readUInt16LE(p+6)!==0||
      tail.readUInt16LE(p+8)!==tail.readUInt16LE(p+10)||
      tail.readUInt16LE(p+10)>limits.files||tail.readUInt32LE(p+12)>128*1024||
      tail.readUInt32LE(p+16)+tail.readUInt32LE(p+12)>size-tail.length+p)
      throw new Error("IDFM ZIP directory bound or unsupported ZIP64/multi-disk archive");
  }finally{await file.close();}
}
export function validateZip(files:{path:string;uncompressedSize:number;compressedSize:number;type:string}[]){
  if(files.length>limits.files)throw new Error("IDFM archive file limit");
  let total=0;
  const names=new Set<string>();
  for(const f of files){
    if(!/^[a-z_]+\.txt$/.test(f.path)||f.type!=="File"||names.has(f.path))throw new Error("Unsafe or duplicate IDFM ZIP entry");
    names.add(f.path);total+=f.uncompressedSize;
    if(!Number.isSafeInteger(f.uncompressedSize)||f.uncompressedSize<0||f.uncompressedSize>limits.expanded||
      f.uncompressedSize>Math.max(1,f.compressedSize)*200)throw new Error("IDFM ZIP expansion limit");
  }
  if(total>limits.expanded)throw new Error("IDFM expanded archive limit");
  for(const name of ["agency","routes","stops","trips","stop_times"])
    if(!names.has(name+".txt"))throw new Error(`IDFM missing ${name}.txt`);
  if(!names.has("calendar.txt")&&!names.has("calendar_dates.txt"))throw new Error("IDFM has no service calendars");
}
/** A disk-backed archive, backpressured download and CSV parsing; no whole ZIP buffer. */
export async function openArchive(previous?:Record<string,any>,signal?:AbortSignal){
  const cacheDir=cacheDirectory(),cachePath=join(cacheDir,"feed.zip");
  const cached=await (async()=>{try{
    const c=JSON.parse(await readFile(join(cacheDir,"source.json"),"utf8"));
    const s=await stat(cachePath);
    return c.source===IDFM_URL&&s.size===c.downloaded&&s.size<=limits.compressed&&/^[a-f0-9]{64}$/.test(c.sha256)?c:undefined;
  }catch{return undefined;}})();
  const headers:Record<string,string>={};
  const validator=cached||previous;
  if(validator?.etag)headers["If-None-Match"]=validator.etag;
  if(validator?.lastModified)headers["If-Modified-Since"]=validator.lastModified;
  const response=await fetch(IDFM_URL,{headers,redirect:"error",signal});
  if(response.status===304&&previous&&(!cached||cached.etag===previous.etag&&cached.lastModified===previous.lastModified))
    return {unchanged:true as const,dispose:async()=>{}};
  if(response.status!==304&&(!response.ok||!response.body))throw new Error(`IDFM public archive returned ${response.status}`);
  if(response.status===304&&(!cached||await checksum(cachePath)!==cached.sha256)){
    await rm(join(cacheDir,"source.json"),{force:true});
    throw new Error("IDFM revalidation requires an intact cached archive; retry will download a fresh copy");
  }
  const advertised=Number(response.headers.get("content-length"));
  if(advertised>limits.compressed){await response.body?.cancel();throw new Error("IDFM compressed archive limit");}
  const dir=await mkdtemp(join(tmpdir(),"transtop-idfm-"));
  try{
    const fs=await statfs(dir);
    if(fs.bavail*fs.bsize<limits.compressed*3)throw new Error("Insufficient IDFM download disk space");
    let downloaded=0,expanded=0,records=0;
    const path=join(dir,"feed.zip");
    if(response.status===304){downloaded=cached.downloaded;await copyFile(cachePath,path);}
    else await pipeline(Readable.fromWeb(response.body as any),new Transform({transform(chunk,_encoding,done){
      downloaded+=chunk.length;done(downloaded>limits.compressed?new Error("IDFM compressed archive limit"):null,chunk);
    }}),createWriteStream(path),{signal});
    await preflightZip(path);
    const zip=await Open.file(path);
    validateZip(zip.files);
    const etag=response.status===304?cached.etag:response.headers.get("etag"),lastModified=response.status===304?cached.lastModified:response.headers.get("last-modified");
    if(response.status!==304){
      await mkdir(cacheDir,{recursive:true});
      await copyFile(path,join(cacheDir,"feed.zip.next"));await rename(join(cacheDir,"feed.zip.next"),cachePath);
      await writeFile(join(cacheDir,"source.json.next"),JSON.stringify({source:IDFM_URL,downloaded,etag,lastModified,sha256:await checksum(path)}));
      await rename(join(cacheDir,"source.json.next"),join(cacheDir,"source.json"));
    }
    return {unchanged:false as const,downloaded,etag,lastModified,
      dispose:()=>rm(dir,{recursive:true,force:true}),
      async *rows(name:string){
        const entry=zip.files.find(f=>f.path===name+".txt");if(!entry)return;
        const stream=entry.stream().compose(new Transform({transform(chunk,_encoding,done){
          expanded+=chunk.length;done(expanded>limits.expanded?new Error("IDFM expanded stream limit"):null,chunk);
        }})).compose(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:limits.record}));
        // Abort destroys the active parser even if the HTTP download has finished.
        const abort=()=>stream.destroy(new Error("IDFM import cancelled"));
        signal?.addEventListener("abort",abort,{once:true});
        try{
          for await(const r of stream){
            signal?.throwIfAborted();
            if(++records>limits.rows)throw new Error("IDFM record limit");
            yield r as Record<string,string>;
          }
        }finally{signal?.removeEventListener("abort",abort);stream.destroy();}
      }};
  }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
