/**
 * Isolated PostgreSQL benchmark. Never uses the workspace DATABASE_URL.
 * Start a disposable server on 55439 and create gtfs_bench (see docs).
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

process.env.DATABASE_URL = "postgresql://benchmark@127.0.0.1:55439/gtfs_bench";
const { pool, db, stopTimes } = await import("@workspace/db");
const { insertStopTimes, stopTimesMode, cleanupGenerations, IMPORT_LOCK } = await import("../src/transit/generations");
const { catalog, timetable } = await import("../src/transit/catalog");
const { network } = await import("../src/transit/network");
const agency = "mta-bus";
const rowCount = Number(process.env.GTFS_BENCH_ROWS || 1200000);
assert(rowCount >= 12000 && rowCount % 12000 === 0);
const tables = ["agencies", "routes", "trips", "calendars", "calendar_exceptions", "shapes", "stops"];
const results: unknown[] = [];

async function reset() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(await readFile(new URL("../../../lib/db/drizzle/0000_little_victor_mancha.sql", import.meta.url), "utf8"));
  await pool.query("CREATE INDEX transit_trips_route_idx ON transit_trips (mode,agency,(data->>'route_id'))");
  await pool.query(`INSERT INTO transit_routes (id,mode,agency,data)
    SELECT 'mta-bus:R'||n,'live','mta-bus',
      jsonb_build_object('id','mta-bus:R'||n,'route_id','R'||n,'name','R'||n,'longName','Synthetic route',
        'agency','Synthetic MTA','agencyId','mta-bus','type','bus','serviceClass','local','color','#468AC4')
    FROM generate_series(0,59) n`);
  await pool.query(`INSERT INTO transit_stops(id,mode,agency,data)
    SELECT 'mta-bus:S'||n,'live','mta-bus',jsonb_build_object('id','mta-bus:S'||n,'rawId','S'||n,
      'name','Synthetic stop '||n,'parent','','lat',40.75,'lon',-73.98,'routes',(SELECT jsonb_agg(data) FROM transit_routes),
      'type','bus','agency','Synthetic MTA','updatedAt',now(),'arrivals','[]'::jsonb,'alerts','[]'::jsonb)
    FROM generate_series(0,1999) n`);
  await pool.query(`INSERT INTO transit_trips(id,mode,agency,data)
    SELECT 'mta-bus:T'||n,'live','mta-bus',jsonb_build_object('route_id','R'||(n%60),
      'service_id','daily','shape_id','shape','trip_headsign','Synthetic destination','direction_id','0')
    FROM generate_series(0,$1::int-1) n`, [rowCount / 20]);
  await pool.query(`INSERT INTO transit_calendars(id,mode,agency,data) VALUES
    ('mta-bus:daily','live','mta-bus','{"service_id":"daily","start_date":"20260101","end_date":"20271231",
      "monday":"1","tuesday":"1","wednesday":"1","thursday":"1","friday":"1","saturday":"1","sunday":"1"}')`);
  await pool.query(`INSERT INTO transit_shapes(id,mode,agency,data)
    VALUES ('mta-bus:shape','live','mta-bus','{"coordinates":[[-73.98,40.75],[-73.97,40.76]]}')`);
  await pool.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data)
    VALUES ('mta-bus:static','live','mta-bus','{"serviceStart":"20260101","serviceEnd":"20271231"}')`);
  await pool.query(`INSERT INTO transit_stop_times(id,mode,agency,trip_id,stop_id,sequence,arrival_seconds,departure_seconds,data)
    SELECT 'mta-bus:T'||(n/20)||':'||(n%20),'live','mta-bus','mta-bus:T'||(n/20),
      'mta-bus:S'||(n%2000),(n%20),36000+(n%20)*60,36000+(n%20)*60,
      jsonb_build_object('trip_id','T'||(n/20),'stop_id','S'||(n%2000),'stop_sequence',(n%20)::text,
        'arrival_time','10:00:00','departure_time','10:00:00')
    FROM generate_series(0,$1::int-1) n`, [rowCount]);
  // Keep a second operator and demo row to catch overly broad retirement.
  await pool.query(`INSERT INTO transit_stop_times SELECT 'other:trip:0',mode,'other','other:trip','other:stop',
    sequence,arrival_seconds,departure_seconds,data,updated_at FROM transit_stop_times LIMIT 1`);
  await pool.query(`INSERT INTO transit_stop_times SELECT id,'demo',agency,trip_id,stop_id,sequence,
    arrival_seconds,departure_seconds,data,updated_at FROM transit_stop_times LIMIT 1`);
  await pool.query(`ANALYZE`);
}

function row(n: number) {
  return { id: `mta-bus:T${Math.floor(n / 20)}:${n % 20}`, agency, mode: "import-benchmark",
    tripId: `mta-bus:T${Math.floor(n / 20)}`, stopId: `mta-bus:S${n % 2000}`, sequence: n % 20,
    arrivalSeconds: 36000 + n % 20 * 60, departureSeconds: 36000 + n % 20 * 60,
    data: { trip_id: `T${Math.floor(n / 20)}`, stop_id: `S${n % 2000}`, stop_sequence: String(n % 20),
      arrival_time: "10:00:00", departure_time: "10:00:00" } };
}
function summary(values: number[]) {
  values.sort((a, b) => a - b);
  return { count: values.length, p50: values[Math.floor(values.length * .5)] || 0,
    p95: values[Math.min(values.length - 1, Math.floor(values.length * .95))] || 0,
    max: values.at(-1) || 0 };
}
async function run(strategy: "before" | "after") {
  await reset();
  const client = await pool.connect();
  const times: Record<string, number[]> = { catalog: [], stopTimetable: [], routeTimetable: [], network: [] };
  const errors: string[] = [];
  let reading = true;
  async function reader(name: string, work: () => Promise<unknown>) {
    while (reading) {
      const start = performance.now();
      try { await work(); times[name].push(performance.now() - start); }
      catch (err) { errors.push(`${name}: ${String(err)}`); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const readers = [
    reader("catalog", () => catalog({ mode: "live", agency, limit: 20, offset: 0 })),
    reader("stopTimetable", () => timetable({ mode: "live", stopId: "mta-bus:S0", date: "2026-10-30", from: "00:00", limit: 40, offset: 0 })),
    reader("routeTimetable", () => timetable({ mode: "live", routeId: "mta-bus:R0", date: "2026-10-30", from: "00:00", limit: 40, offset: 0 })),
    reader("network", () => network({ mode: "live", zoom: 12 })),
  ];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [IMPORT_LOCK]);
    await pool.query(`SELECT pg_stat_reset()`);
    const walStart = (await pool.query("SELECT pg_current_wal_insert_lsn() AS lsn")).rows[0].lsn;
    const start = performance.now();
    // Same 1500-row batches as the original importer, spanning six equal packages.
    for (let i = 0; i < rowCount; i += 1500) {
      const batch = Array.from({ length: Math.min(1500, rowCount - i) }, (_, j) => row(i + j));
      if (strategy === "before") await db.insert(stopTimes).values(batch).onConflictDoNothing();
      else await insertStopTimes(batch);
    }
    for (const table of tables) await pool.query(`INSERT INTO transit_${table}
      SELECT id,'import-benchmark',agency,data,updated_at FROM transit_${table} WHERE mode='live' AND agency=$1`, [agency]);
    const loadMs = performance.now() - start;
    const analyzeStart = performance.now();
    if (strategy === "after") await pool.query("ANALYZE transit_stop_times");
    const analyzeMs = performance.now() - analyzeStart;
    const publishStart = performance.now();
    await client.query("BEGIN");
    for (const table of [...tables, ...(strategy === "before" ? ["stop_times"] : [])]) {
      await client.query(`DELETE FROM transit_${table} WHERE mode='live' AND agency=$1`, [agency]);
      await client.query(`UPDATE transit_${table} SET mode='live' WHERE mode='import-benchmark'`);
    }
    if (strategy === "after") {
      for (const table of tables) await client.query(`ANALYZE transit_${table}`);
      await client.query(`UPDATE transit_feed_snapshots SET data=data||'{"stopTimesMode":"import-benchmark"}' WHERE id='mta-bus:static'`);
    }
    await client.query("COMMIT");
    const publishMs = performance.now() - publishStart;
    if (strategy === "before") await pool.query("ANALYZE transit_stop_times; ANALYZE transit_trips");
    const importMs = performance.now() - start;
    // Observe reads after publication too.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const walBytes = Number((await pool.query("SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1) AS bytes", [walStart])).rows[0].bytes);
    await pool.query("SELECT pg_stat_force_next_flush()");
    const stats = await pool.query(`SELECT sum(n_tup_ins)::bigint AS inserted,sum(n_tup_upd)::bigint AS updated,
      sum(n_tup_del)::bigint AS deleted FROM pg_stat_user_tables WHERE relname LIKE 'transit_%'`);
    const plan = await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT *
      FROM transit_stop_times WHERE mode=${stopTimesMode("'mta-bus'")} AND stop_id='mta-bus:S0'`);
    reading = false;
    await Promise.all(readers);
    assert.deepEqual(errors, []);
    const cleanupStart = performance.now();
    if (strategy === "after") {
      await pool.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data)
        VALUES ('mta-bus:generation:live','live','mta-bus','{"kind":"gtfs-generation","stage":"live"}')`);
      await cleanupGenerations();
      const remaining = Number((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode='live' AND agency='mta-bus'")).rows[0].count);
      assert.equal(remaining, rowCount - 20000);
      assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE agency='other'")).rows[0].count, "1");
      assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode='demo'")).rows[0].count, "1");
    }
    const cleanupSliceMs = performance.now() - cleanupStart;
    results.push({ strategy, rowCount, loadMs, analyzeMs, publishMs, importMs, walBytes, writes: stats.rows[0],
      cleanupSliceMs, latencyMs: Object.fromEntries(Object.entries(times).map(([key, value]) => [key, summary(value)])),
      stopLookupPlan: plan.rows[0]["QUERY PLAN"] });
    console.log(JSON.stringify(results.at(-1), null, 2));
  } finally {
    reading = false;
    await Promise.all(readers);
    await client.query("ROLLBACK");
    await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_LOCK]);
    client.release();
  }
}
try {
  await run("before");
  await run("after");
  const output = new URL("../../../generated-artifacts/", import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL("gtfs-performance.json", output), JSON.stringify({ postgres: (await pool.query("SELECT version()")).rows[0].version, results }, null, 2));
} finally { await pool.end(); }
