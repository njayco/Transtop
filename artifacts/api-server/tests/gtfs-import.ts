import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";

// Deliberately fixed to a separate disposable local database. Runtime secrets
// and the workspace database are never read by this test.
process.env.DATABASE_URL = "postgresql://benchmark@127.0.0.1:55439/gtfs_import_test";
const { pool } = await import("@workspace/db");
const { importGtfs } = await import("../src/transit/importer");
const { cleanupGenerations, IMPORT_LOCK } = await import("../src/transit/generations");
const { adapters } = await import("../src/transit/adapters");
const { timetable } = await import("../src/transit/catalog");
const { scheduledArrivals } = await import("../src/transit/schedules");
const { routeDetail, allStops } = await import("../src/transit/service");
const { network } = await import("../src/transit/network");
const { restoreLegacyStopTimes } = await import("../src/transit/legacy-rollback");
const output = new URL("../../../generated-artifacts/gtfs-fixtures/", import.meta.url);
await mkdir(output, { recursive: true });
execFileSync("python3", ["-c", `
import zipfile,sys
from pathlib import Path
root=Path(sys.argv[1])
for n in range(6):
  with zipfile.ZipFile(root/f'{n}.zip','w',zipfile.ZIP_DEFLATED) as z:
    files={
      'agency':'agency_id,agency_name\\na,Synthetic agency\\n',
      'routes':f'route_id,route_short_name,route_long_name,agency_id\\nR{n},R{n},Synthetic route {n},a\\n',
      'stops':'stop_id,stop_name,stop_lat,stop_lon\\nS,Shared stop,40.75,-73.98\\nU,Untimed stop,40.76,-73.97\\n',
      'trips':f'route_id,service_id,trip_id,shape_id,direction_id,trip_headsign\\nR{n},daily,collision,shape,0,Terminal\\n',
      'stop_times':'trip_id,arrival_time,departure_time,stop_id,stop_sequence\\ncollision,10:00:00,10:00:00,S,1\\ncollision,,,U,2\\n',
      'calendar':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\\ndaily,1,1,1,1,1,1,1,20260101,20271231\\n',
      'calendar_dates':'service_id,date,exception_type\\ndaily,20261101,2\\n',
      'shapes':'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\\nshape,40.75,-73.98,1\\nshape,40.76,-73.97,2\\n'
    }
    for name,data in files.items():z.writestr(name+'.txt',data)
`, output.pathname]);
const packages = adapters.find(a => a.id === "mta-bus")!.staticFeeds!;
const archives = await Promise.all(packages.map((_, i) => readFile(new URL(`${i}.zip`, output))));
const nativeFetch = globalThis.fetch;
let failPackage = -1, fetched = 0;
globalThis.fetch = async (url) => {
  const index = packages.findIndex(p => p.url === String(url));
  assert(index >= 0, "No non-fixture downloads permitted");
  fetched++;
  if (index === failPackage) return new Response("unavailable", { status: 503 });
  return new Response(new Uint8Array(archives[index]));
};
const staticTables = ["agencies", "routes", "trips", "stop_times", "calendars", "calendar_exceptions", "shapes", "stops"];
const timetableDefaults = { from: "00:00", offset: 0, limit: 40 };
async function dumpPublished() {
  const result: Record<string, unknown> = {};
  for (const table of staticTables) result[table] = (await pool.query(`SELECT * FROM transit_${table}
    WHERE mode='live' OR mode=(SELECT data->>'stopTimesMode' FROM transit_feed_snapshots WHERE id='mta-bus:static' AND mode='live')
    ORDER BY mode,id`)).rows;
  result.snapshot = (await pool.query("SELECT * FROM transit_feed_snapshots WHERE id='mta-bus:static' AND mode='live'")).rows;
  return result;
}
try {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(await readFile(new URL("../../../lib/db/drizzle/0000_little_victor_mancha.sql", import.meta.url), "utf8"));
  await pool.query("CREATE INDEX transit_trips_route_idx ON transit_trips(mode,agency,(data->>'route_id'))");
  // A legacy live generation must remain readable without any schema migration.
  await pool.query(`INSERT INTO transit_stop_times(id,mode,agency,trip_id,stop_id,sequence,arrival_seconds,departure_seconds,data)
    VALUES ('legacy:row','live','mta-bus','old','old',1,0,0,'{}'),
      ('other:row','live','other','other','other',1,0,0,'{}'),
      ('mta-bus:demo','demo','mta-bus','demo','demo',1,0,0,'{}')`);
  const lock = await pool.connect();
  await lock.query("SELECT pg_advisory_lock($1)", [IMPORT_LOCK]);
  await assert.rejects(importGtfs("mta-bus"), /already running/);
  assert.equal(fetched, 0);
  await lock.query("SELECT pg_advisory_unlock($1)", [IMPORT_LOCK]);
  lock.release();
  await importGtfs("mta-bus");
  assert.equal(fetched, 6);
  const data = (await pool.query("SELECT data FROM transit_feed_snapshots WHERE id='mta-bus:static' AND mode='live'")).rows[0].data;
  assert.equal(data.components.length, 6);
  assert.equal(data.sourceUrl, adapters.find(a => a.id === "mta-bus")!.staticUrl);
  assert.match(data.stopTimesMode, /^import-/);
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode=$1", [data.stopTimesMode])).rows[0].count, "12");
  assert.equal((await pool.query("SELECT count(*) FROM transit_trips WHERE mode='live' AND agency='mta-bus'")).rows[0].count, "6");
  assert.equal((await pool.query("SELECT data FROM transit_stops WHERE id='mta-bus:S' AND mode='live'")).rows[0].data.routes.length, 6);
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE agency='other' OR mode='demo'")).rows[0].count, "2");
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE id='legacy:row'")).rows[0].count, "0");
  const times = await timetable({ ...timetableDefaults, mode: "live", date: "2026-10-30", stopId: "mta-bus:S" });
  assert.equal(times.total, 6);
  assert.equal((await timetable({ ...timetableDefaults, mode: "live", date: "2026-10-30", routeId: "mta-bus:R0" })).total, 1);
  assert.equal((await timetable({ ...timetableDefaults, mode: "live", date: "2026-11-01", stopId: "mta-bus:S" })).total, 0);
  const stop = (await allStops("live")).find(s => s.id === "mta-bus:S")!;
  assert.equal((await scheduledArrivals(stop, new Set(), Date.parse("2026-10-30T13:50:00Z"))).length, 6);
  assert.equal((await routeDetail("mta-bus:R0", "live"))!.stops.length, 2);
  assert.equal((await network({ mode: "live", zoom: 12 })).lines.length, 6);
  const published = await dumpPublished();
  // The sixth package fails after five have been staged: no partial coverage.
  failPackage = 5;
  await assert.rejects(importGtfs("mta-bus"), /503/);
  assert.deepEqual(await dumpPublished(), published);
  failPackage = -1;
  // Force a failure at the very end of the publication transaction.
  await pool.query(`CREATE FUNCTION reject_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='mta-bus:static' THEN RAISE EXCEPTION 'synthetic publication failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_publication BEFORE UPDATE ON transit_feed_snapshots FOR EACH ROW EXECUTE FUNCTION reject_publication()`);
  await assert.rejects(importGtfs("mta-bus"), /Failed query/);
  assert.deepEqual(await dumpPublished(), published);
  await pool.query("DROP TRIGGER reject_publication ON transit_feed_snapshots; DROP FUNCTION reject_publication()");
  // Cleanup failure after COMMIT is a maintenance warning, not failed publication.
  await pool.query(`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic cleanup failure'; END $$;
    CREATE TRIGGER reject_cleanup BEFORE DELETE ON transit_stop_times FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`);
  await importGtfs("mta-bus");
  const newer = (await pool.query("SELECT data FROM transit_feed_snapshots WHERE id='mta-bus:static' AND mode='live'")).rows[0].data;
  assert.notEqual(newer.stopTimesMode, data.stopTimesMode);
  assert.equal((await pool.query("SELECT count(*) FROM transit_feed_snapshots WHERE id='mta-bus:import-error'")).rows[0].count, "0");
  await pool.query("DROP TRIGGER reject_cleanup ON transit_stop_times; DROP FUNCTION reject_cleanup()");
  // Simulate an abandoned generation after process death; cleanup must resume.
  await pool.query(`INSERT INTO transit_feed_snapshots(id,mode,agency,data) VALUES
    ('mta-bus:generation:abandoned','live','mta-bus','{"kind":"gtfs-generation","stage":"import-abandoned"}');
    INSERT INTO transit_stop_times SELECT id,'import-abandoned',agency,trip_id,stop_id,sequence,
      arrival_seconds,departure_seconds,data,updated_at FROM transit_stop_times WHERE mode='demo'`);
  const owner = await pool.connect();
  await owner.query("SELECT pg_advisory_lock($1)", [IMPORT_LOCK]);
  try {
    await cleanupGenerations(3);
    assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode=$1", [data.stopTimesMode])).rows[0].count, "9");
    assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode=$1", [newer.stopTimesMode])).rows[0].count, "12");
    await cleanupGenerations(20000);
  }
  finally { await owner.query("SELECT pg_advisory_unlock($1)", [IMPORT_LOCK]); owner.release(); }
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode='import-abandoned' OR mode=$1", [data.stopTimesMode])).rows[0].count, "0");
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode=$1", [newer.stopTimesMode])).rows[0].count, "12");
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE agency='other' OR mode='demo'")).rows[0].count, "2");
  await pool.query(`CREATE FUNCTION reject_rollback() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='mta-bus:static' THEN RAISE EXCEPTION 'synthetic rollback interruption'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_rollback BEFORE UPDATE ON transit_feed_snapshots FOR EACH ROW EXECUTE FUNCTION reject_rollback()`);
  await assert.rejects(restoreLegacyStopTimes("mta-bus"), /synthetic rollback interruption/);
  assert.equal((await pool.query("SELECT data FROM transit_feed_snapshots WHERE id='mta-bus:static' AND mode='live'")).rows[0].data.stopTimesMode, newer.stopTimesMode);
  await pool.query("DROP TRIGGER reject_rollback ON transit_feed_snapshots; DROP FUNCTION reject_rollback()");
  await restoreLegacyStopTimes("mta-bus");
  assert.equal((await pool.query("SELECT data FROM transit_feed_snapshots WHERE id='mta-bus:static' AND mode='live'")).rows[0].data.stopTimesMode, undefined);
  assert.equal((await pool.query("SELECT count(*) FROM transit_stop_times WHERE mode='live' AND agency='mta-bus'")).rows[0].count, "12");
  assert.equal((await timetable({ ...timetableDefaults, mode: "live", date: "2026-10-30", stopId: "mta-bus:S" })).total, 6);
  await restoreLegacyStopTimes("mta-bus"); // Idempotent after successful rollback.
  console.log("PASS: six-package publication, stable IDs, source metadata, legacy fallback, all schedule readers, exceptions, untimed ordering, advisory lock, failed download, transactional rollback, cleanup failure, abandoned-generation recovery, demo/operator isolation");
} finally {
  globalThis.fetch = nativeFetch;
  await pool.end();
}
