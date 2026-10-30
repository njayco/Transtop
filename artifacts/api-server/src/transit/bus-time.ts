import { pool } from "@workspace/db";

// Keep credential-free URLs as cache/snapshot identifiers. The key belongs only
// on the outbound server request, never in persisted source metadata or logs.
export const busRealtimeUrls = ["tripUpdates", "vehiclePositions", "alerts"]
  .map(name => `https://gtfsrt.prod.obanyc.com/${name}`);

export function busRequestUrl(url: string) {
  if (!busRealtimeUrls.includes(url)) return url;
  const key = process.env.MTA_BUS_TIME_API_KEY;
  if (!key) throw new Error("MTA Bus Time credentials not configured");
  const request = new URL(url);
  request.searchParams.set("key", key);
  return request.toString();
}

/** Static borough feeds scope trips; Bus Time publishes the original trip IDs. */
export function tripIdentity(id: string | undefined) {
  return id?.replace(/^mta-bus:(?:m|bx|b|q|si|busco)~/, "mta-bus:");
}

export async function matchBusTrips(entities: any[]) {
  const raw = [...new Set<string>(entities.flatMap(e => e.tripUpdate?.trip?.tripId ? [e.tripUpdate.trip.tripId] : []))];
  if (!raw.length) return;
  const ids = raw.flatMap(id => ["m", "bx", "b", "q", "si", "busco"].map(feed => `mta-bus:${feed}~${id}`));
  const { rows } = await pool.query(
    "SELECT id,data FROM transit_trips WHERE mode='live' AND agency='mta-bus' AND id=ANY($1::text[])", [ids]);
  const byRaw = new Map<string, any[]>();
  for (const row of rows) {
    const id = tripIdentity(row.id)!;
    const matches = byRaw.get(id) || [];
    matches.push(row);
    byRaw.set(id, matches);
  }
  for (const entity of entities) {
    const trip = entity.tripUpdate?.trip;
    if (!trip) continue;
    const matches = (byRaw.get(`mta-bus:${trip.tripId}`) || []).filter(row => row.data.route_id === trip.routeId);
    // Ambiguous or changed schedules must not be assigned to a different trip.
    if (matches.length !== 1) continue;
    trip.tripId = matches[0].id.slice("mta-bus:".length);
    trip.transtopHeadsign = matches[0].data.trip_headsign;
  }
}
