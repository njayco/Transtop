import { pool } from "@workspace/db";
import { IMPORT_LOCK } from "./generations";

/** Compatibility rollback before deploying a pre-generation reader.
 * Does not fetch feeds or rewrite the active generation. Crash/retry is safe:
 * new readers keep using the source until the final metadata transaction.
 */
export async function restoreLegacyStopTimes(agency: string) {
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows: lock } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [IMPORT_LOCK]);
    locked = lock[0].locked;
    if (!locked) throw new Error("Another GTFS import or cleanup is already running");
    const { rows } = await client.query(`SELECT data->>'stopTimesMode' AS stage
      FROM transit_feed_snapshots WHERE mode='live' AND id=$1`, [`${agency}:static`]);
    const stage = rows[0]?.stage;
    if (!stage || stage === "live") return;
    // Incomplete previous rollback copies or retired legacy rows can be removed
    // without affecting readers of the immutable active generation.
    while (true) {
      const result = await client.query(`DELETE FROM transit_stop_times WHERE ctid IN (
        SELECT ctid FROM transit_stop_times WHERE mode='live' AND agency=$1 LIMIT 2000)`, [agency]);
      if (!result.rowCount) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    let after = "";
    while (true) {
      const result = await client.query(`WITH batch AS MATERIALIZED (
        SELECT * FROM transit_stop_times WHERE mode=$1 AND agency=$2 AND id>$3 ORDER BY id LIMIT 1500
      ), inserted AS (
        INSERT INTO transit_stop_times(id,mode,agency,trip_id,stop_id,sequence,arrival_seconds,departure_seconds,data,updated_at)
        SELECT id,'live',agency,trip_id,stop_id,sequence,arrival_seconds,departure_seconds,data,updated_at FROM batch
        RETURNING id
      ) SELECT max(id) AS last,count(*)::int AS count FROM inserted`, [stage, agency, after]);
      if (!result.rows[0].count) break;
      after = result.rows[0].last;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await client.query("ANALYZE transit_stop_times");
    await client.query("BEGIN");
    const { rows: counts } = await client.query(`SELECT
      count(*) FILTER (WHERE mode=$1) AS source,count(*) FILTER (WHERE mode='live') AS target
      FROM transit_stop_times WHERE agency=$2 AND mode IN ($1,'live')`, [stage, agency]);
    if (counts[0].source !== counts[0].target || counts[0].source === "0")
      throw new Error("Legacy copy verification failed; active generation retained");
    await client.query(`UPDATE transit_feed_snapshots SET data=data-'stopTimesMode',updated_at=now()
      WHERE mode='live' AND id=$1`, [`${agency}:static`]);
    await client.query(`DELETE FROM transit_feed_snapshots
      WHERE mode='live' AND agency=$1 AND data->>'kind'='gtfs-generation' AND data->>'stage'='live'`, [agency]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_LOCK]);
    client.release();
  }
}
