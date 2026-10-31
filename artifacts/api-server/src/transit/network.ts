import { pool } from "@workspace/db";
import { demoRoutes } from "./demo";
import { mapVehicles } from "./realtime";
import type { Mode, TransitRoute, TransitStop } from "./types";
import { boundsOf, contains, intersects, overlaps, REGION, simplify, splitBounds, type Bounds } from "./map-geometry";
import { intercityCatalog } from "./intercity/service";
import { globalNetwork, unique, globalRoute } from "./transitland/discovery";
import { isTransitland } from "./transitland/model";
import { coverage } from "./transitland/client";
import * as tfl from "./tfl/service";
import { isTfl } from "./tfl/model";
import { preferDirect, resultRouteAliases } from "./tfl/crosswalk";
const broadway=[[-73.9956,40.7304],[-73.9906,40.7357],[-73.989,40.7429],[-73.987,40.7496],[-73.9868,40.7547],[-73.9807,40.7647],[-73.9819,40.7681],[-73.9819,40.7756]];
const seventh=[[-74.0021,40.7334],[-74.0002,40.7378],[-73.9959,40.7441],[-73.9911,40.7504],[-73.9875,40.7553],[-73.9841,40.7617],[-73.9819,40.7681]];
const sixth=[[-73.9961,40.7323],[-73.9945,40.7382],[-73.9928,40.7429],[-73.9878,40.7497],[-73.9846,40.7542],[-73.9813,40.7587],[-73.9775,40.7639]];
const eighth=[[-74.0005,40.7409],[-73.998,40.7459],[-73.9934,40.7523],[-73.9897,40.7573],[-73.9859,40.7625],[-73.9819,40.7681]];
function demoShape(r:TransitRoute) {
  if(["1","2","3"].includes(r.name))return seventh;
  if(["N","Q","R","W"].includes(r.name))return broadway;
  if(["B","D","F","M"].includes(r.name))return sixth;
  if(["A","C","E"].includes(r.name))return eighth;
  if(["4","5","6"].includes(r.name))return [[-73.9899,40.7347],[-73.9821,40.7461],[-73.9769,40.7518],[-73.9719,40.7571],[-73.9674,40.7625]];
  if(r.name==="7")return [[-74.0017,40.7559],[-73.9875,40.7553],[-73.9819,40.7538],[-73.9769,40.7518],[-73.9533,40.7422],[-73.944,40.746]];
  if(r.name==="S")return [[-73.9875,40.7553],[-73.9769,40.7518]];
  if(r.name==="M42")return [[-74.0012,40.7607],[-73.9871,40.7555],[-73.9701,40.7484]];
  if(r.type==="bus")return seventh.map(p=>[p[0]+.00035,p[1]]);
  if(r.id.startsWith("mta-lirr:"))return [[-73.9935,40.7506],[-73.981,40.745],[-73.95,40.741],[-73.906,40.735],[-73.8087,40.7003],[-73.6409,40.7409]];
  return [[-73.9772,40.7527],[-73.97,40.765],[-73.954,40.792],[-73.94,40.817],[-73.928,40.845]];
}
type Line = { route: TransitRoute; shape: number[][]; shapeId: string; bounds: Bounds };
type Catalog = { generation: string; lines: Line[]; stops: TransitStop[]; missing: TransitRoute[] };
let cached: Catalog | undefined, inflight: Promise<Catalog> | undefined;
let simplified = new WeakMap<Line, Map<number, number[][]>>();
export function invalidateNetwork() { cached = undefined; simplified = new WeakMap(); }

async function catalogGeometry() {
  // A small snapshot query detects atomic imports, including imports from another process.
  const { rows: versions } = await pool.query(`SELECT id,updated_at FROM transit_feed_snapshots
    WHERE mode='live' AND id LIKE '%:static' ORDER BY id`);
  const generation = JSON.stringify(versions);
  if (cached?.generation === generation) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const [{ rows }, { rows: ss }] = await Promise.all([
      pool.query(`WITH patterns AS (
        SELECT DISTINCT agency,data->>'route_id' AS route_id,NULLIF(data->>'shape_id','') AS shape_id
        FROM transit_trips WHERE mode='live'
      ) SELECT r.data AS route,p.shape_id,s.data AS shape
        FROM transit_routes r LEFT JOIN patterns p ON p.agency=r.agency AND p.route_id=r.data->>'route_id'
        LEFT JOIN transit_shapes s ON s.mode=r.mode AND s.id=p.agency || ':' || p.shape_id
        WHERE r.mode='live' ORDER BY r.id,p.shape_id`),
      pool.query("SELECT data FROM transit_stops WHERE mode='live' ORDER BY id"),
    ]);
    const lines: Line[] = [], missing = new Map<string, TransitRoute>();
    for (const r of rows) {
      const shape = r.shape?.coordinates as number[][] | undefined;
      if (!shape || shape.length < 2 || !shape.every(p => p.length >= 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) {
        missing.set(r.route.id, r.route); continue;
      }
      lines.push({ route: r.route, shape, shapeId: `${r.route.id}:${r.shape_id}`, bounds: boundsOf(shape) });
    }
    cached = { generation, lines, stops: ss.map(s => s.data), missing: [...missing.values()] };
    return cached;
  })().finally(() => { inflight = undefined; });
  return inflight;
}
export type NetworkQuery = Partial<Bounds> & {
  mode?: Mode; type?: string; lat?: number; lon?: number; zoom?: number;
  agency?: string; serviceClass?: string; routeId?: string;cursor?:string;
};
export async function network(p: NetworkQuery) {
  const mode = p.mode ?? "demo", zoom = p.zoom ?? 10;
  if(mode==="live"&&isTfl(p.routeId)){
    const d=await tfl.route(p.routeId!,undefined,false);
    return {lines:d?.shape.length?[{route:d.route,shape:d.shape,shapeId:d.route.id,vehicles:[]}]:[],
      stops:d?.stops||[],totalLines:d?.shape.length?1:0,totalStops:d?.stops.length||0,truncated:false,
      missingGeometry:d&&!d.shape.length?[d.route]:[],generation:"tfl",busDetailZoom:12,stopsZoom:13,
      message:"TfL supplied route pattern, not GPS or a vehicle path.",tfl:d?.route.tfl};
  }
  if(mode==="live"&&isTransitland(p.routeId)){
    const d=await globalRoute(p.routeId!);
    return {lines:d?.shape.length?[{route:d.route,shape:d.shape,shapeId:d.route.id,vehicles:[]}]:[],
      stops:d?.stops||[],totalLines:d?.shape.length?1:0,totalStops:d?.stops.length||0,truncated:false,
      missingGeometry:d&&!d.shape.length?[d.route]:[],generation:"transitland",busDetailZoom:12,stopsZoom:13,
      message:"Transitland selected published route pattern; not a vehicle path.",globalCoverage:coverage()};
  }
  const b: Bounds = p.west != null ? p as Bounds : p.lat != null && p.lon != null
    ? { west: p.lon - .1, east: p.lon + .1, south: p.lat - .08, north: p.lat + .08 } : REGION;
  const catalog: Catalog = mode === "demo" ? {
    generation: "demo", missing: [], stops: (await pool.query("SELECT data FROM transit_stops WHERE mode='demo' ORDER BY id")).rows.map(r => r.data),
    lines: demoRoutes.map(route => { const shape = demoShape(route); return { route, shape, shapeId: `demo:${route.id}`, bounds: boundsOf(shape) }; }),
  } : await catalogGeometry();
  const matches = (r: TransitRoute) => (!p.type || p.type === "all" || r.type === p.type) &&
    (!p.agency || r.id.split(":")[0] === p.agency || r.agencyId === p.agency) && (!p.routeId || r.id === p.routeId) &&
    (!p.serviceClass || p.serviceClass === "all" || r.serviceClass === p.serviceClass);
  const visible = catalog.lines.filter(l => matches(l.route) && (p.routeId || l.route.type !== "bus" || zoom >= 12) &&
    (p.routeId || overlaps(l.bounds, b) && intersects(l.shape, b)))
    .sort((a, b) => Number(a.route.type === "bus") - Number(b.route.type === "bus"));
  let points = 0;
  const lines: { route: TransitRoute; shape: number[][]; shapeId: string; vehicles: never[] }[] = [];
  for (const l of visible) {
    const level = Math.floor(zoom);
    let cache = simplified.get(l); if (!cache) { cache = new Map(); simplified.set(l, cache); }
    let shape = cache.get(level);
    if (!shape) { shape = simplify(l.shape, 0.00002 * 2 ** Math.max(0, 14 - level)); cache.set(level, shape); }
    if (lines.length >= 600 || points + shape.length > 180000) continue;
    lines.push({ route: l.route, shape, shapeId: l.shapeId, vehicles: [] }); points += shape.length;
  }
  const extra=mode==="live"?await intercityCatalog():{routes:[],stops:[],coverageWarning:""};
  const london=mode==="live"&&zoom>=13?await tfl.discover(p,b):undefined;
  const globalParts=mode==="live"&&zoom>=11?await Promise.all(splitBounds(b).map(part=>globalNetwork(part,p,
    unique([...catalog.lines.map(l=>l.route),...catalog.missing,...extra.routes])))):[];
  const globalStops=unique(globalParts.flatMap(g=>g.stops));
  const localReferenceRoutes=new Set(extra.stops.filter(s=>contains(b,s.lon,s.lat)).flatMap(s=>s.routes.map(r=>r.id)));
   const ss = zoom >= 13 || p.routeId ? preferDirect([...catalog.stops,...extra.stops,...globalStops,...(london?.stops||[])]).filter(s => !s.parent && Number.isFinite(s.lat) && Number.isFinite(s.lon) &&
    (p.routeId || contains(b, s.lon, s.lat)) && s.routes.some(matches)).map(s => ({
      id: s.id, name: s.name, lat: s.lat, lon: s.lon, type: s.type, routes: s.routes.filter(matches),
    })) : [];
  const aliases=resultRouteAliases(globalStops,london?.stops||[]);
  const canonical=(r:TransitRoute)=>london?.routes.find(d=>d.id===aliases.get(r.id));
  const globalLines=unique(globalParts.flatMap(g=>g.lines).map(l=>{
    const official=canonical(l.route);
    return {...l,id:l.shapeId,...(official?{route:{...official,transitland:l.route.transitland}}:{})};
  }));
  return {
    lines:[...lines,...globalLines], stops: ss.slice(0, 500), totalLines: visible.length+globalLines.length, totalStops: ss.length,tfl:london?.tfl,
    truncated: lines.length < visible.length || ss.length > 500 || globalParts.some(g=>g.globalCoverage.hasMore||g.missing.length),
    globalCoverage:globalParts.length>1?{...globalParts[0].globalCoverage,cursor:undefined,
      hasMore:globalParts.some(g=>g.globalCoverage.hasMore),message:"Date-line view combines both hemispheres. Narrow to one side to page a partial source result."}:globalParts[0]?.globalCoverage,
    missingGeometry: unique([...catalog.missing,...(london?.routes||[]),...extra.routes.filter(r=>!r.id.startsWith("ibg:")||localReferenceRoutes.has(r.id)),...globalParts.flatMap(g=>g.missing).map(r=>canonical(r)||r)])
      .filter(r=>matches(r)&&!globalLines.some(l=>l.route.id===r.id)), busDetailZoom: 12, stopsZoom: 13,
    generation: catalog.generation,
    message: mode === "demo" ? "Demo sample paths, not official service coverage." :
      "Official GTFS route paths, not live movement. Bus detail at zoom 12+; stops at zoom 13+. Missing geometry lists routes with at least one unavailable pattern. Only imported operators are covered; private services and unimported operators are not included."+(extra.coverageWarning?` ${extra.coverageWarning}`:""),
  };
}
export { mapVehicles };
