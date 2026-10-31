import { Open } from "unzipper";
import { createReadStream,existsSync } from "node:fs";
import { mkdir,open,readFile,readdir,rename,rm,stat,writeFile } from "node:fs/promises";
import { createHash,randomUUID } from "node:crypto";
import { dirname,join,resolve } from "node:path";
import { Transform } from "node:stream";
import { download } from "./download";
import { archiveUrl,validFeedId,type FeedRecord } from "./model";
import { regionalCapacity,smallCapacity } from "./capacity";

function directory(){
  let root=resolve(process.cwd());
  while(!existsSync(join(root,"pnpm-workspace.yaml"))){
    const parent=dirname(root);if(parent===root)throw new Error("Mobility cache requires workspace root");root=parent;
  }
  return join(root,"generated-artifacts/mobility");
}
async function digest(path:string){
  const hash=createHash("sha256");for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest("hex");
}
/** Bounded immutable-URL cache: at most one archive per registered feed.
 * A checksum is verified on reuse. Credentials and raw catalog bodies never enter it.
 */
export async function openArchive(feed:FeedRecord,regional=false) {
  if(!validFeedId(feed.id)||!archiveUrl(feed.hostedUrl)||!feed.datasetId)throw new Error("Invalid Mobility archive identity");
  const limits=regional?regionalCapacity:smallCapacity,dir=directory();
  await mkdir(dir,{recursive:true});
  const path=join(dir,`${feed.id}.zip`),metadata=join(dir,`${feed.id}-probe.json`);
  if(!existsSync(path)&&(await readdir(dir)).filter(name=>/\.zip$/.test(name)).length>=8)
    throw new Error("Mobility archive cache capacity reached; remove an unused operator-only probe archive before proceeding");
  let cached=false;
  try{
    if((await stat(metadata)).size>128*1024)throw new Error("Invalid cache metadata");
    const previous=JSON.parse(await readFile(metadata,"utf8")),size=(await stat(path)).size;
    cached=previous.feed?.datasetId===feed.datasetId&&previous.feed?.hostedUrl===feed.hostedUrl&&
      size>0&&size<=limits.compressed&&size===previous.zipBytes&&await digest(path)===previous.sha256;
  }catch{ /* No valid immutable cache: use the public pinned download. */ }
  if(!cached){
    const bytes=await download(feed.hostedUrl!,limits.compressed,180000),temporary=path+"."+randomUUID();
    try{await writeFile(temporary,bytes);await rename(temporary,path);}
    finally{await rm(temporary,{force:true});}
    await writeFile(metadata,JSON.stringify({feed:{id:feed.id,datasetId:feed.datasetId,hostedUrl:feed.hostedUrl},
      zipBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}));
  }
  // Check the central directory bounds before allocating unzipper entries.
  const handle=await open(path,"r");
  try{
    const size=(await handle.stat()).size,tail=Buffer.alloc(Math.min(size,65557));
    await handle.read(tail,0,tail.length,size-tail.length);
    const p=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
    if(size<22||size>limits.compressed||p<0||p+22>tail.length||p+22+tail.readUInt16LE(p+20)!==tail.length||
      tail.readUInt16LE(p+4)||tail.readUInt16LE(p+6)||tail.readUInt16LE(p+8)!==tail.readUInt16LE(p+10)||
      tail.readUInt16LE(p+10)>60||tail.readUInt32LE(p+12)>128*1024||
      tail.readUInt32LE(p+16)+tail.readUInt32LE(p+12)>size-tail.length+p)throw new Error("Mobility ZIP directory bounds");
  }finally{await handle.close();}
  const zip=await Open.file(path),names=new Set<string>();
  let expanded=0;
  for(const file of zip.files){
    if(!/^[a-z_]+\.txt$/.test(file.path)||file.type!=="File"||names.has(file.path)||
      !Number.isSafeInteger(file.uncompressedSize)||file.uncompressedSize<0||
      file.uncompressedSize>limits.expanded||file.uncompressedSize>Math.max(1,file.compressedSize)*200)
      throw new Error("Unsafe Mobility ZIP entry");
    names.add(file.path);expanded+=file.uncompressedSize;
    const original=file.stream.bind(file);
    file.stream=()=>{
      let read=0;
      const source=original(),bounded=new Transform({transform(chunk,_encoding,callback){
        read+=chunk.length;
        callback(read>file.uncompressedSize?new Error("Mobility ZIP actual expansion exceeds declared size"):null,chunk);
      },flush(callback){callback(read!==file.uncompressedSize?new Error("Mobility ZIP entry is truncated"):null);}});
      source.on("error",error=>bounded.destroy(error));
      bounded.on("close",()=>source.destroy());
      return source.pipe(bounded) as ReturnType<typeof file.stream>;
    };
  }
  if(expanded>limits.expanded)throw new Error("Mobility expanded archive exceeds capacity");
  return {zip,zipBytes:(await stat(path)).size,expandedBytes:expanded,cached};
}
