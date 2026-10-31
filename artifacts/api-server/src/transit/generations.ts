import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { editionTable } from "./idfm/storage";

export const IMPORT_LOCK = 735102;
// Resolve inside the reader's statement, never from a cached health response.
// Legacy installations need no migration or initial data rewrite.
export function stopTimesMode(agencySql: string) {
  return `COALESCE((SELECT data->>'stopTimesMode' FROM transit_feed_snapshots
    WHERE mode='live' AND id=(${agencySql} || ':static')), 'live')`;
}

const generationTables = ["transit_stop_times", "transit_agencies", "transit_routes",
  "transit_trips", "transit_calendars", "transit_calendar_exceptions", "transit_shapes", "transit_stops"];

/** Caller owns IMPORT_LOCK. Every delete commits separately and has a hard row cap.
 * Registry entries survive crashes, so unfinished staging/retirement resumes later.
 */
export async function cleanupGenerations(budget = 20000, agency?:string) {
  const deadline=agency==="idfm"?Date.now()+30000:Infinity;
  const { rows } = await pool.query(`SELECT g.id,g.agency,g.data,g.data->>'stage' AS stage
    FROM transit_feed_snapshots g
    WHERE g.mode='live' AND g.data->>'kind'='gtfs-generation'
      AND g.data->>'stage' IS DISTINCT FROM
        (SELECT COALESCE(s.data->>'stopTimesMode','live') FROM transit_feed_snapshots s
         WHERE s.mode='live' AND s.id=g.agency||':static')
       AND ($1::text IS NULL OR g.agency=$1)
     ORDER BY CASE WHEN g.data->>'storage'='idfm-edition' THEN 0 ELSE 1 END,g.updated_at`,[agency||null]);
  for (const generation of rows) {
    let complete = true;
    const edition=generation.agency==="idfm"&&generation.data.storage==="idfm-edition";
    if(edition){
      const client=await pool.connect();
      try{
        await client.query("BEGIN; SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='2s'");
        // Active editions were excluded above under the shared ownership lock.
        // DROP never cascades and can't remove another provider's records.
        await client.query(`DROP TABLE IF EXISTS ${editionTable(generation.stage)}`);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
    }
    // Legacy live rows only exist in stop_times; never delete published catalog rows.
    const tables = edition?generationTables.slice(1):generation.stage === "live" ? generationTables.slice(0, 1) : generationTables;
    for (const table of tables) {
      let after = generation.data[`cursor:${table}`] || "";
      while (budget > 0) {
        if(Date.now()>=deadline){complete=false;break;}
        const limit = Math.min(agency==="idfm"?500:2000, budget);
        const client = await pool.connect();
        let deleted = 0;
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL lock_timeout = '250ms'");
          await client.query("SET LOCAL statement_timeout = '2s'");
          const result = await client.query(`WITH batch AS MATERIALIZED (
            SELECT ctid FROM ${table} WHERE mode=$1 AND agency=$2 AND id>$4
            ORDER BY id LIMIT $3
          ), removed AS (
             DELETE FROM ${table} target USING batch WHERE target.ctid=batch.ctid RETURNING target.id
          ) SELECT count(*)::int AS count,max(id) AS last FROM removed`,
          [generation.stage, generation.agency, limit, after]);
          deleted = result.rows[0].count;
          if (deleted) {
            after = result.rows[0].last;
            // Save the index cursor in the same transaction as the delete. This
            // avoids rescanning millions of dead entries after every slice.
            await client.query(`UPDATE transit_feed_snapshots SET data=data||$2::jsonb
              WHERE mode='live' AND id=$1`, [generation.id, JSON.stringify({ [`cursor:${table}`]: after })]);
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally { client.release(); }
        budget -= deleted;
        if (deleted < limit) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (budget <= 0||!complete) { complete = false; break; }
    }
    if (complete) await pool.query("DELETE FROM transit_feed_snapshots WHERE mode='live' AND id=$1", [generation.id]);
    if (budget <= 0||Date.now()>=deadline) break;
  }
}

export async function maintainGenerations(budget=20000,agency?:string) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [IMPORT_LOCK]);
    if (!rows[0].locked) return;
    try { await cleanupGenerations(budget,agency); }
    finally { await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_LOCK]); }
  } catch (err) {
    logger.warn({ err }, "GTFS generation cleanup deferred");
  } finally { client.release(); }
}

/** A single JSON parameter avoids constructing tens of thousands of Drizzle
 * parameters/AST nodes per batch. The caller bounds both row count and bytes.
 */
export async function insertStopTimes(rows: Record<string, unknown>[]) {
  await pool.query(`INSERT INTO transit_stop_times
    (id,agency,mode,data,trip_id,stop_id,sequence,arrival_seconds,departure_seconds)
    SELECT id,agency,mode,data,"tripId","stopId",sequence,"arrivalSeconds","departureSeconds"
    FROM jsonb_to_recordset($1::jsonb) AS r(id text,agency text,mode text,data jsonb,
      "tripId" text,"stopId" text,sequence integer,"arrivalSeconds" integer,"departureSeconds" integer)
    ON CONFLICT (mode,id) DO NOTHING`, [JSON.stringify(rows)]);
}
