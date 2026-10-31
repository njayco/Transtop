import { DateTime } from "luxon";
import { gtfsSeconds, serviceInstant } from "../time";
import type { Arrival, TransitStop } from "../types";
import { request, coverage, safeMessage } from "./client";
import { lookup, parseIdentity, normalizeRoute, normalizeAlerts } from "./model";
import { globalStop, globalRoute, agencyZone, stopRecord } from "./discovery";

const MAX_SOURCE_AGE = 45 * 86400000;
export function eligibleDate(d: any, requested: string) {
  // API service-window fallback can echo a requested date; require both explicit opt-out
  // in the request and a matching returned service date. Reject missing dates too.
  return d?.service_date === requested && !d.interpolated && Number(d.pickup_type || 0) === 0 &&
    !["CANCELED","CANCELLED","DELETED","SKIPPED","NO_DATA"].includes(d.schedule_relationship || d.trip?.schedule_relationship);
}
export function freshTimestamp(stamp: unknown, now = Date.now()) {
  const value = typeof stamp === "number" ? stamp * 1000 : Date.parse(String(stamp || ""));
  return Number.isFinite(value) && value <= now + 30000 && now - value <= 60000 ? value : undefined;
}
function utc(value: unknown) {
  // API `_utc` fields have no suffix in some deployments; explicitly interpret them as UTC.
  const d = typeof value === "string" ? DateTime.fromISO(value,{ zone: "utc" }) : null;
  return d?.isValid ? d.toMillis() : undefined;
}
export function normalizeDeparture(d: any, s: TransitStop, date: string, zone: string, now = Date.now()) {
  if (!eligibleDate(d,date) || !d.trip?.trip_id || !s.transitland) return;
  const r = normalizeRoute(d.trip.route,s.transitland);
  if (!r || !s.routes.some(v => v.id === r.id)) return;
  const event = d.departure || {};
  let scheduled = utc(event.scheduled_utc);
  if (scheduled === undefined) {
    try { scheduled = serviceInstant(date.replaceAll("-",""),gtfsSeconds(d.departure_time || event.scheduled),zone); } catch { return; }
  }
  if (!Number.isFinite(scheduled)) return;
  const observed = freshTimestamp(d.trip.timestamp,now);
  const relation = d.schedule_relationship || d.trip.schedule_relationship || "STATIC";
  const predicted = observed && relation !== "STATIC" && relation !== "NO_DATA" ? utc(event.estimated_utc) : undefined;
  const time = predicted ?? scheduled;
  return { id: `${s.id}:${date}:${d.trip.trip_id}:${d.stop_sequence}`, tripId: `${s.id}:${d.trip.trip_id}`,
    stopId: s.id, stopName: s.name, routeId: r.id, routeName: r.name, color: r.color,
    direction: `${d.trip.direction_id ?? 0} · ${d.trip.trip_headsign || "Destination not supplied"}`,
    destination: d.stop_headsign || d.trip.trip_headsign || r.longName || "Destination not supplied",
    time: new Date(scheduled).toISOString(), timezone: zone,
    arrival: { id: `${s.id}:${date}:${d.trip.trip_id}:${d.stop_sequence}`, tripId: `${s.id}:${d.trip.trip_id}`,
      routeId: r.id, routeName: r.name, color: r.color,
      direction: `${d.trip.direction_id ?? 0} · ${d.trip.trip_headsign || "Destination not supplied"}`,
      destination: d.stop_headsign || d.trip.trip_headsign || r.longName || "Destination not supplied",
      minutes: Math.max(0,Math.ceil((time - now) / 60000)), source: predicted !== undefined ? "live" : "scheduled",
      updatedAt: predicted !== undefined ? new Date(observed!).toISOString() : s.transitland.fetchedAt,
      scheduledAt: new Date(time).toISOString(), publishedAt: new Date(scheduled).toISOString(), timezone: zone,
      ...(predicted !== undefined ? { expiresAt: new Date(observed! + 60000).toISOString() } : {}),
      status: predicted !== undefined ? "Transitland · fresh agency prediction" : "Transitland · published schedule" } as Arrival };
}
export async function stopDepartures(stop: TransitStop, date?: string, from = "00:00", cursor?: string) {
  const info = stop.transitland!, empty = { rows: [] as NonNullable<ReturnType<typeof normalizeDeparture>>[], zone: info.timezone,
    message: "No timetable supplied.", hasMore: false };
  const age = Date.now() - Date.parse(info.fetchedAt);
  if (!Number.isFinite(age) || age > MAX_SOURCE_AGE || age < -30000) return { ...empty,
    message: "This source snapshot is older than 45 days or has no reliable publication date. Current departures are withheld; catalog locations may be outdated." };
  let zone = info.timezone || stop.stop_timezone;
  if (!zone) {
    const [feed] = parseIdentity(stop.id);
    const raw = await stopRecord(stop.id);
    zone = await agencyZone(feed,raw?.route_stops?.[0]?.route?.agency);
  }
  if (!zone) return { ...empty, message: "Agency timezone is unavailable. Timetable clocks are withheld rather than interpreted as New York time." };
  const day = date || DateTime.now().setZone(zone).toISODate()!;
  const record=await stopRecord(stop.id);
  if(!Number.isSafeInteger(record?.id))return {...empty,message:"Stop lookup is currently unavailable."};
  const json = await request(`stops/${record.id}/departures`, { ...(date?{service_date:day,start_time:from+":00"}:{next:7200}), limit: 25,
    use_service_window: "false", include_alerts: false, ...(cursor ? { after: cursor } : {}) }, date ? 300000 : 30000);
  const raw = json.stops?.[0];
  const rows:NonNullable<ReturnType<typeof normalizeDeparture>>[] = (raw?.departures || []).slice(0,1000).flatMap((d: any) => {
    const serviceDay=date?day:d.service_date;
    if(!date&&(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDay||"")||Math.abs(DateTime.fromISO(serviceDay,{zone}).diff(DateTime.fromISO(day,{zone}),"days").days)>2))return [];
    const row = normalizeDeparture(d,stop,serviceDay,zone!); return row ? [row] : [];
  });
  return { rows, zone, message: `Transitland published service-day timetable · ${zone}. Source ${info.fetchedAt.slice(0,10)}. Interpolated, restricted boarding and substituted historical dates are withheld. ${(raw?.departures?.length||0)>1000?"Source results bounded at 1,000 rows; choose a later From time.":""} ${json.meta?.hasNext ? "More departures exist; advance the page." : ""}`,
    hasMore: !!json.meta?.hasNext, after: json.meta?.after, rawAlerts: raw?.alerts || [] };
}
export async function globalEnrich(stop: TransitStop): Promise<TransitStop> {
  try {
    const d = await stopDepartures(stop), now = Date.now();
    const arrivals = d.rows.map(r => r.arrival).filter(a => Date.parse(a.scheduledAt) >= now - 30000 && Date.parse(a.scheduledAt) <= now + 7200000).slice(0,24);
    const record=await stopRecord(stop.id);
    let notices:any[]=[];let noticeMessage="";
    try{
      if(Number.isSafeInteger(record?.id))notices=(await request(`stops/${record.id}`,{include_alerts:true},60000)).stops?.[0]?.alerts||[];
    }catch(err){noticeMessage=`Agency notices unavailable: ${safeMessage(err)}`;}
    const alerts=normalizeAlerts(notices,stop.id,stop.routes.map(r=>r.id));
    return { ...stop, arrivals, alerts, transitland: { ...stop.transitland!, timezone: d.zone, notes: [...(stop.transitland?.notes||[]),d.message,...(noticeMessage?[noticeMessage]:[])] } };
  } catch (err) { return { ...stop, transitland: { ...stop.transitland!, notes: [safeMessage(err)] } }; }
}
export async function globalTimetable(
  p: {stopId?:string;routeId?:string;date:string;from?:string;offset?:number;limit?:number;direction?:string},
  source = { globalStop, globalRoute, stopDepartures },
) {
  const empty = { departures: [], total: 0, offset: p.offset || 0, limit: p.limit || 40, date: p.date, message: "" };
  try {
    let stop = p.stopId ? await source.globalStop(p.stopId) : undefined;
    // An explicit boarding selection must never become a different stop.
    if (!p.stopId && p.routeId) stop = (await source.globalRoute(p.routeId,p.direction))?.stops[0];
    if (!stop) return { ...empty, message: "No supplied boarding stop pattern is available. Select a stop from the map." };
    if (p.routeId && !stop.routes.some(r => r.id === p.routeId)) return { ...empty, message: "This stop does not serve the selected route." };
    const limit = p.limit || 40, offset = p.offset || 0;
    // Follow at most three source pages. More results remain explicitly partial, not an invented exact total.
    let rows: any[] = [], after: string | undefined, more = false, message = "", zone = stop.transitland?.timezone;
    for (let page = 0; page < 3; page++) {
      const d = await source.stopDepartures(stop,p.date,p.from || "00:00",after);
      rows.push(...d.rows.filter(r => (!p.routeId || r.routeId === p.routeId) && (!p.direction || r.direction === p.direction)));
      more = d.hasMore; message = d.message; zone = d.zone;
      if (!more || rows.length >= offset + limit) break;
      after = String(d.after);
    }
    const departures = rows.slice(offset,offset+limit).map(({arrival,color,...r}) => r);
    return { ...empty, departures, total: rows.length, timezone: zone,
      message: message + (more ? " Total counts loaded rows only; select a later From time if the bounded page range is exhausted." : ""), globalCoverage: {...coverage(message),hasMore:more} };
  } catch (err) { return { ...empty, message: safeMessage(err), globalCoverage: coverage(safeMessage(err)) }; }
}
