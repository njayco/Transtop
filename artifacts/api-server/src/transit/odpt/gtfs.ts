import { parse } from "csv-parse";
import { Transform } from "node:stream";
import type { Open } from "unzipper";
type Zip=Awaited<ReturnType<typeof Open.buffer>>;
/** Both ZIP directory sizes and streamed expanded bytes are bounded. */
export function validateArchive(zip:Zip){
  if(zip.files.length>60)throw new Error("ODPT archive entry limit");
  let total=0,expanded=0;const names=new Set<string>();
  for(const f of zip.files){
    total+=f.uncompressedSize;
    if(names.has(f.path)||!/^[a-z_]+\.txt$/.test(f.path)||f.uncompressedSize>100*1024*1024||total>200*1024*1024)
      throw new Error("ODPT archive bounds or duplicate/path violation");
    names.add(f.path);
    const stream=f.stream.bind(f);
    f.stream=()=>{let bytes=0;return stream().compose(new Transform({transform(chunk,_encoding,done){
      bytes+=chunk.length;expanded+=chunk.length;
      done(bytes>100*1024*1024||expanded>250*1024*1024?new Error("ODPT expanded archive limit"):null,chunk);
    }})) as unknown as ReturnType<typeof f.stream>;};
  }
}
export async function translations(zip:Zip){
  const entry=zip.files.find(f=>f.path==="translations.txt");
  const index=new Map<string,string[]>();
  if(entry){
    let records=0;
    for await(const r of entry.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:256*1024}))){
      if(++records>100000)throw new Error("ODPT translation limit");
      const key=[r.table_name,r.field_name,r.record_id?`id:${r.record_id}:${r.record_sub_id||""}`:`value:${r.field_value}`].join("|");
      const values=index.get(key)||[];if(r.translation&&!values.includes(r.translation))values.push(r.translation);index.set(key,values);
    }
  }
  return (table:string,field:string,id:string,value:string,sub="")=>[...new Set([
    ...(index.get(`${table}|${field}|id:${id}:${sub}`)||[]),...(index.get(`${table}|${field}|value:${value}`)||[]),
  ])];
}
