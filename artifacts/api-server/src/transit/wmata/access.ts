import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { download, setupStatus, WmataError } from "./client";
import { accessInfo, schemas, type AccessOperation, type AccessSnapshot, type AccessSnapshots } from "./access-model";
import type { TransitStop } from "../types";

interface AccessStore {
  read(key: string): Promise<AccessSnapshot | undefined>;
  lock(key: string, owner: string, now: number): Promise<boolean>;
  save(key: string, snapshot: AccessSnapshot): Promise<void>;
  release(key: string, owner: string): Promise<void>;
}
const store: AccessStore = {
  async read(key) {
    return (await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1", [key])).rows[0]?.data;
  },
  async lock(key, owner, now) {
    return !!(await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
      VALUES('live',$1,'wmata',jsonb_build_object('owner',$2::text,'until',$3::bigint+45000))
      ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()
      WHERE (transit_feed_snapshots.data->>'until')::bigint<$3 RETURNING id`, [key, owner, now])).rows.length;
  },
  async save(key, result) {
    await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data) VALUES('live',$1,'wmata',$2)
      ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`, [key, result]);
  },
  async release(key, owner) {
    await pool.query("DELETE FROM transit_feed_snapshots WHERE mode='live' AND id=$1 AND data->>'owner'=$2", [key, owner]);
  },
};
export function createAccessService(deps: { store: AccessStore; download: typeof download; setup: typeof setupStatus; now: () => number }) {
  const pending = new Map<AccessOperation, Promise<AccessSnapshot>>();
  async function load(op: AccessOperation): Promise<AccessSnapshot> {
  const key = `wmata:access:${op}`, now = deps.now();
  const previous = await deps.store.read(key);
  if (previous && previous.nextPoll > now) return previous;
  const owner = randomUUID(), lease = `${key}:lease`;
  const locked = await deps.store.lock(lease, owner, now);
  if (!locked) return previous || { state: "not checked", nextPoll: now + 10000 };
  try {
    let result: AccessSnapshot;
    try {
      const bytes = await deps.download(op);
      const data = schemas[op].parse(JSON.parse(bytes.toString()));
      // These APIs have no full-dataset source timestamp. This is the time the
      // request started, not a claim that every record was updated then.
      result = { data, checkedAt: now, state: "fresh", nextPoll: now + (op === "equipment-outages" ? 120000 : 86400000) };
    } catch (error) {
      result = { checkedAt: previous?.checkedAt, state: error instanceof WmataError ? error.state : "invalid response",
        nextPoll: deps.now() + (error instanceof WmataError && error.state === "access denied" ? 3600000 : 60000) };
    }
    await deps.store.save(key, result);
    return result;
  } finally {
    await deps.store.release(lease, owner);
  }
}
async function poll(op: AccessOperation) {
  let work = pending.get(op);
  if (!work) { work = load(op).finally(() => pending.delete(op)); pending.set(op, work); }
  try { return await work; }
  catch { return { state: "unavailable", nextPoll: deps.now() + 60000 } satisfies AccessSnapshot; }
}
async function stationAccess(stop: TransitStop) {
  const snapshots: AccessSnapshots = {};
  const setup = deps.setup();
  if (setup === "configured") {
    // Serialize under the existing shared quota and per-product backoff.
    for (const op of Object.keys(schemas) as AccessOperation[]) snapshots[op] = await poll(op);
  }
  return accessInfo(stop, snapshots, deps.now(), deps.setup());
}
  return { stationAccess };
}
export const { stationAccess } = createAccessService({ store, download, setup: setupStatus, now: Date.now });
