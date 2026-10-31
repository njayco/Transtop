import { pool } from "@workspace/db";
import { enabled } from "./client";
import type { TransitRoute,TransitStop } from "../types";
import { simplify,type Bounds } from "../map-geometry";

// Also works across processes before the in-memory registry refreshes.
export const regionalAgenciesSql=`SELECT 'mobility-'||(data->'record'->>'id')
  FROM transit_feed_snapshots WHERE mode='live' AND id LIKE 'mobility:registered:%'
  AND data->'record'->>'regional'='true'`;
type Filters={q?:string;agency?:string;type?:string;serviceClass?:string;lat?:number;lon?:number;routeId?:string;zoom?:number};
export async function directStop(id:string) {
  if(!enabled()||!id.startsWith("mobility-"))return;
  return (await pool.query("SELECT data FROM transit_stops WHERE mode='live' AND id=$1",[id])).rows[0]?.data as TransitStop|undefined;
}
export async function children(stop:TransitStop) {
  if(!enabled()||!stop.mobility||stop.parent)return [];
  return (await pool.query(`SELECT data FROM transit_stops WHERE mode='live' AND agency=$1 AND data->>'parent'=$2 LIMIT 1000`,
    [stop.id.split(":")[0],stop.rawId])).rows.map(r=>r.data as TransitStop);
}
/** Regional stop records never enter a worldwide in-process cache. */
export async function findStops(p:Filters,bounds?:Bounds,limit=80,offset=0,regionalOnly=true) {
  if(!enabled()||p.agency&&!p.agency.startsWith("mobility-"))return {stops:[] as TransitStop[],total:0};
  const {rows}=await pool.query(`SELECT data,count(*) OVER()::int AS total FROM transit_stops
    WHERE mode='live' AND ${regionalOnly?`agency IN (${regionalAgenciesSql})`:"agency LIKE 'mobility-%'"}
      AND ($1::text IS NULL OR agency=$1) AND COALESCE(data->>'location_type','') IN ('0','1','')
      AND ($2='' OR lower(data->>'name') LIKE '%'||$2||'%' OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(data->'routes') r
        WHERE lower(r->>'name')=$2 OR lower(r->>'longName') LIKE '%'||$2||'%'))
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'routes') r WHERE
        ($3::text IS NULL OR r->>'type'=$3) AND ($4::text IS NULL OR r->>'serviceClass'=$4)
        AND ($5::text IS NULL OR r->>'id'=$5))
      AND ($6::float IS NULL OR ((data->>'lat')::float BETWEEN $6 AND $7 AND (data->>'lon')::float BETWEEN $8 AND $9))
    ORDER BY CASE WHEN $10::float IS NOT NULL THEN ((data->>'lat')::float-$10)^2+((data->>'lon')::float-$11)^2 END,
      data->>'name',id LIMIT $12 OFFSET $13`,
    [p.agency||null,(p.q||"").trim().toLowerCase().slice(0,180),!p.type||p.type==="all"?null:p.type,
      !p.serviceClass||p.serviceClass==="all"?null:p.serviceClass,p.routeId||null,
      bounds?.south??null,bounds?.north??null,bounds?.west??null,bounds?.east??null,p.lat??null,p.lon??null,Math.min(limit,500),offset]);
  return {stops:rows.map(r=>r.data as TransitStop),total:rows[0]?.total||0};
}
export async function mapPage(p:Filters,b:Bounds) {
  const result={lines:[] as {route:TransitRoute;shape:number[][];shapeId:string;vehicles:never[]}[],
    stops:[] as TransitStop[],missing:[] as TransitRoute[],totalStops:0,truncated:false};
  if(!enabled()||p.agency&&!p.agency.startsWith("mobility-")||p.routeId&&!p.routeId.startsWith("mobility-"))return result;
  if(!p.routeId&&(b.east-b.west>2||b.north-b.south>2||(p.zoom??0)<11))return result;
  const page=await findStops({...p,q:undefined},p.routeId?undefined:b,500);
  const candidates=p.routeId?(await pool.query("SELECT data FROM transit_routes WHERE mode='live' AND id=$1",[p.routeId])).rows.map(r=>r.data as TransitRoute):
    [...new Map(page.stops.flatMap(s=>s.routes).filter(r=>(!p.type||p.type==="all"||r.type===p.type)&&
      (!p.serviceClass||p.serviceClass==="all"||r.serviceClass===p.serviceClass)).map(r=>[r.id,r])).values()];
  let points=0;
  for(const route of candidates.filter(r=>p.routeId||r.type!=="bus"||(p.zoom??0)>=12).slice(0,12)){
    const agency=route.id.split(":")[0],raw=route.id.slice(agency.length+1);
    const {rows}=await pool.query(`WITH candidates AS MATERIALIZED(
      SELECT id,data->'coordinates' AS coordinates FROM transit_shapes WHERE mode='live' AND id IN(
        SELECT DISTINCT $1||':'||(data->>'shape_id') FROM transit_trips WHERE mode='live' AND agency=$1
          AND data->>'route_id'=$2 AND COALESCE(data->>'shape_id','')<>'') ORDER BY id LIMIT 64
      ), bounded AS(SELECT *,sum(jsonb_array_length(coordinates)) OVER(ORDER BY id) points FROM candidates)
      SELECT id,coordinates FROM bounded WHERE points<=120000 ORDER BY id`,[agency,raw]);
    if(rows.length>=64)result.truncated=true;
    if(!rows.length)result.missing.push(route);
    for(const path of rows){
      const shape=simplify(path.coordinates,.00002*2**Math.max(0,14-(p.zoom??14)));
      if(points+shape.length>40000||result.lines.length>=64){result.truncated=true;continue;}
      points+=shape.length;result.lines.push({route,shape,shapeId:path.id,vehicles:[]});
    }
  }
  result.stops=page.stops;result.totalStops=page.total;
  result.truncated ||=page.total>500||candidates.length>12;
  return result;
}
