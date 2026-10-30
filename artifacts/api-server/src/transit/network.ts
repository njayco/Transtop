import { db, pool, routes } from "@workspace/db";
import { eq } from "drizzle-orm";
import { demoRoutes } from "./demo";
import { feedsFor, fresh } from "./realtime";
import type { Mode, TransitRoute } from "./types";
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
let cached:{at:number;lines:{route:TransitRoute;shape:number[][]}[]}|undefined;
export async function network(mode:Mode,type?:string,lat=40.75529,lon=-73.98749) {
  let lines:{route:TransitRoute;shape:number[][]}[];
  if(mode==="demo")lines=demoRoutes.map(route=>({route,shape:demoShape(route)}));
  else{
    if(!cached||Date.now()-cached.at>300000){
      const {rows}=await pool.query(`SELECT DISTINCT ON (r.id) r.data AS route,s.data AS shape
        FROM transit_routes r
        JOIN transit_trips t ON t.mode=r.mode AND t.agency=r.agency AND t.data->>'route_id'=r.data->>'route_id'
        JOIN transit_shapes s ON s.mode=t.mode AND s.id=t.agency || ':' || (t.data->>'shape_id')
        WHERE r.mode='live' ORDER BY r.id,t.id`);
      cached={at:Date.now(),lines:rows.map(r=>({route:r.route,shape:r.shape.coordinates}))};
    }
    lines=cached.lines;
  }
  return lines.filter(l=>(!type||type==="all"||l.route.type===type)&&l.shape.some(p=>Math.abs(p[0]-lon)<.1&&Math.abs(p[1]-lat)<.08))
    .map(l=>({...l,vehicles:mode==="demo"?[]:feedsFor(l.route.id.split(":")[0]).filter(f=>fresh(f)).flatMap(f=>f.entities.filter(e=>e.vehicle?.position&&`${l.route.id.split(":")[0]}:${e.vehicle.trip?.routeId}`===l.route.id).map(e=>({
      id:e.id,lat:e.vehicle.position.latitude,lon:e.vehicle.position.longitude,source:"Live agency data",updatedAt:new Date(Number(e.vehicle.timestamp||f.timestamp)*1000).toISOString(),
    })))}));
}
