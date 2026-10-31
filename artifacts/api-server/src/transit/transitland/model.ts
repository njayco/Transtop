import type { TransitRoute, TransitStop, TransitType, TransitlandInfo } from "../types";
import { odptRouteDuplicate } from "../odpt/crosswalk";

export const isTransitland = (id?: string) => !!id?.startsWith("tl:");
export function identity(feed: string, raw: string) { return `tl:${Buffer.from(JSON.stringify([feed,raw])).toString("base64url")}`; }
export function parseIdentity(id: string): [string,string] {
  if (!/^tl:[\w-]{1,1300}$/.test(id)) throw new Error("Invalid Transitland identity");
  const a = JSON.parse(Buffer.from(id.slice(3),"base64url").toString());
  if (!Array.isArray(a) || a.length !== 2 || !a.every(v => typeof v === "string" && v.length > 0 && v.length <= 400)) throw new Error("Invalid Transitland identity");
  return a as [string,string];
}
export function lookup(id: string) { const [f,r] = parseIdentity(id); return encodeURIComponent(`${f}:${r}`); }
export function classify(value: number): { type: TransitType; detail: string } | undefined {
  if (value === 1 || value >= 400 && value < 500) return { type: "subway", detail: "Metro / subway" };
  if (value === 201 || value === 202) return { type: "intercity", detail: "International / national coach" };
  if (value === 208) return { type: "bus", detail: "Commuter coach" };
  if (value === 109) return { type: "rail", detail: "Commuter rail" };
  if ([0,2,5,6,7,12].includes(value) || value >= 100 && value < 200 || value >= 900 && value < 1000) return { type: "rail", detail: value === 0 || value >= 900 && value < 1000 ? "Tram / light rail" : "Rail · subtype not confirmed" };
  if (value === 3 || value === 11 || value >= 700 && value < 800 || value >= 200 && value < 300) return { type: "bus", detail: "Bus · intercity/commuter subtype not confirmed" };
  return undefined;
}
export function licensed(feed: any) {
  const l = feed?.license;
  if (!l || l.share_alike_optional==="no" || ["commercial_use_allowed","redistribution_allowed","create_derived_product"].some(k => l[k] === "no")) return false;
  const standard = ["CC0-1.0","CC-BY-4.0","CC-BY-3.0","PDDL-1.0","ODC-By-1.0","OGL-UK-3.0"].includes(l.spdx_identifier);
  return standard || l.commercial_use_allowed === "yes" && l.redistribution_allowed === "yes" && l.create_derived_product === "yes";
}
export const sourceId = (raw: any) => raw?.feed_version?.feed?.onestop_id as string | undefined;
export const sourceDate = (raw: any) => raw?.feed_version?.fetched_at || "";
export function sourceInfo(feed: any, fetchedAt: string): TransitlandInfo {
  return { feedId: feed.onestop_id, fetchedAt, license: feed.license?.spdx_identifier || "Feed-specific license",
    attribution: feed.license?.attribution_text || feed.name || feed.onestop_id,
    url: `https://www.transit.land/data/feeds/${encodeURIComponent(feed.onestop_id)}`,
    ...(feed.license?.attribution_instructions?{notes:[String(feed.license.attribution_instructions).slice(0,2000)]}:{}) };
}
export function normalizeRoute(raw: any, info: TransitlandInfo): TransitRoute | undefined {
  const c = classify(Number(raw?.route_type));
  if (!c || typeof raw?.route_id !== "string" || !raw.agency?.agency_name) return;
  const agency = raw.agency;
  // Exact brands already classified in the reviewed intercity provider inventory.
  // This is mode classification only: it never grants feed access or verifies a terminal.
  const intercityBrands=["greyhound","greyhound lines","greyhound lines, inc.","flixbus","megabus","martz trailways","martz bus","trans-bridge lines","peter pan bus lines"];
  if(c.type==="bus"&&intercityBrands.includes(agency.agency_name.trim().toLowerCase())){
    c.type="intercity";c.detail="Intercity operator classification; individual boarding restrictions still apply";
  }
  return { id: identity(info.feedId,raw.route_id), name: raw.route_short_name || raw.route_long_name || raw.route_id,
    longName: raw.route_long_name || undefined, color: /^[\da-f]{6}$/i.test(raw.route_color || "") ? `#${raw.route_color}` : "#d8bb58",
    type: c.type, agency: agency.agency_name, agencyId: identity(info.feedId, `agency:${agency.agency_id}`),
    ...(raw.route_type === 702 ? { serviceClass: "express" as const } : {}),
    transitland: { ...info, modeDetail: c.detail }, sourceUrl: info.url,
    scheduleNotes: [raw.route_desc, `Transitland · ${info.attribution}. Geometry is a published route, not vehicle movement.`].filter(Boolean) };
}
export function normalizeStop(raw: any, rr: TransitRoute[], info: TransitlandInfo): TransitStop | undefined {
  const xy = raw?.geometry?.coordinates;
  if (!Array.isArray(xy) || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1]) || Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 90 ||
    typeof raw?.stop_id !== "string" || typeof raw.stop_name !== "string" || !rr.length) return;
  return { id: identity(info.feedId,raw.stop_id), rawId: raw.stop_id, name: raw.stop_name, agency: [...new Set(rr.map(r => r.agency))].join(" / "),
    type: rr[0].type, lon: xy[0], lat: xy[1], routes: [...new Map(rr.map(r => [r.id,r])).values()], arrivals: [], alerts: [],
    accessible: raw.wheelchair_boarding === 1, distance: 0, walkingMinutes: 0, updatedAt: info.fetchedAt || new Date(0).toISOString(),
    stop_timezone: raw.stop_timezone || undefined,
    neighborhood: [raw.place?.adm1_name,raw.place?.adm0_name].filter(Boolean).join(", "),
    transitland: { ...info, timezone: raw.stop_timezone || info.timezone, platform: raw.platform_code || undefined,
      parentStation: raw.parent?.stop_name || undefined,
      accessibility: raw.wheelchair_boarding === 1 ? "Wheelchair boarding reported" : raw.wheelchair_boarding === 2 ? "Wheelchair boarding unavailable" : "Wheelchair boarding unknown" } };
}
export function coordinates(raw: any): number[][] {
  const g = raw?.geometry || raw, points = g?.type === "LineString" ? g.coordinates : [];
  return Array.isArray(points) && points.length <= 50000 && points.every(p => Array.isArray(p) && p.length >= 2 &&
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) ? points : [];
}
export function geometryParts(raw:any):number[][][]{
  if(raw?.type==="MultiLineString"&&Array.isArray(raw.coordinates))return raw.coordinates.slice(0,64)
    .map((line:any)=>coordinates({type:"LineString",coordinates:line})).filter((line:number[][])=>line.length>1);
  const line=coordinates(raw);return line.length>1?[line]:[];
}
export function normalizeAlerts(values:any,id:string,routeIds:string[]){
  const text=(v:any):string=>{
    if(typeof v==="string")return v.slice(0,5000);
    const rows=Array.isArray(v)?v:v?.translation;
    return Array.isArray(rows)?rows.slice(0,6).map(x=>`${x.language?`[${x.language}] `:""}${String(x.text||"")}`).join(" · ").slice(0,5000):"";
  };
  const now=Date.now()/1000;
  return (Array.isArray(values)?values:[]).slice(0,20).filter(a=>!a.active_period?.length||a.active_period.some((p:any)=>
    (!p.start||Number(p.start)<=now)&&(!p.end||Number(p.end)>=now))).map((a,i)=>({
    id:`${id}:alert:${i}`,title:text(a.header_text)||"Transit service notice",
    description:text(a.description_text)||"Check the operator for details.",severity:"info",routeIds,
    source:"Transitland agency notice · source freshness not guaranteed",
  }));
}
/** Only explicit operator crosswalks; partial imports suppress only covered routes. */
export function directDuplicate(r: TransitRoute, direct: TransitRoute[]) {
  if(r.transitland){
    const [feed,raw]=parseIdentity(r.id);
    if(direct.some(d=>d.mobility?.transitlandId===feed&&d.type===r.type&&d.id.slice(d.id.indexOf(":")+1)===raw))return true;
    if(odptRouteDuplicate(feed,raw,r.type,direct))return true;
  }
  const aliases: Record<string,string[]> = {
    "mta-subway": ["mta new york city transit","mta nyct","new york city transit"],
    "mta-bus": ["mta new york city transit","mta bus company","mta nyct"],
    "mta-lirr": ["long island rail road"], "mta-mnr": ["metro-north railroad","mta metro-north railroad"],
    amtrak: ["amtrak"], cttransit: ["cttransit","cttransit / ctfastrak","connecticut transit"],
    "ctrail-hartford": ["hartford line","ctrail hartford line"], "ctrail-sle": ["shore line east"],
    transbridge: ["trans-bridge lines","trans-bridge"], martz: ["martz trailways","martz"],
    nice: ["nassau inter-county express","nice bus"], suffolk: ["suffolk county transit"], "nj-transit": ["nj transit","nj transit bus"],
  };
  const name = r.agency.trim().toLowerCase();
  for (const [id,names] of Object.entries(aliases)) if (names.includes(name)) {
    const local = direct.filter(d => d.id.startsWith(id + ":") && d.type === r.type);
    if (["nj-transit","martz","transbridge"].includes(id)) return local.some(d => d.name === r.name);
    if (local.length) return true;
  }
  return false;
}
