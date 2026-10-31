import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { adapters, type AgencyAdapter } from "../adapters";
import { enabled, request, MobilityError } from "./client";
import { normalizeFeed, agencyId, validFeedId, licenseOf, routeMode, type FeedRecord } from "./model";
import { logger } from "../../lib/logger";
import type { MobilityInfo } from "../types";

const active = new Map<string, FeedRecord>();
let scanning = false;
const recentRegions = new Map<string, number>();
const MAX_FEEDS = 8;
export const recordFor = (id: string) => active.get(id);
export function infoFor(record: FeedRecord, timezone = record.timezone!): MobilityInfo {
  return { feedId: record.id, datasetId: record.datasetId!, url: record.url, license: record.license!,
    licenseUrl: record.licenseUrl!, attribution: `${record.provider}. Source: Mobility Database. Modified for Transtop.`,
    timezone, downloadedAt: record.downloadedAt!, validFrom: record.validFrom!, validThrough: record.validThrough!, transitlandId:record.transitlandId };
}
export async function catalog(params: { country?: string; provider?: string; offset?: number; lat?: number; lon?: number; kind?: string }) {
  if (!enabled()) return { feeds: [] as FeedRecord[], offset: 0, hasMore: false, status: "Mobility Database is disabled or its refresh token is missing." };
  const kind = params.kind === "gtfs_rt" ? "gtfs_rt" : "gtfs";
  const args: Record<string, string | number | undefined> = { limit: 20, offset: params.offset || 0,
    country_code: params.country, provider: params.provider, is_official: "true" };
  if (kind === "gtfs" && params.lat !== undefined && params.lon !== undefined) {
    args.dataset_latitudes = `${Math.max(-90, params.lat - .12)},${Math.min(90, params.lat + .12)}`;
    args.dataset_longitudes = `${Math.max(-180, params.lon - .15)},${Math.min(180, params.lon + .15)}`;
    args.bounding_filter_method = "partially_enclosed";
  }
  const key = "mobility:catalog:" + createHash("sha256").update(JSON.stringify({ kind, args })).digest("hex");
  const { rows } = await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1", [key]);
  let feeds: FeedRecord[]; let more = false;
  if (rows[0]?.data?.expires > Date.now()) { feeds = rows[0].data.feeds; more = rows[0].data.hasMore; }
  else {
    const raw = await request(kind === "gtfs" ? "gtfs_feeds" : "gtfs_rt_feeds", args);
    if (!Array.isArray(raw)) throw new MobilityError("Mobility Database returned an unsupported catalog response.");
    more = raw.length === 20;
    feeds = raw.slice(0, 20).flatMap(f => {
      const record = normalizeFeed(f, adapters, active.has(agencyId(f.id)));
      return record ? [record] : [];
    });
    await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data) VALUES('live',$1,'mobility',$2)
      ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`,
      [key, { expires: Date.now() + 6 * 3600_000, feeds, hasMore: more }]);
    await pool.query(`DELETE FROM transit_feed_snapshots WHERE mode='live' AND id IN (
      SELECT id FROM transit_feed_snapshots WHERE id LIKE 'mobility:catalog:%' AND mode='live'
      AND (data->>'expires')::bigint<$1 LIMIT 20)`, [Date.now() - 86400_000]);
  }
  const imported=await pool.query("SELECT agency FROM transit_feed_snapshots WHERE mode='live' AND agency=ANY($1::text[]) AND id=agency||':static'",[feeds.map(f=>agencyId(f.id))]);
  const importedIds=new Set(imported.rows.map(r=>r.agency));
  return { feeds: feeds.map(f => ({ ...f, imported: importedIds.has(agencyId(f.id)) })),
    offset: params.offset || 0, hasMore: more,
    status: "Worldwide feed catalog. Only approved, current, capacity-safe schedules are imported; a listing is not live coverage." };
}
async function attach(record: FeedRecord, realtime: string[]) {
  const id = agencyId(record.id);
  const a: AgencyAdapter = { id, name: record.provider, type: "rail", staticUrl: record.hostedUrl,
    realtimeUrls: realtime, documentation: record.url, status: "scheduled only",
    setup: `${record.provider}. Source: Mobility Database; ${record.license} (${record.licenseUrl}). Modified for Transtop. ${record.timezone}. Only verified coordinates and matched fresh predictions qualify as live.`,
    mobility: infoFor(record) };
  a.staticRouteTypes = Array.from({length:1000},(_,n)=>n).filter(n=>routeMode(String(n))!==undefined).map(String);
  const old = adapters.find(a => a.id === id);
  if (old) Object.assign(old, a); else adapters.push(a);
  active.set(id, record);
}
export async function prepareFeed(id: string) {
  if (!validFeedId(id)) throw new MobilityError("Invalid Mobility Database feed ID.");
  if (!active.has(agencyId(id)) && active.size >= MAX_FEEDS) throw new MobilityError("Mobility Database active-feed capacity reached.");
  const raw = await request(`gtfs_feeds/${id}`);
  const record = normalizeFeed(raw, adapters, false);
  if (!record?.eligible) throw new MobilityError(record?.reason || "This feed cannot be imported safely.");
  if(active.get(agencyId(id))?.timezone&&active.get(agencyId(id))!.timezone!==record.timezone)throw new MobilityError("Agency timezone changed; this feed needs review before refresh.");
  const rtRaw = await request(`gtfs_feeds/${id}/gtfs_rt_feeds`);
  const realtime: string[] = [];
  for (const rt of (Array.isArray(rtRaw) ? rtRaw : []).slice(0, 12)) {
    // A realtime feed's own rights and exact static reference are independently checked.
    if (rt.status !== "active" || rt.official !== true || rt.source_info?.authentication_type !== 0 ||
      !licenseOf(rt) || !rt.feed_references?.includes(id)) continue;
    const value = rt.source_info?.producer_url;
    if (typeof value !== "string") continue;
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.username || u.password || [...u.searchParams.keys()].some(k => /key|token|secret|auth|password/i.test(k))) continue;
      realtime.push(value);
    } catch { /* Withhold invalid endpoints. */ }
  }
  if(record.id!==id)throw new MobilityError("Catalog feed redirects require review before import.");
  // Store only safe, normalized metadata, never raw producer fields or API responses.
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('transtop-mobility-registry'))");
    const total=await client.query("SELECT count(*)::int AS count FROM transit_feed_snapshots WHERE mode='live' AND id LIKE 'mobility:registered:%' AND id<>$1",[`mobility:registered:${id}`]);
    if(total.rows[0].count>=MAX_FEEDS)throw new MobilityError("Mobility Database active-feed capacity reached.");
    await client.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data) VALUES('live',$1,'mobility',$2)
      ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`,
      [`mobility:registered:${id}`, { record, realtime:[...new Set(realtime)].slice(0,3) }]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
  await attach(record,[...new Set(realtime)].slice(0,3));
  return record;
}
export async function restoreRegistry() {
  if (!enabled()) return;
  const { rows } = await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id LIKE 'mobility:registered:%' ORDER BY updated_at DESC LIMIT $1", [MAX_FEEDS]);
  for (const { data } of rows) {
    const r = data.record as FeedRecord;
    // Persisted records were normalized before insertion. Revalidate current window and fixed archive host on refresh.
    if (r?.eligible && validFeedId(r.id) && Date.parse(r.validThrough!) > Date.now()) await attach(r, data.realtime || []);
  }
}
/** Discover only near a rider-selected point, then asynchronously stage one small new feed. */
export function discoverRegion(lat: number, lon: number) {
  if (!enabled() || scanning || active.size >= MAX_FEEDS || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const key = `${Math.round(lat * 5)},${Math.round(lon * 5)}`;
  if ((recentRegions.get(key) || 0) > Date.now() - 6 * 3600_000) return;
  if (recentRegions.size > 100) recentRegions.clear();
  recentRegions.set(key, Date.now()); scanning = true;
  void (async () => {
    const list = await catalog({ lat, lon });
    const next = list.feeds.find(f => f.eligible && !active.has(agencyId(f.id)));
    if (!next) return;
    // Two new automatic feeds/day at most, persisted and shared across replicas.
    const { rows } = await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
      VALUES('live',$1,'mobility','{"used":1}') ON CONFLICT(mode,id) DO UPDATE
      SET data=jsonb_build_object('used',(transit_feed_snapshots.data->>'used')::int+1),updated_at=now()
      WHERE (transit_feed_snapshots.data->>'used')::int<2 RETURNING id`, [`mobility:imports:${new Date().toISOString().slice(0, 10)}`]);
    if (!rows.length) return;
    await prepareFeed(next.id);
    const { importGtfs } = await import("../importer");
    await importGtfs(agencyId(next.id));
  })().catch(() => logger.warn("Mobility Database discovery/import withheld; existing services retained"))
    .finally(() => { scanning = false; });
}
let refreshing = false;
export async function refreshRegistered() {
  if (!enabled() || refreshing) return;
  refreshing = true;
  try {
    for (const record of [...active.values()]) {
      const { rows } = await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1", [`${agencyId(record.id)}:static`]);
      if (rows[0]?.data?.importedAt && Date.now() - Date.parse(rows[0].data.importedAt) < 24 * 3600_000) continue;
      try {
        await prepareFeed(record.id);
        const { importGtfs } = await import("../importer");
        await importGtfs(agencyId(record.id));
      } catch { logger.warn({ feedId: record.id }, "Mobility Database refresh withheld; previous complete schedule retained"); }
    }
  } finally { refreshing = false; }
}
