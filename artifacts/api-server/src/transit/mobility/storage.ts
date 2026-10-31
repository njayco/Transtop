import { from } from "pg-copy-streams";
import type { PoolClient } from "@workspace/db";
import { once } from "node:events";
import { finished } from "node:stream/promises";

/** Physical names never contain publisher input. Staging remains detached until sealed. */
export function editionTable(stage:string) {
  if(!/^import-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(stage))
    throw new Error("Invalid Mobility storage generation");
  return `mobility_data.edition_${stage.slice(7).replaceAll("-","")}`;
}
export async function createEdition(client:PoolClient,stage:string,agency:string) {
  if(!/^mobility-(?:mdb|tld|ntd|tdg|jbda)-[a-z0-9-]{1,90}$/.test(agency))throw new Error("Invalid Mobility agency");
  const table=editionTable(stage);
  await client.query("BEGIN");
  try{
    await client.query("CREATE SCHEMA IF NOT EXISTS mobility_data");
    await client.query(`CREATE TABLE ${table} (LIKE public.transit_stop_times INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
      CHECK(mode='${stage}' AND agency='${agency}'))`);
    await client.query(`INSERT INTO transit_feed_snapshots(id,agency,mode,data) VALUES($1,$2,'live',$3)`,
      [`${agency}:generation:${stage}`,agency,{kind:"gtfs-generation",stage,storage:"mobility-edition"}]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}
}
export async function copyCalls(client:PoolClient,stage:string,rows:Record<string,unknown>[],signal:AbortSignal) {
  signal.throwIfAborted();
  const stream=client.query(from(`COPY ${editionTable(stage)}
    (id,agency,mode,data,trip_id,stop_id,sequence,arrival_seconds,departure_seconds) FROM STDIN WITH (FORMAT csv)`));
  const complete=finished(stream);void complete.catch(()=>{});
  const abort=()=>stream.destroy(new Error("Mobility import deadline exceeded"));
  signal.addEventListener("abort",abort,{once:true});
  const cell=(v:unknown)=>`"${String(v).replaceAll('"','""')}"`;
  try{
    for(const r of rows){
      signal.throwIfAborted();
      const line=[r.id,r.agency,r.mode,JSON.stringify(r.data),r.tripId,r.stopId,r.sequence,r.arrivalSeconds,r.departureSeconds].map(cell).join(",")+"\n";
      if(!stream.write(line))await once(stream,"drain");
    }
    stream.end();await complete;
  }catch(error){stream.destroy(error instanceof Error?error:new Error(String(error)));await complete.catch(()=>{});throw error;}
  finally{signal.removeEventListener("abort",abort);}
}
export async function sealEdition(client:PoolClient,stage:string,signal:AbortSignal,deadline:number) {
  const table=editionTable(stage),name=table.split(".")[1];
  try{
    await client.query("SET maintenance_work_mem='64MB'");
    for(const [suffix,columns,unique] of [["pk","id",true],["stop","stop_id,departure_seconds",false],["trip","trip_id,sequence",false]] as const){
      signal.throwIfAborted();
      const remaining=Math.min(180000,deadline-Date.now());
      if(remaining<=0)throw new Error("Mobility import deadline exceeded");
      await client.query(`SET statement_timeout=${remaining}`);
      await client.query(`CREATE ${unique?"UNIQUE":""} INDEX ${name}_${suffix} ON ${table}(${columns})`);
    }
    await client.query(`ANALYZE ${table}`);
  }finally{await client.query("RESET maintenance_work_mem; RESET statement_timeout");}
}

export async function createShapeStage(client:PoolClient) {
  await client.query(`CREATE TEMP TABLE mobility_shape_points(shape_id text,sequence int,lon double precision,lat double precision)`);
}
export async function copyShapePoints(client:PoolClient,rows:Record<string,string>[],signal:AbortSignal) {
  signal.throwIfAborted();
  const stream=client.query(from("COPY mobility_shape_points FROM STDIN WITH (FORMAT csv)"));
  const complete=finished(stream);void complete.catch(()=>{});
  const abort=()=>stream.destroy(new Error("Mobility shape import deadline exceeded"));
  signal.addEventListener("abort",abort,{once:true});
  try{
    for(const r of rows){
      signal.throwIfAborted();
      const line=`"${r.shape_id.replaceAll('"','""')}",${Number(r.shape_pt_sequence)},${Number(r.shape_pt_lon)},${Number(r.shape_pt_lat)}\n`;
      if(!stream.write(line))await once(stream,"drain");
    }
    stream.end();await complete;
  }catch(error){stream.destroy(error instanceof Error?error:new Error(String(error)));await complete.catch(()=>{});throw error;}
  finally{signal.removeEventListener("abort",abort);}
}
export async function publishShapes(client:PoolClient,agency:string,stage:string) {
  await client.query("CREATE UNIQUE INDEX ON mobility_shape_points(shape_id,sequence)");
  const {rows}=await client.query("SELECT max(n) n FROM (SELECT count(*) n FROM mobility_shape_points GROUP BY shape_id) s");
  if(Number(rows[0]?.n)>100000)throw new Error("Mobility per-shape point capacity exceeded");
  await client.query(`INSERT INTO transit_shapes(id,agency,mode,data)
    SELECT $1||':'||shape_id,$1,$2,jsonb_build_object('coordinates',
      jsonb_agg(jsonb_build_array(lon,lat) ORDER BY sequence))
    FROM mobility_shape_points GROUP BY shape_id`,[agency,stage]);
  await client.query("DROP TABLE mobility_shape_points");
}
