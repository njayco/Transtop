export type Mode = "demo" | "live";
export type TransitType = "subway" | "bus" | "rail" | "intercity";
export interface TransitRoute { id:string; name:string; color:string; type:TransitType; agency:string;agencyId?:string;serviceClass?:"local"|"express";longName?:string;scheduleNotes?:string[];sourceUrl?:string;referenceDate?:string }
export interface Arrival {
  id:string; routeId:string; routeName:string; color:string; direction:string; destination:string;
  minutes:number; source:"demo"|"live"|"scheduled"|"community"|"unavailable"; updatedAt:string;
  status:string; scheduledAt:string; tripId?:string; rangeMax?:number; confidence?:string;
  trainNumber?:string;runId?:string;timezone?:string;publishedAt?:string;expiresAt?:string;
}
export interface TransitAlert {id:string; title:string; description:string; severity:string; routeIds:string[]; source:string}
export interface TransitStop {
  id:string; name:string; agency:string; type:TransitType; lat:number; lon:number; distance:number; walkingMinutes:number;
  routes:TransitRoute[]; arrivals:Arrival[]; alerts:TransitAlert[]; accessible:boolean; updatedAt:string; neighborhood?:string;
  rawId?:string; parent?:string;
  stop_timezone?:string;
}
export interface TransitVehicle {id:string; lat:number; lon:number; source:string; updatedAt:string;
  routeId?:string;agencyId?:string;routeName?:string;trainNumber?:string;destination?:string;runId?:string;expiresAt?:string}
export interface RouteDetail {route:TransitRoute; stops:TransitStop[]; shape:number[][]; vehicles:TransitVehicle[]; alerts:TransitAlert[]; directions:string[];
  timetableStops?:{id:string;name:string;sequence:number}[]}
export const namespace = (agency:string, id:string) => `${agency}:${id}`;
export function distance(a:number,b:number,c:number,d:number) {
  const r=Math.PI/180, x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
