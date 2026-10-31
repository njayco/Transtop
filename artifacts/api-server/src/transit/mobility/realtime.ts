import { pool } from "@workspace/db";
import { activeService, serviceDates } from "../time";
import { recordFor } from "./registry";

const fresh = (value: unknown, now: number) => {
  const stamp = Number(value) * 1000;
  return Number.isFinite(stamp) && stamp > 0 && now - stamp <= 60_000 && stamp <= now + 30_000;
};
/** Only exact current static identities. A fresh feed header cannot establish per-vehicle freshness. */
export async function matchRealtime(entities: any[], agency: string, now = Date.now()) {
  const record = recordFor(agency);
  if (!record?.timezone) return [];
  const { rows: snapshots } = await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1", [`${agency}:static`]);
  const snapshot = snapshots[0]?.data;
  if (!snapshot?.stopTimesMode || snapshot.mobility?.datasetId !== record.datasetId) return [];
  const notices = entities.slice(0, 3000).filter(e => !e.isDeleted && e.alert);
  const alertOutput: any[] = [];
  if (notices.length) {
    const { rows: routes } = await pool.query("SELECT id FROM transit_routes WHERE mode='live' AND agency=$1 LIMIT 5000", [agency]);
    const known = new Set(routes.map(r => r.id.slice(agency.length + 1)));
    for (const e of notices.slice(0, 200)) {
      const selectors = (e.alert.informedEntity || []).filter((s: any) => known.has(s.routeId || s.trip?.routeId));
      // Route-scoped notices only; unknown/system-wide/stop-only scope is not guessed.
      if (selectors.length) alertOutput.push({ id:e.id, alert:{...e.alert,informedEntity:selectors} });
    }
  }
  const dates = serviceDates(now, record.timezone);
  const candidates = entities.slice(0, 3000).filter(e => {
    const value = e.tripUpdate || e.vehicle, trip = value?.trip;
    return !e.isDeleted && trip?.tripId && /^\d{8}$/.test(trip.startDate || "") && dates.includes(trip.startDate) &&
      fresh(value.timestamp, now) && [0, 3].includes(Number(trip.scheduleRelationship || 0));
  });
  const ids = [...new Set(candidates.map(e => `${agency}:${(e.tripUpdate || e.vehicle).trip.tripId}`))];
  if (!ids.length) {
    const {rows:after}=await pool.query("SELECT data->>'stopTimesMode' AS generation FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`${agency}:static`]);
    return after[0]?.generation===snapshot.stopTimesMode?alertOutput:[];
  }
  const { rows: trips } = await pool.query(`SELECT t.id,t.data,c.data AS calendar FROM transit_trips t
    LEFT JOIN transit_calendars c ON c.mode=t.mode AND c.id=t.agency||':'||(t.data->>'service_id')
    WHERE t.mode='live' AND t.agency=$1 AND t.id=ANY($2::text[])`, [agency, ids]);
  const { rows: exceptions } = await pool.query("SELECT data FROM transit_calendar_exceptions WHERE mode='live' AND agency=$1 AND data->>'date'=ANY($2::text[])", [agency, dates]);
  const { rows: times } = await pool.query("SELECT trip_id,data FROM transit_stop_times WHERE mode=$1 AND trip_id=ANY($2::text[])", [snapshot.stopTimesMode, ids]);
  const tripMap = new Map(trips.map(t => [t.id, t]));
  const calls = new Map<string, any[]>();
  for (const t of times) { const list = calls.get(t.trip_id) || []; list.push(t.data); calls.set(t.trip_id, list); }
  const out: any[] = [...alertOutput];
  for (const e of candidates) {
    const item = e.tripUpdate || e.vehicle, trip = item.trip, id = `${agency}:${trip.tripId}`, t = tripMap.get(id);
    if (!t || trip.routeId && trip.routeId !== t.data.route_id ||
      !activeService(t.calendar, exceptions.map(v => v.data).filter(v => v.service_id === t.data.service_id), trip.startDate)) continue;
    const safeTrip = { ...trip, routeId: t.data.route_id };
    if (e.tripUpdate) {
      const stopTimeUpdate = (item.stopTimeUpdate || []).slice(0, 1000).flatMap((st: any) => {
        const matching = (calls.get(id) || []).filter(c => (!st.stopId || c.stop_id === st.stopId) &&
          (!st.stopSequence || Number(c.stop_sequence) === Number(st.stopSequence)));
        if (matching.length !== 1 || ["1", "2", "3"].includes(matching[0].pickup_type)) return [];
        return [{ ...st, stopId: matching[0].stop_id, transtopHeadsign: matching[0].stop_headsign || t.data.trip_headsign }];
      });
      out.push({ id: e.id, tripUpdate: { trip: safeTrip, timestamp: item.timestamp, stopTimeUpdate, transtopHeadsign: t.data.trip_headsign } });
    } else if (item.position && (!item.stopId || (calls.get(id) || []).some(c => c.stop_id === item.stopId))) {
      out.push({ id: e.id, vehicle: { ...item, trip: safeTrip } });
    }
  }
  const { rows: after } = await pool.query("SELECT data->>'stopTimesMode' AS generation FROM transit_feed_snapshots WHERE mode='live' AND id=$1", [`${agency}:static`]);
  return after[0]?.generation === snapshot.stopTimesMode ? out : [];
}
