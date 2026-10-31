import { DateTime } from "luxon";
import { z } from "zod";
import type { TransitStop } from "../types";

export const ACCESS_URL = "https://developer.wmata.com/api-details#api=5476364f031f590f38092507&operation=5476364f031f5909e4fe330f";
export const OUTAGE_URL = "https://developer.wmata.com/api-details#api=54763641281d83086473f232&operation=54763641281d830c946a3d76";
const code = z.string().regex(/^[A-Z]\d{2}$/);
const optionalCode = z.union([code, z.literal(""), z.null()]).optional();
const text = z.string().max(12000).transform(s => s.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f]/g, " "));
const station = z.object({ Code: code, StationTogether1: optionalCode, StationTogether2: optionalCode });
const entrance = z.object({ Name: text, Description: text, StationCode1: code,
  StationCode2: optionalCode, Lat: z.number().min(-90).max(90), Lon: z.number().min(-180).max(180) });
const date = z.string().max(40).refine(s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s) &&
  DateTime.fromISO(s, { zone: "America/New_York" }).isValid);
const incident = z.object({ StationCode: code, UnitName: z.string().min(1).max(200),
  UnitType: z.enum(["ELEVATOR", "ESCALATOR"]), LocationDescription: text, SymptomDescription: text,
  DateOutOfServ: date, DateUpdated: date, EstimatedReturnToService: date.nullable() });
export const schemas = {
  "station-list": z.object({ Stations: z.array(station).max(300) }),
  "station-entrances": z.object({ Entrances: z.array(entrance).max(2000) }),
  "equipment-outages": z.object({ ElevatorIncidents: z.array(incident).max(3000) }),
};
export type AccessOperation = keyof typeof schemas;
export interface AccessSnapshot { data?: unknown; checkedAt?: number; state: string; nextPoll: number }
export type AccessSnapshots = Partial<Record<AccessOperation, AccessSnapshot>>;
export interface AccessInfo {
  stationCodes: string[]; scope: string; mappingStatus: string; entrancesStatus: string; outagesStatus: string;
  mappingCheckedAt?: string; entrancesCheckedAt?: string; outagesCheckedAt?: string; url: string; outageUrl: string;
  entrances: { name: string; description: string; stationCodes: string[]; lat: number; lon: number }[];
  outages: { equipmentId: string; equipmentType: string; stationCode: string; location: string; symptom: string;
    reportedAt: string; updatedAt: string; estimatedReturn?: string; status: string }[];
}
export const maxAge = (op: AccessOperation) => op === "equipment-outages" ? 180000 : 86400000;
export function snapshotState(op: AccessOperation, snapshot: AccessSnapshot | undefined, now: number) {
  if (!snapshot) return "not checked";
  if (snapshot.state !== "fresh") return snapshot.state;
  if (!snapshot.checkedAt || snapshot.checkedAt > now + 30000 || now - snapshot.checkedAt > maxAge(op)) return "stale";
  return "fresh";
}
const codes = (...values: (string | null | undefined)[]) => [...new Set(values.filter((s): s is string => !!s))].sort();
const iso = (s: string) => DateTime.fromISO(s, { zone: "America/New_York" }).toUTC().toISO()!;
/** Compare complete publisher code sets, never station names, proximity or wheelchair flags.
 * Entrance IDs in the JSON API are deprecated and are NOT GTFS entrance IDs.
 */
export function stationCodes(stop: TransitStop, stations: z.infer<typeof station>[]) {
  const parent = stop.wmata?.kind === "station" ? stop.rawId : stop.parent;
  if (!parent || !/^STN_[A-Z]\d{2}(?:_[A-Z]\d{2})*$/.test(parent)) return [];
  const expected = codes(...parent.slice(4).split("_"));
  const published = stations.filter(s => expected.includes(s.Code));
  if (published.length !== expected.length || published.some(s =>
    codes(s.Code, s.StationTogether1, s.StationTogether2).join("_") !== expected.join("_"))) return [];
  // A platform's code must agree with its published parent, not another platform
  // at an interchange. Parent-level results still describe the whole station.
  if (stop.wmata?.kind === "platform") {
    const match = /^PF_([A-Z]\d{2})_(?:\d+|C)$/.exec(stop.rawId || "");
    if (!match?.[1] || !expected.includes(match[1])) return [];
  }
  return expected;
}
export function accessInfo(stop: TransitStop, snapshots: AccessSnapshots, now = Date.now(), setup = "configured"): AccessInfo {
  const state = (op: AccessOperation) => setup === "configured" ? snapshotState(op, snapshots[op], now) : setup;
  const result: AccessInfo = { stationCodes: [], scope: "Station-wide information; exact entrance-to-equipment and platform paths are unknown.",
    mappingStatus: state("station-list"), entrancesStatus: state("station-entrances"), outagesStatus: state("equipment-outages"),
    entrances: [], outages: [], url: ACCESS_URL, outageUrl: OUTAGE_URL };
  for (const [op, key] of [["station-list", "mappingCheckedAt"], ["station-entrances", "entrancesCheckedAt"],
    ["equipment-outages", "outagesCheckedAt"]] as const) {
    const at = snapshots[op]?.checkedAt;
    if (at && Number.isFinite(at)) result[key] = new Date(at).toISOString();
  }
  const stations = schemas["station-list"].safeParse(snapshots["station-list"]?.data);
  if (result.mappingStatus !== "fresh") return result;
  if (!stations.success) { result.mappingStatus = "invalid response"; return result; }
  result.stationCodes = stationCodes(stop, stations.data.Stations);
  if (!result.stationCodes.length) { result.mappingStatus = "unknown station crosswalk"; return result; }
  const entrances = schemas["station-entrances"].safeParse(snapshots["station-entrances"]?.data);
  if (result.entrancesStatus === "fresh" && !entrances.success) result.entrancesStatus = "invalid response";
  if (result.entrancesStatus === "fresh" && entrances.success) {
    result.entrances = entrances.data.Entrances.filter(e =>
      codes(e.StationCode1, e.StationCode2).every(c => result.stationCodes.includes(c))).map(e => ({
      name: e.Name, description: e.Description, stationCodes: codes(e.StationCode1, e.StationCode2), lat: e.Lat, lon: e.Lon }));
  }
  const outages = schemas["equipment-outages"].safeParse(snapshots["equipment-outages"]?.data);
  if (result.outagesStatus === "fresh" && !outages.success) result.outagesStatus = "invalid response";
  if (result.outagesStatus === "fresh" && outages.success) {
    result.outages = outages.data.ElevatorIncidents.filter(e => result.stationCodes.includes(e.StationCode)).map(e => {
      const updatedAt = iso(e.DateUpdated), reportedAt = iso(e.DateOutOfServ);
      const estimatedReturn = e.EstimatedReturnToService ? iso(e.EstimatedReturnToService) : undefined;
      return { equipmentId: e.UnitName, equipmentType: e.UnitType, stationCode: e.StationCode,
        location: e.LocationDescription, symptom: e.SymptomDescription, reportedAt, updatedAt, estimatedReturn,
        // An estimated return is NOT an outage expiry or proof of repair.
        status: Date.parse(updatedAt) > now + 30000 || Date.parse(reportedAt) > now + 30000 ? "source dates uncertain" :
          estimatedReturn && Date.parse(estimatedReturn) <= now ? "reported impaired; estimated return has passed, repair unconfirmed" : "reported impaired" };
    });
  }
  return result;
}
