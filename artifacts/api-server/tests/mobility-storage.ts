// Disposable local benchmark only; never uses workspace database credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
process.env.DATABASE_URL="postgresql://benchmark@127.0.0.1:55440/postgres";
const {pool}=await import("@workspace/db");
const {createEdition,copyCalls,sealEdition,editionTable}=await import("../src/transit/mobility/storage");
const {cleanupGenerations,IMPORT_LOCK}=await import("../src/transit/generations");
const client=await pool.connect(),stage=`import-${randomUUID()}`,agency="mobility-mdb-benchmark";
const signal=AbortSignal.timeout(10*60_000),started=Date.now(),report:Record<string,unknown>={};
try{
  await client.query("SELECT pg_advisory_lock($1)",[IMPORT_LOCK]);
  await client.query("DROP SCHEMA IF EXISTS mobility_data CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  for(const table of ["agencies","routes","trips","calendars","calendar_exceptions","shapes","stops","feed_snapshots"]){
    await client.query(`CREATE TABLE transit_${table}(id text,agency text,mode text,data jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(mode,id))`);
  }
  await client.query(`CREATE TABLE transit_stop_times(id text NOT NULL,agency text NOT NULL,mode text NOT NULL,data jsonb NOT NULL,
    trip_id text NOT NULL,stop_id text NOT NULL,sequence int NOT NULL,arrival_seconds int NOT NULL,departure_seconds int NOT NULL,
    updated_at timestamptz DEFAULT now(),PRIMARY KEY(mode,id));
    CREATE INDEX lookup ON transit_stop_times(mode,stop_id); CREATE INDEX trip ON transit_stop_times(mode,trip_id)`);
  await client.query(`INSERT INTO transit_stop_times VALUES('other:T:1','other','live','{}','other:T','other:S',1,36000,36000)`);
  await createEdition(client,stage,agency);
  const stagingStarted=Date.now(),rows=2000000;
  for(let n=0;n<rows;n+=5000){
    const batch=Array.from({length:5000},(_,i)=>{
      const v=n+i,t=`T${Math.floor(v/20)}`,s=`S${v%2000}`,sequence=v%20;
      return {id:`${agency}:${t}:${sequence}`,agency,mode:stage,tripId:`${agency}:${t}`,stopId:`${agency}:${s}`,sequence,
        arrivalSeconds:36000+sequence*60,departureSeconds:36000+sequence*60,
        data:{trip_id:t,stop_id:s,stop_sequence:String(sequence),arrival_time:"10:00:00",departure_time:"10:00:00"}};
    });
    await copyCalls(client,stage,batch,signal);
  }
  report.stagingMs=Date.now()-stagingStarted;
  assert.equal((await client.query("SELECT count(*) FROM transit_stop_times")).rows[0].count,"1","Detached load must not enter reader scans");
  report.detachedPlan=(await client.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM transit_stop_times WHERE mode='live' AND stop_id='other:S'")).rows;
  const sealStarted=Date.now();
  await sealEdition(client,stage,signal,started+600000);
  report.sealMs=Date.now()-sealStarted;
  report.bytes=Number((await client.query("SELECT pg_total_relation_size($1) bytes",[editionTable(stage)])).rows[0].bytes);
  await client.query("BEGIN");
  await client.query(`ALTER TABLE ${editionTable(stage)} INHERIT public.transit_stop_times`);
  await client.query("INSERT INTO transit_feed_snapshots VALUES($1,$2,'live',$3)",[`${agency}:static`,agency,{stopTimesMode:stage}]);
  await client.query("COMMIT");
  report.publishedPlan=(await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM transit_stop_times WHERE mode=$1 AND stop_id=$2`,[stage,`${agency}:S1`])).rows;
  report.otherPlan=(await client.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM transit_stop_times WHERE mode='live' AND stop_id='other:S'")).rows;
  const beforeCleanup=Date.now();
  await cleanupGenerations(20000,agency);
  assert.equal((await client.query("SELECT to_regclass($1) name",[editionTable(stage)])).rows[0].name,editionTable(stage),"Active edition must survive cleanup");
  await client.query("DELETE FROM transit_feed_snapshots WHERE id=$1",[`${agency}:static`]);
  await cleanupGenerations(20000,agency);
  report.cleanupMs=Date.now()-beforeCleanup;
  assert.equal((await client.query("SELECT to_regclass($1) name",[editionTable(stage)])).rows[0].name,null);
  assert.equal((await client.query("SELECT count(*) FROM transit_stop_times WHERE agency='other'")).rows[0].count,"1");
  report.rows=rows;report.elapsedMs=Date.now()-started;report.rssBytes=process.memoryUsage().rss;
  await mkdir(new URL("../../../generated-artifacts/mobility/",import.meta.url),{recursive:true});
  await writeFile(new URL("../../../generated-artifacts/mobility/storage-benchmark.json",import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await client.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);client.release();await pool.end();}
