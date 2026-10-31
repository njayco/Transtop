// Read-only feed measurement. Never registers or publishes a source.
import { pool } from "@workspace/db";
import { parse } from "csv-parse";
import { mkdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { openArchive } from "../src/transit/mobility/archive";
import { IMPORT_LOCK } from "../src/transit/generations";

const id=process.argv[2]||"mdb-3233";
const lock=await pool.connect();
let locked=false;
try {
  locked=(await lock.query("SELECT pg_try_advisory_lock($1) locked",[IMPORT_LOCK])).rows[0].locked;
  if(!locked)throw new Error("Another import or archive measurement is running");
  const {rows}=await pool.query(`SELECT f FROM transit_feed_snapshots,
    LATERAL jsonb_array_elements(data->'feeds') f
    WHERE mode='live' AND id LIKE 'mobility:catalog:%' AND f->>'id'=$1
    ORDER BY updated_at DESC LIMIT 1`,[id]);
  const feed=rows[0]?.f;
  if(!feed?.hostedUrl||!feed.license||!feed.timezone)throw new Error("Missing licensed, timezone-verified catalog evidence");
  const started=Date.now(),archive=await openArchive(feed,true),zip=archive.zip;
  const directory=new URL(`../../../generated-artifacts/mobility/`,import.meta.url);
  await mkdir(directory,{recursive:true});
  const files=[];
  for(const f of zip.files){
    if(!/^(agency|routes|stops|trips|calendar|calendar_dates|stop_times|shapes|frequencies)\.txt$/.test(f.path))continue;
    let records=0;
    for await(const _ of f.stream().compose(parse({columns:true,bom:true,skip_empty_lines:true,max_record_size:256*1024})))records++;
    files.push({name:f.path,expandedBytes:f.uncompressedSize,records});
  }
  const hash=createHash("sha256");
  for await(const bytes of createReadStream(new URL(`${id}.zip`,directory)))hash.update(bytes);
  const report={feed,zipBytes:archive.zipBytes,expandedBytes:archive.expandedBytes,
    sha256:hash.digest("hex"),files,elapsedMs:Date.now()-started,rssBytes:process.memoryUsage().rss};
  await writeFile(new URL(`${id}-probe.json`,directory),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,feed:{id:feed.id,license:feed.license,timezone:feed.timezone}},null,2));
}finally{if(locked)await lock.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);lock.release();await pool.end();}
