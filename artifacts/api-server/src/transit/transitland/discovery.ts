import { DateTime } from "luxon";
import { request, coverage, cursorState, nextCursor, safeMessage, enabled, TransitlandError } from "./client";
import { sourceId, sourceDate, licensed, sourceInfo, normalizeRoute, normalizeStop, directDuplicate, identity, lookup, parseIdentity, coordinates, geometryParts, normalizeAlerts } from "./model";
import type { TransitRoute, TransitStop } from "../types";
import type { Bounds } from "../map-geometry";
import { rememberRoute, feedState } from "./tracking";

export const unique = <T extends {id:string}>(items: T[]) => [...new Map(items.map(v => [v.id,v])).values()];
export async function feedInfo(id: string) {
  const f = (await request(`feeds/${encodeURIComponent(id)}`)).feeds?.[0];
  if (!licensed(f)) {
    feedState(id,"withheld · source reuse rights unconfirmed");
    throw new TransitlandError("Source feed reuse terms are unknown or incompatible; this feed is withheld.");
  }
  if(!f.capabilities?.vehicles)feedState(id,"catalog · no vehicle feed advertised",f.license?.attribution_text||id);
  return f;
}
export async function agencyZone(feed: string, agency: any) {
  if (!agency?.agency_id) return;
  const a = (await request("agencies",{feed_onestop_id:feed,agency_id:agency.agency_id,limit:1})).agencies?.[0];
  const zone = a?.agency_timezone;
  return typeof zone === "string" && DateTime.now().setZone(zone).isValid ? zone : undefined;
}
export async function infoFor(raw: any) {
  const id = sourceId(raw);
  if (!id) throw new Error("Missing source provenance");
  return sourceInfo(await feedInfo(id),sourceDate(raw));
}
export type GlobalQuery = {q?:string;lat?:number;lon?:number;type?:string;agency?:string;serviceClass?:string;cursor?:string};
export function matches(r: TransitRoute, p: GlobalQuery) {
  return (!p.type || p.type === "all" || r.type === p.type) && (!p.agency || p.agency === r.agencyId) &&
    (!p.serviceClass || p.serviceClass === "all" || p.serviceClass === r.serviceClass);
}
/** A page is bounded, not a world import. Unreviewed licenses are excluded, not inferred from HTTP success. */
export async function discover(p: GlobalQuery, direct: TransitRoute[], bbox?: Bounds) {
  const empty = { stops: [] as TransitStop[], routes: [] as TransitRoute[], rawRoutes: [] as any[], globalCoverage: coverage() };
  if (!enabled() || p.agency && !p.agency.startsWith("tl:")) return empty;
  if (bbox && (Math.abs(bbox.east - bbox.west) > 8 || bbox.north - bbox.south > 8)) return {
    ...empty, globalCoverage: coverage("Zoom in to a city to load worldwide Transitland stops and routes. No worldwide catalog is downloaded.") };
  try {
    const scope = bbox ? { bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}` } :
      p.q ? { search: p.q.slice(0,180) } : { lat: p.lat, lon: p.lon, radius: 3000 };
    const state=cursorState(p.cursor);
    let provider:{feed_onestop_id?:string;served_by_onestop_ids?:string}={};
    if(p.agency?.startsWith("tl:")){
      const [f,a]=parseIdentity(p.agency);
      const record=(await request("agencies",{feed_onestop_id:f,agency_id:a.replace(/^agency:/,""),limit:1})).agencies?.[0];
      provider={feed_onestop_id:f,...(record?.onestop_id?{served_by_onestop_ids:record.onestop_id}:{})};
    }
    const json = state.s===null?{stops:[]}:await request("stops", { ...scope,...provider, location_type: 0, include_routes: true, limit: 60, after: state.s });
    const searched=p.q&&state.r!==null?await request("routes",{search:p.q,...(provider.feed_onestop_id?{feed_onestop_id:provider.feed_onestop_id}:{}),
      limit:60,after:state.r}):undefined;
    const ss: TransitStop[] = [], rr: TransitRoute[] = [], rawRoutes: any[] = [];
    let withheld = 0;
    // Limit concurrent feed metadata loads and payload work even for malformed multi-feed responses.
    for (const raw of (Array.isArray(json.stops) ? json.stops : []).slice(0,60)) {
      try {
        const info = await infoFor(raw);
        const routes:TransitRoute[] = (raw.route_stops || []).slice(0,100).flatMap((rs: any) => {
          const r = normalizeRoute(rs.route,info);
          if (!r || directDuplicate(r,direct) || !matches(r,p)) return [];
          rawRoutes.push({ ...rs.route, feed_version: raw.feed_version }); return [r];
        });
        const stop = normalizeStop(raw,routes,info);
        if (stop) { ss.push(stop); rr.push(...routes); routes.forEach(r=>rememberRoute(r,stop.lat,stop.lon)); }
      } catch { withheld++; }
    }
    for(const raw of (searched?.routes||[]).slice(0,60)){
      try{
        const info=await infoFor(raw),r=normalizeRoute(raw,info);
        if(r&&!directDuplicate(r,direct)&&matches(r,p)){rr.push(r);rawRoutes.push(raw);}
      }catch{withheld++;}
    }
    return { stops: unique(ss), routes: unique(rr), rawRoutes, globalCoverage: coverage(
      `Transitland on-demand catalog; source dates and reuse terms vary. ${withheld ? `${withheld} records withheld for unavailable or unconfirmed source access. ` : ""}A missing result is not proof of no service.`,nextCursor(json,searched)) };
  } catch (err) { return { ...empty, globalCoverage: coverage(safeMessage(err)) }; }
}
export async function globalStop(id: string): Promise<TransitStop | undefined> {
  const raw = await stopRecord(id);
  if (!raw) return;
  const info = await infoFor(raw), rr = (raw.route_stops || []).flatMap((s: any) => {
    const r = normalizeRoute(s.route,info); return r ? [r] : [];
  });
  const zone = raw.stop_timezone || await agencyZone(info.feedId,raw.route_stops?.[0]?.route?.agency);
  return normalizeStop(raw,rr,{ ...info, timezone: zone });
}
export async function stopRecord(id:string) {
  const [feed,raw]=parseIdentity(id);
  return (await request("stops",{feed_onestop_id:feed,stop_id:raw,include_routes:true,limit:1})).stops?.[0];
}
export async function routeRecord(id:string) {
  const [feed,raw]=parseIdentity(id);
  return (await request("routes",{feed_onestop_id:feed,route_id:raw,include_geometry:true,limit:1})).routes?.[0];
}
export async function globalRoute(id: string, direction?: string) {
  const raw = await routeRecord(id);
  if (!raw) return;
  const info = await infoFor(raw), zone = await agencyZone(info.feedId,raw.agency);
  const route = normalizeRoute(raw,{ ...info, timezone: zone }); if (!route) return;
  const patterns = await request(`routes/${raw.id}/trips`, { limit: 12, include_geometry: true });
  const trips = (patterns.trips || []).slice(0,12);
  const directions: string[] = [...new Set<string>(trips.map((t: any) => `${t.direction_id ?? 0} · ${t.trip_headsign || "Destination not supplied"}`))];
  const chosen = trips.find((t: any) => `${t.direction_id ?? 0} · ${t.trip_headsign || "Destination not supplied"}` === direction) || trips[0];
  let stops: TransitStop[] = [], shape = coordinates(raw.geometry);
  if (Number.isSafeInteger(chosen?.id)) {
    // Internal IDs are used only to follow this response, never as a saved identity.
    const trip = (await request(`routes/${raw.id}/trips/${chosen.id}`, { include_geometry: true })).trips?.[0];
    if (trip) {
      const tripShape = coordinates(trip.shape?.geometry || trip.shape);
      if (tripShape.length) shape = tripShape;
      stops = (trip.stop_times || []).filter((st:any)=>Number.isInteger(st.stop_sequence)&&st.stop_sequence>=0)
        .sort((a:any,b:any)=>a.stop_sequence-b.stop_sequence).slice(0,500).flatMap((st: any) => {
        const s = normalizeStop(st.stop,[route],{ ...info, timezone: zone }); return s ? [s] : [];
      });
      if (trip.wheelchair_accessible != null || trip.bikes_allowed != null) route.scheduleNotes?.push(
        `Trip wheelchair access: ${trip.wheelchair_accessible === 1 ? "reported accessible" : trip.wheelchair_accessible === 2 ? "not accessible" : "unknown"}. Bikes: ${trip.bikes_allowed === 1 ? "allowed" : trip.bikes_allowed === 2 ? "not allowed" : "unknown"}.`);
      for(const f of (Array.isArray(trip.frequencies)?trip.frequencies:[]).slice(0,10)){
        if(Number(f.headway_secs)>0)route.scheduleNotes?.push(`Published frequency: about every ${Math.round(Number(f.headway_secs)/60)} minutes, ${String(f.start_time||"").slice(0,20)}–${String(f.end_time||"").slice(0,20)}. This is not an exact departure prediction.`);
      }
    }
  }
  route.scheduleNotes?.push(`Showing one supplied stop pattern; ${directions.length} discovered direction/destination patterns. Other branches may exist.`,
    patterns.meta?.hasNext ? "More trip patterns are available from the source; this view is bounded to twelve." : "No additional pattern page reported.");
  return { route, stops, shape, vehicles: [], alerts: normalizeAlerts(raw.alerts,id,[id]), directions };
}
export async function globalNetwork(b: Bounds, p: GlobalQuery, direct: TransitRoute[]) {
  const page = await discover(p,direct,b), lines: {route:TransitRoute;shape:number[][];shapeId:string;vehicles:never[]}[] = [];
  // Geometry is fetched only for a bounded selection; expose absent lines rather than inventing paths.
  for (const route of page.routes.slice(0,12)) {
    try {
      const raw = await routeRecord(route.id);
      const parts = geometryParts(raw?.geometry);
      if (parts.length) {
        const full = normalizeRoute(raw,route.transitland!);
        parts.forEach((shape,i)=>lines.push({ route: full || route, shape, shapeId: `${route.id}:${sourceDate(raw)}:${i}`, vehicles: [] }));
      }
    } catch { /* Stops remain available when path access is unavailable. */ }
  }
  return { ...page, lines, missing: page.routes.filter(r => !lines.some(l => l.route.id === r.id)) };
}
// Only feed-scoped exact identities, never an API internal integer, are persisted in favorites.
export { identity, parseIdentity };
