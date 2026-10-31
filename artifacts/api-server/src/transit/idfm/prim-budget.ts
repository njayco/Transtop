import type { PoolClient } from "@workspace/db";
import { PRIM_DAILY_LIMIT } from "./prim-model";
/** Atomic and persistent across server restarts/instances sharing this database. */
export async function reservePrimRequest(client:PoolClient,day:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error("Invalid PRIM budget day");
  const result=await client.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data)
    VALUES($1,'live','idfm','{"used":1}'::jsonb) ON CONFLICT(mode,id)
    DO UPDATE SET data=jsonb_build_object('used',(transit_feed_snapshots.data->>'used')::int+1),updated_at=now()
    WHERE (transit_feed_snapshots.data->>'used')::int<$2 RETURNING data`,[`idfm:prim-budget:${day}`,PRIM_DAILY_LIMIT]);
  return result.rows[0]?.data.used as number|undefined;
}
