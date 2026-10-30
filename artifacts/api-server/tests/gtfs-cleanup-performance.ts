import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

// Run immediately after gtfs-performance.ts against its disposable local DB.
process.env.DATABASE_URL = "postgresql://benchmark@127.0.0.1:55439/gtfs_bench";
const { pool } = await import("@workspace/db");
const { cleanupGenerations, IMPORT_LOCK } = await import("../src/transit/generations");
const { catalog, timetable } = await import("../src/transit/catalog");
const path = new URL("../../../generated-artifacts/gtfs-performance.json", import.meta.url);
const report = JSON.parse(await readFile(path, "utf8"));
const times: Record<string, number[]> = { catalog: [], stopTimetable: [], routeTimetable: [] };
const errors: string[] = [];
let reading = true;
async function reader(name: string, work: () => Promise<unknown>) {
  while (reading) {
    const start = performance.now();
    try { await work(); times[name].push(performance.now() - start); }
    catch (err) { errors.push(String(err)); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const readers = [
  reader("catalog", () => catalog({ mode: "live", agency: "mta-bus", offset: 0, limit: 20 })),
  reader("stopTimetable", () => timetable({ mode: "live", stopId: "mta-bus:S0", date: "2026-10-30", from: "00:00", offset: 0, limit: 40 })),
  reader("routeTimetable", () => timetable({ mode: "live", routeId: "mta-bus:R0", date: "2026-10-30", from: "00:00", offset: 0, limit: 40 })),
];
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock($1)", [IMPORT_LOCK]);
  const wal = (await pool.query("SELECT pg_current_wal_insert_lsn() AS lsn")).rows[0].lsn;
  const start = performance.now();
  const before = Number((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode='live' AND agency='mta-bus'")).rows[0].count);
  let slices = 0;
  while ((await pool.query(`SELECT 1 FROM transit_feed_snapshots
    WHERE mode='live' AND id='mta-bus:generation:live'`)).rowCount) {
    await cleanupGenerations(20000);
    slices++;
    assert(slices <= 1000, "Cleanup must make progress");
  }
  const elapsedMs = performance.now() - start;
  const walBytes = Number((await pool.query("SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1) AS bytes", [wal])).rows[0].bytes);
  reading = false;
  await Promise.all(readers);
  assert.deepEqual(errors, []);
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode='live' AND agency='mta-bus'")).rows[0].count, "0");
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE agency='other' OR mode='demo'")).rows[0].count, "2");
  report.cleanupDrain = { before, elapsedMs, slices, walBytes,
    latencyMs: Object.fromEntries(Object.entries(times).map(([name, values]) => {
      values.sort((a, b) => a - b);
      return [name, { count: values.length, p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], max: values.at(-1) }];
    })) };
  console.log(JSON.stringify(report.cleanupDrain, null, 2));
  await writeFile(path, JSON.stringify(report, null, 2));
} finally {
  reading = false;
  await Promise.all(readers);
  await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_LOCK]);
  client.release();
  await pool.end();
}
