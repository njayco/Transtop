import { db, stops, routes, feedSnapshots } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { availabilityCache, uncertain, type FavoriteIdentity, type Verdict } from "./favorite-availability-cache";
import { isTransitland, parseIdentity, identity, sourceId } from "./transitland/model";
import { feedInfo } from "./transitland/discovery";
import { request as globalRequest } from "./transitland/client";
import * as tfl from "./tfl/service";
import { isTfl } from "./tfl/model";
import { intercityCatalog } from "./intercity/service";
import { isDocumentId } from "./intercity/uploaded-service";
import { documentStops, documentRoutes } from "./intercity/uploaded-data";
import { isRetiredResearchId } from "./intercity/retired";

const missing: Verdict = {
  status: "unavailable",
  message: "No longer listed under this saved ID in the source. It may have been removed or renumbered. This is not proof the service has stopped.",
};
const present = (name: string): Verdict => ({
  status: "available", currentName: name,
  message: "Listed in source metadata. This does not guarantee departures or live predictions.",
});

/** Check the saved identity only. No aliases, arrival fan-out or inferred replacements. */
export async function lookupFavorite(item: FavoriteIdentity): Promise<Verdict> {
  const { id, kind } = item;
  if (isRetiredResearchId(id)) return missing;
  if (isTransitland(id)) {
    const [feed, rawId] = parseIdentity(id);
    // Permission/coverage failures are uncertainty, not evidence of operator removal.
    await feedInfo(feed);
    const collection = kind === "stop" ? "stops" : "routes";
    const json = await globalRequest(collection, {
      feed_onestop_id: feed, [kind === "stop" ? "stop_id" : "route_id"]: rawId, limit: 1,
    });
    const rows = json[collection];
    if (!Array.isArray(rows)) return uncertain;
    if (!rows.length) return missing;
    const raw = rows[0], key = kind === "stop" ? "stop_id" : "route_id";
    if (sourceId(raw) !== feed || typeof raw[key] !== "string" || identity(feed, raw[key]) !== id) return uncertain;
    const name = kind === "stop" ? raw.stop_name : raw.route_short_name || raw.route_long_name || raw.route_id;
    return typeof name === "string" && name ? present(name) : uncertain;
  }
  if (isTfl(id)) {
    // This response's unexpired metadata is authoritative for the listing,
    // independently of the global health timer or unrelated prediction errors.
    const record = kind === "stop" ? await tfl.stop(id, true) : (await tfl.lines(true)).find(r => r.id === id);
    return record ? present(record.name) : missing;
  }
  if (isDocumentId(id)) {
    // A printed stop without map coordinates is still a source listing.
    const record = (kind === "stop" ? documentStops : documentRoutes).find(r => r.id === id);
    return record ? present(record.name) : missing;
  }
  if (id.startsWith("martz:")) {
    const catalog = await intercityCatalog();
    const record = (kind === "stop" ? catalog.stops : catalog.routes).find(r => r.id === id);
    // This catalog deliberately withholds stale/unverified documents; absence is not removal.
    return record ? present(record.name) : uncertain;
  }
  const agency = id.split(":")[0];
  const snapshots = await db.select().from(feedSnapshots).where(and(eq(feedSnapshots.mode, "live"), eq(feedSnapshots.agency, agency)));
  const snapshot = snapshots.find(s => s.id === `${agency}:static`)?.data;
  const failed = snapshots.find(s => s.id === `${agency}:import-error`)?.data;
  const today = DateTime.now().setZone("America/New_York").toFormat("yyyyMMdd");
  if (!snapshot?.serviceEnd || snapshot.serviceEnd < today || snapshot.serviceStart > today ||
      snapshot.components?.some((c: { serviceEnd?: string }) => !c.serviceEnd || c.serviceEnd < today) ||
      failed && (!snapshot.importedAt || failed.at > snapshot.importedAt)) return uncertain;
  if (kind === "stop") {
    const [record] = await db.select().from(stops).where(and(eq(stops.mode, "live"), eq(stops.id, id)));
    return record ? present(record.data.name) : missing;
  }
  const [record] = await db.select().from(routes).where(and(eq(routes.mode, "live"), eq(routes.id, id)));
  return record ? present(record.data.name) : missing;
}

export const favoriteAvailability = availabilityCache(lookupFavorite);
