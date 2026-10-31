import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

const ORIGIN = "https://api.mobilitydatabase.org/v1/";
const flights = new Map<string, Promise<any>>();
let token: { value: string; until: number } | undefined;
let authenticating: Promise<string> | undefined;
let backoff = 0;
export const enabled = () => process.env.MOBILITY_DATABASE_ENABLED !== "false" && !!process.env.MOBILITY_DATABASE_REFRESH_TOKEN;
export class MobilityError extends Error {}

async function json(response: Response) {
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) backoff = Date.now() + 60_000;
    throw new MobilityError(response.status === 401 || response.status === 403
      ? "Mobility Database access was denied. Check the server-side refresh token."
      : "Mobility Database is temporarily unavailable.");
  }
  if (!response.body) throw new MobilityError("Mobility Database returned an empty response.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 6_000_000) throw new MobilityError("Mobility Database response exceeds the safety limit.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function accessToken() {
  if (token && token.until > Date.now()) return token.value;
  if (authenticating) return authenticating;
  authenticating = (async () => {
    const body = await json(await fetch(`${ORIGIN}tokens/access`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: process.env.MOBILITY_DATABASE_REFRESH_TOKEN }),
    }));
    if (typeof body.access_token !== "string" || !body.access_token) throw new MobilityError("Mobility Database token exchange failed.");
    const expiry = Date.parse(body.expiration_datetime_utc);
    token = { value: body.access_token, until: Math.min(Date.now() + 50 * 60_000, Number.isFinite(expiry) ? expiry - 60_000 : Date.now() + 50 * 60_000) };
    return token.value;
  })().finally(() => { authenticating = undefined; });
  return authenticating;
}
/** Server-only credential exchange; catalog metadata is cached, not bearer tokens or raw responses. */
export async function request(path: string, params: Record<string, string | number | undefined> = {}) {
  if (!enabled()) throw new MobilityError("Mobility Database is disabled or its refresh token is missing.");
  if (!/^(?:gtfs_feeds|gtfs_rt_feeds)(?:\/[a-z0-9-]+(?:\/gtfs_rt_feeds)?)?$/.test(path)) throw new MobilityError("Invalid catalog resource.");
  const url = new URL(path, ORIGIN);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const key = "mobility:cache:" + createHash("sha256").update(url.href).digest("hex");
  const work = flights.get(key); if (work) return work;
  const task = (async () => {
    if (Date.now() < backoff) throw new MobilityError("Mobility Database is cooling down after a provider error.");
    // A conservative shared database reservation. Separate dev/prod databases receive disjoint allowances.
    const limit = process.env.REPLIT_DEPLOYMENT === "1" ? 180 : 20;
    const day = new Date().toISOString().slice(0, 10);
    const usage = await pool.query(`INSERT INTO transit_feed_snapshots(mode,id,agency,data)
      VALUES('live',$1,'mobility',jsonb_build_object('used',1))
      ON CONFLICT(mode,id) DO UPDATE SET data=jsonb_build_object('used',(transit_feed_snapshots.data->>'used')::int+1),updated_at=now()
      WHERE (transit_feed_snapshots.data->>'used')::int<$2 RETURNING id`, [`mobility:usage:${day}`, limit]);
    if (!usage.rowCount) throw new MobilityError("Mobility Database daily catalog allowance reached; imported services remain available.");
    let response = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (response.status === 401) { token = undefined; throw new MobilityError("Mobility Database access expired; retry after checking account access."); }
    const value = await json(response);
    // Never persist raw catalog data: it can contain producer credentials/contact addresses.
    // In-memory singleflight plus normalized catalog caching are handled by the caller.
    return value;
  })().catch(error => {
    if (error instanceof MobilityError) throw error;
    backoff = Date.now() + 60_000;
    throw new MobilityError("Mobility Database connection failed; existing transit data remains available.");
  }).finally(() => flights.delete(key));
  flights.set(key, task);
  return task;
}
