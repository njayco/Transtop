import { DateTime } from "luxon";
import type { AgencyAdapter } from "../adapters";
import type { TransitType } from "../types";
import { regionalCapacity,smallCapacity } from "./capacity";

export const CATALOG = "https://mobilitydatabase.org/feeds/";
export const validFeedId = (id: string) => /^(?:mdb|tld|ntd|tdg|jbda)-[a-z0-9-]{1,90}$/.test(id);
export const agencyId = (id: string) => `mobility-${id}`;
export const isMobility = (id?: string) => !!id?.startsWith("mobility-");
export function publicUrl(value: unknown) {
  if (typeof value !== "string") return;
  try { const u = new URL(value); if (u.protocol !== "https:" || u.username || u.password) return; u.search = ""; u.hash = ""; return u.href; } catch { return; }
}
export function archiveUrl(value: unknown) {
  if (typeof value !== "string") return;
  try { const u = new URL(value);
    if (u.protocol === "https:" && u.hostname === "files.mobilitydatabase.org" && !u.port && !u.username && !u.password && !u.search && /^\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.zip$/.test(u.pathname)) return u.href;
  } catch { /* Reject untrusted catalog URLs. */ }
  return undefined;
}
export function licenseOf(raw: any) {
  const source = raw?.source_info;
  const code = source?.license_id;
  const url = publicUrl(source?.license_url);
  const exact: Record<string, string> = {
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "PDDL-1.0": "https://opendatacommons.org/licenses/pddl/1-0/",
  };
  if (!source?.license_is_spdx || !exact[code] || !url) return;
  // Explicit SPDX AND the corresponding authoritative license URL must agree.
  if (url.replace(/\/(?:legalcode(?:\.en)?|deed(?:\.[a-z-]+)?)\/?$/, "/").replace(/\/$/, "") !== exact[code].replace(/\/$/, "")) return;
  return { code: code as string, url: exact[code] };
}
export function routeMode(value: string): TransitType | undefined {
  const n = Number(value);
  if (n === 1 || n >= 400 && n < 500) return "subway";
  if (n === 0 || n === 2 || n >= 100 && n < 200 || n >= 300 && n < 400 || n >= 900 && n < 1000) return "rail";
  if (n === 201 || n === 202) return "intercity";
  if (n === 3 || n === 11 || n >= 200 && n < 300 || n >= 700 && n < 900) return "bus";
  return undefined;
}
export interface FeedRecord {
  regional?: boolean;
  id: string; kind: "gtfs" | "gtfs_rt"; provider: string; name: string; url: string; status: string;
  countries: string[]; regions: string[]; official: boolean; license?: string; licenseUrl?: string;
  eligible: boolean; reason: string; imported: boolean; datasetId?: string; downloadedAt?: string;
  validFrom?: string; validThrough?: string; timezone?: string; sizeMb?: number; uncompressedMb?: number;
  hostedUrl?: string; producerUrl?: string; transitlandId?: string; companionIds?: string[];
  entityTypes?: string[];
}
export function duplicateSource(raw: any, direct: AgencyAdapter[]) {
  const url = publicUrl(raw?.source_info?.producer_url);
  return !!url && direct.some(a => !isMobility(a.id) && [a.staticUrl, ...(a.staticFeeds || []).map(f => f.url), ...a.realtimeUrls].some(v => publicUrl(v) === url));
}
export function normalizeFeed(raw: any, direct: AgencyAdapter[], imported: boolean, now = Date.now(), regional=false): FeedRecord | undefined {
  if (!validFeedId(raw?.id) || !["gtfs", "gtfs_rt"].includes(raw.data_type)) return;
  const d = raw.latest_dataset, license = licenseOf(raw), isRt = raw.data_type === "gtfs_rt";
  const zone = d?.agency_timezone;
  const knownZone = typeof zone === "string" && DateTime.now().setZone(zone).isValid;
  const source = raw.source_info || {};
  let reason = "Eligible for bounded schedule import";
  if (raw.status !== "active" || raw.official !== true) reason = "Withheld: not an active, verified official feed";
  else if (!license) reason = "Withheld: source reuse license needs review";
  else if (source.authentication_type !== 0) reason = "Withheld: provider requires separate access credentials";
  else if (duplicateSource(raw, direct)) reason = "Existing direct source takes precedence";
  else if (isRt) reason = "Realtime companion: requires an imported matching schedule and fresh verified observations";
  else if (!d || !archiveUrl(d.hosted_url)) reason = "Withheld: no supported hosted GTFS archive";
  else if (!knownZone) reason = "Withheld: agency timezone is not verified";
  else if (!Number.isFinite(Date.parse(d.service_date_range_start)) || !Number.isFinite(Date.parse(d.service_date_range_end)) || Date.parse(d.service_date_range_end) < now || Date.parse(d.service_date_range_start) > now) reason = "Withheld: schedule service window is not current";
  else if (!Number.isFinite(d.zipped_folder_size_mb) || d.zipped_folder_size_mb<0|| d.zipped_folder_size_mb > (regional?regionalCapacity:smallCapacity).compressed/1024**2 ||
    !Number.isFinite(d.unzipped_folder_size_mb) || d.unzipped_folder_size_mb<0|| d.unzipped_folder_size_mb > (regional?regionalCapacity:smallCapacity).expanded/1024**2) reason = "Withheld: feed exceeds the bounded importer capacity";
  const eligible = reason === "Eligible for bounded schedule import";
  const loc = (Array.isArray(raw.locations) ? raw.locations : []).slice(0, 150);
  return {
    regional,id: raw.id, kind: raw.data_type, provider: String(raw.provider || raw.feed_name || raw.id).slice(0, 300),
    name: String(raw.feed_name || raw.provider || raw.id).slice(0, 300), url: CATALOG + raw.data_type + "/" + raw.id,
    status: String(raw.status || "unknown"), countries: [...new Set<string>(loc.map((v: any) => String(v.country_code || "")).filter(Boolean))],
    regions: [...new Set<string>(loc.map((v: any) => [v.municipality, v.subdivision_name, v.country].filter(Boolean).join(", ")).filter(Boolean))].slice(0, 20),
    official: raw.official === true, license: license?.code, licenseUrl: license?.url,
    eligible, reason, imported, datasetId: typeof d?.id === "string" ? d.id : undefined,
    downloadedAt: d?.downloaded_at, validFrom: d?.service_date_range_start, validThrough: d?.service_date_range_end,
    timezone: knownZone ? zone : undefined, sizeMb: d?.zipped_folder_size_mb ?? undefined,
    uncompressedMb: d?.unzipped_folder_size_mb ?? undefined, hostedUrl: archiveUrl(d?.hosted_url),
    producerUrl: publicUrl(source.producer_url),
    transitlandId: (raw.external_ids || []).find((v: any) => v.source === "tld")?.external_id,
    companionIds: (Array.isArray(raw.feed_references) ? raw.feed_references : []).filter((v: string) => typeof v === "string" && validFeedId(v)),
    entityTypes: isRt && Array.isArray(raw.entity_types) ? raw.entity_types.filter((v: string) => ["tu", "vp", "sa"].includes(v)) : undefined,
  };
}
