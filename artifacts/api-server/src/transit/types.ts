export type Mode = "demo" | "live";
export type TransitType = "subway" | "bus" | "rail" | "intercity";
export interface WmataInfo {kind:string;platform?:string;parentId?:string;attribution:string;url:string;timezone:string;predictions?:string;alerts?:string;access?:import("./wmata/access-model").AccessInfo;locations?:{id:string;name:string;kind:string}[]}
export interface IdfmInfo {url:string;license:string;attribution:string;timezone:string;modeDetail?:string;publishedAt?:string;validFrom?:string;validThrough?:string;platform?:string;accessibility?:string;realtimeStatus?:string;realtimeCheckedAt?:string;realtimeUrl?:string;realtimeLicense?:string}
export interface OdptInfo {attribution:string;url:string;license:string;terms:string;timezone:string;version:string;publishedAt:string;validFrom:string;validThrough:string;modeDetail:string;realtime:string}
export interface TflInfo {status:string;message:string;attribution:string;url:string;timezone:string;lastSuccess?:string;platform?:string;parentId?:string}
export interface TransitlandInfo {feedId:string;fetchedAt:string;license:string;attribution:string;url:string;timezone?:string;platform?:string;parentStation?:string;accessibility?:string;modeDetail?:string;notes?:string[]}
export interface MobilityInfo {feedId:string;datasetId:string;url:string;license:string;licenseUrl:string;attribution:string;timezone:string;downloadedAt:string;validFrom:string;validThrough:string;transitlandId?:string}
export interface TransitRoute { id:string; name:string; color:string; type:TransitType; agency:string;agencyId?:string;serviceClass?:"local"|"express";longName?:string;scheduleNotes?:string[];sourceUrl?:string;referenceDate?:string;transitland?:TransitlandInfo;tfl?:TflInfo;odpt?:OdptInfo;idfm?:IdfmInfo;mobility?:MobilityInfo;searchNames?:string[] }
export interface Arrival {
  id:string; routeId:string; routeName:string; color:string; direction:string; destination:string;
  minutes:number; source:"demo"|"live"|"scheduled"|"community"|"unavailable"; updatedAt:string;
  status:string; scheduledAt:string; tripId?:string; rangeMax?:number; confidence?:string;
   trainNumber?:string;runId?:string;timezone?:string;publishedAt?:string;expiresAt?:string;platform?:string;
}
export interface TransitAlert {id:string; title:string; description:string; severity:string; routeIds:string[]; source:string;
  stopIds?:string[];agencyId?:string;type?:TransitType;systemwide?:boolean;updatedAt?:string;url?:string;activePeriods?:{start?:number;end?:number}[];
  scopes?:{routeId?:string;stopId?:string}[]}
export interface TransitStop {
  id:string; name:string; agency:string; type:TransitType; lat:number; lon:number; distance:number; walkingMinutes:number;
  routes:TransitRoute[]; arrivals:Arrival[]; alerts:TransitAlert[]; accessible:boolean; updatedAt:string; neighborhood?:string;
  rawId?:string; parent?:string;
  stop_timezone?:string;
  mobility?:MobilityInfo;
  odpt?:OdptInfo;
  idfm?:IdfmInfo;
  searchNames?:string[];
  transitland?:TransitlandInfo;
   tfl?:TflInfo;
  wmata?:WmataInfo;
}
export interface TransitVehicle {id:string; lat:number; lon:number; source:string; updatedAt:string;
  routeId?:string;agencyId?:string;routeName?:string;trainNumber?:string;destination?:string;runId?:string;expiresAt?:string;vehicleType?:TransitType;color?:string}
export interface RouteDetail {route:TransitRoute; stops:TransitStop[]; shape:number[][]; vehicles:TransitVehicle[]; alerts:TransitAlert[]; directions:string[];
  timetableStops?:{id:string;name:string;sequence:number}[]}
export const namespace = (agency:string, id:string) => `${agency}:${id}`;
export function distance(a:number,b:number,c:number,d:number) {
  const r=Math.PI/180, x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
