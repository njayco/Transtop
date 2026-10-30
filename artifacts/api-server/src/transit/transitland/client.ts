import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

const ROOT = "https://transit.land/api/v2/rest/";
const inflight = new Map<string, Promise<any>>();
const failures = new Map<string,{until:number;message:string}>();
let error = "", blockedUntil = 0, used = 0, budgetCheckedAt=0;
export const enabled = () => process.env.TRANSITLAND_ENABLED === "true" && !!process.env.TRANSITLAND_API_KEY &&
  process.env.TRANSITLAND_ALLOW_BILLABLE === "true" && process.env.TRANSITLAND_PLAN === "production";
export const totalMonthlyLimit = () => Math.max(0, Math.min(9999, Math.floor(Number(process.env.TRANSITLAND_MONTHLY_REQUEST_LIMIT) || 0)));
export function allocatedLimit(total:number,published:boolean){const development=Math.floor(total/10);return published?total-development:development;}
export const monthlyLimit = () => allocatedLimit(totalMonthlyLimit(),process.env.REPLIT_DEPLOYMENT==="1");
export class TransitlandError extends Error {}

/** Atomic reservations survive restarts and coordinate replicas sharing this database. */
export async function reserveRequest(count = 1) {
  const month = new Date().toISOString().slice(0, 7), cap = monthlyLimit();
  const { rows } = await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
    SELECT 'live',$1,'transitland',jsonb_build_object('used',$2::int) WHERE $2::int <= $3::int
    ON CONFLICT(mode,id) DO UPDATE SET
      data=jsonb_build_object('used',(transit_feed_snapshots.data->>'used')::int+$2::int),updated_at=now()
    WHERE (transit_feed_snapshots.data->>'used')::int+$2::int <= $3::int RETURNING data`,
  [`transitland:usage:${month}`, count, cap]);
  if (!rows.length) {
    used=cap;error="Monthly Transitland request limit reached; cached and direct-source data remain available.";
    throw new TransitlandError(error);
  }
  used = rows[0].data.used;
  budgetCheckedAt=Date.now();
}
export async function usage() {
  const { rows } = await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",
    [`transitland:usage:${new Date().toISOString().slice(0, 7)}`]);
  used = rows[0]?.data.used || 0;
  budgetCheckedAt=Date.now();
  return { used, limit: monthlyLimit() };
}
export function coverage(message = "", cursor?: string) {
  return { status: !enabled() ? "setup required" : used>=monthlyLimit() ? "quota exhausted" : error ? "limited" : "on demand",
    message: (message || error || (enabled() ? "Transitland coverage varies by feed. Published schedules are not live vehicle tracking." : "Transitland is disabled or its approved production access is not configured."))+
      (enabled()?` ${process.env.REPLIT_DEPLOYMENT==="1"?"Published-app":"Development"} allowance: ${monthlyLimit()} of ${totalMonthlyLimit()} total approved monthly requests; the remainder is reserved for the other environment.`:""),
    hasMore: !!cursor, ...(cursor ? { cursor } : {}), used, limit: monthlyLimit() };
}
function clean(value: any): any {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !["authorization", "next", "prev"].includes(k)).map(([k,v]) => [k,clean(v)]));
}
export function cursorState(cursor?: string): {s?:string|null;r?:string|null} {
  if (!cursor) return {};
  if (!/^[a-zA-Z0-9_-]{1,280}$/.test(cursor)) throw new TransitlandError("Invalid Transitland page cursor");
  const value = Buffer.from(cursor, "base64url").toString();
  if (/^\d{1,20}$/.test(value)) return {s:value};
  try {
    const obj=JSON.parse(value);
    if(!obj||Array.isArray(obj)||Object.keys(obj).some(k=>!["s","r"].includes(k))||
      Object.values(obj).some(v=>v!==null&&(typeof v!=="string"||!/^\d{1,20}$/.test(v))))throw new Error();
    return obj;
  }catch{throw new TransitlandError("Invalid Transitland page cursor");}
}
export function cursorAfter(cursor?:string) { return cursorState(cursor).s||undefined; }
export function nextCursor(json: any, routes?:any) {
  const after=(v:any)=>v?.meta?.after!=null&&v?.meta?.hasNext?String(v.meta.after):null;
  const s=after(json),r=after(routes);
  return s||r?Buffer.from(JSON.stringify({s,r})).toString("base64url"):undefined;
}
/** Only known API paths; no arbitrary URL, redirect, credential query or pagination URL. */
export async function request(path: string, params: Record<string, string | number | boolean | undefined> = {}, ttl = 3600000): Promise<any> {
  if (!/^(stops|routes|feeds|agencies|operators)(\/[^/?#]+){0,4}$/.test(path)) throw new TransitlandError("Unsupported Transitland endpoint");
  const url = new URL(path, ROOT);
  if(!url.pathname.startsWith("/api/v2/rest/")||path.split("/").includes(".."))throw new TransitlandError("Unsupported Transitland endpoint");
  if(Date.now()-budgetCheckedAt>30000)await usage();
  for (const [k,v] of Object.entries(params).sort()) if (v !== undefined) url.searchParams.set(k,String(v));
  const key = `transitland:cache:${createHash("sha256").update(url.toString()).digest("hex")}`;
  const failed=failures.get(key);
  if(failed&&Date.now()<failed.until)throw new TransitlandError(failed.message);
  const existing = inflight.get(key); if (existing) return existing;
  const work = (async () => {
    const { rows } = await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1", [key]);
    const cached = rows[0]?.data;
    if (enabled() && cached && Date.now() < cached.expires) return cached.value;
    if (!enabled()) throw new TransitlandError(coverage().message);
    if (Date.now() < blockedUntil) throw new TransitlandError(error || "Transitland is temporarily unavailable");
    await reserveRequest();
    try {
      const res = await fetch(url, { headers: { apikey: process.env.TRANSITLAND_API_KEY!, "User-Agent": "Transtop/1.0" },
        redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        const message = res.status === 429 ? "Transitland rate/quota limit; retry later." :
          res.status === 401 || res.status === 403 ? "Transitland access denied for this resource or account." :
          res.status === 404 ? "Transitland has no available data for this resource." : "Transitland is temporarily unavailable.";
        // Resource-specific denial must not disable unrelated stops and schedules.
        if (res.status === 429 || res.status >= 500) { error = message; blockedUntil = Date.now() + 60000; }
        if(failures.size>=200)failures.delete(failures.keys().next().value!);
        failures.set(key,{message,until:Date.now()+60000});
        throw new TransitlandError(message);
      }
      if (!res.body) throw new TransitlandError("Transitland returned an empty response");
      const chunks: Uint8Array[] = []; let bytes = 0;
      for await (const chunk of res.body) {
        bytes += chunk.length;
        if (bytes > 6_000_000) throw new TransitlandError("Transitland response exceeded the safe size limit; narrow the area.");
        chunks.push(chunk);
      }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const value = clean(raw);
      if (raw.meta) value.meta = { after: raw.meta.after, hasNext: !!raw.meta.next };
      // Do not retain upstream credentials, URLs with embedded authorization, or the entire feed archive history.
      for (const f of value.feeds || []) {
        f.capabilities = { vehicles: !!f.urls?.realtime_vehicle_positions, alerts: !!f.urls?.realtime_alerts };
        delete f.urls; delete f.feed_versions; delete f.feed_state;
      }
      await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data) VALUES('live',$1,'transitland',$2)
        ON CONFLICT(mode,id) DO UPDATE SET data=excluded.data,updated_at=now()`, [key, { value, expires: Date.now() + ttl }]);
      error = "";
      // Bounded maintenance, never touch usage counters or other sources.
      await pool.query(`DELETE FROM transit_feed_snapshots WHERE mode='live' AND id IN (
        SELECT id FROM transit_feed_snapshots WHERE mode='live' AND id LIKE 'transitland:cache:%'
        AND (data->>'expires')::bigint < $1 LIMIT 30)`, [Date.now() - 86400000]);
      return value;
    } catch (err) {
      if (err instanceof TransitlandError) throw err;
      error = "Transitland connection failed; direct-source data remain available.";
      blockedUntil = Date.now() + 30000;
      throw new TransitlandError(error);
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key,work); return work;
}
export function safeMessage(err: unknown) {
  return err instanceof TransitlandError ? err.message : "Transitland is unavailable; existing local data remain available.";
}
