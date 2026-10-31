import type { TransitVehicle } from "../types";
import { current, type StaticCatalog } from "./model";
import { splitBounds, type Bounds } from "../map-geometry";

/** Test viewport overlap, not stop containment: GPS between stops still counts. */
export function busViewport(bounds:Bounds|undefined,catalog:StaticCatalog){
  if(!bounds)return false;
  const stops=catalog.stops.filter(s=>s.routes.some(r=>r.type==="bus")&&
    Number.isFinite(s.lat)&&Number.isFinite(s.lon));
  if(!stops.length)return false;
  const west=Math.min(...stops.map(s=>s.lon)),east=Math.max(...stops.map(s=>s.lon));
  const south=Math.min(...stops.map(s=>s.lat)),north=Math.max(...stops.map(s=>s.lat));
  return splitBounds(bounds).some(b=>b.west<=east&&b.east>=west&&b.south<=north&&b.north>=south);
}

/** Coordinates come only from VehiclePosition. Static data verifies identity,
 * never supplies a position, bearing, timestamp or simulated progress. */
export function normalizeVehicles(entities:any[],catalog:StaticCatalog,header:number,now=Date.now()):TransitVehicle[]{
  if(!current(header,now))return [];
  const routes=new Map(catalog.routes.filter(r=>r.agencyId==="wmata"&&r.type==="bus").map(r=>[r.id,r]));
  const trips=new Map(catalog.trips.map(t=>[t.id,t]));
  const observations=new Map<string,TransitVehicle>(),duplicates=new Set<string>();
  for(const e of entities){
    const v=e.vehicle,p=v?.position,t=v?.trip,id=v?.vehicle?.id;
    if(e.isDeleted||!v||!p||typeof id!=="string"||!id.trim()||id.length>200||
      !Object.hasOwn(p,"latitude")||!Object.hasOwn(p,"longitude")||
      !Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||
      Math.abs(p.latitude)>90||Math.abs(p.longitude)>180||
      !current(Number(v.timestamp),now))continue;
    const route=routes.get(`wmata:${t?.routeId}`);
    if(!route||[3,7].includes(Number(t?.scheduleRelationship)))continue;
    // A supplied trip must agree with the exact current static identity.
    // No revision, route-name, nearest-road or entity-ID matching.
    const trip=t?.tripId?trips.get(`wmata:${t.tripId}`):undefined;
    if(t?.tripId&&(!trip||trip.data.route_id!==t.routeId||
      Object.hasOwn(t,"directionId")&&trip.data.direction_id!==String(t.directionId)))continue;
    const at=Math.min(header,Number(v.timestamp))*1000;
    const key=`wmata:vehicle:${id}`;
    if(observations.has(key)){duplicates.add(key);continue;}
    observations.set(key,{id:key,lat:p.latitude,lon:p.longitude,agencyId:"wmata",
      vehicleType:"bus",routeId:route.id,routeName:route.name,color:route.color,
      destination:trip?.data.trip_headsign||undefined,
      source:"official WMATA Metrobus GPS",updatedAt:new Date(at).toISOString(),
      expiresAt:new Date(at+60000).toISOString()});
  }
  return [...observations.values()].filter(v=>!duplicates.has(v.id));
}
