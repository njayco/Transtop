import { Transform } from "node:stream";
import type { Open } from "unzipper";
/** ZIP headers are not trusted as expanded-size enforcement. Bound actual bytes too. */
export function validateArchive(zip:Awaited<ReturnType<typeof Open.buffer>>){
  let declared=0,expanded=0;
  const names=new Set<string>();
  if(zip.files.length>100)throw new Error("WMATA archive entry limit");
  for(const file of zip.files){
    declared+=file.uncompressedSize;
    if(!/^[a-z_]+\.txt$/.test(file.path)||names.has(file.path)||
      file.uncompressedSize>400*1024*1024||declared>800*1024*1024)throw new Error("WMATA archive bounds or duplicate entry");
    names.add(file.path);
    const stream=file.stream.bind(file);
    file.stream=()=>{let size=0;return stream().compose(new Transform({transform(chunk,_encoding,done){
      size+=chunk.length;expanded+=chunk.length;
      done(size>400*1024*1024||expanded>800*1024*1024?new Error("WMATA expanded archive limit"):null,chunk);
    }})) as unknown as ReturnType<typeof file.stream>;};
  }
}
