import { DateTime } from "luxon";
import { activeService, serviceInstant } from "./time";

export const AMTRAK_FRESH_MS=5*60_000;
export const AMTRAKER_SOURCE="Amtraker · upstream Amtrak observation (unofficial)";
export interface TrainCall {
  code:string;name:string;sequence:number;timezone:string|null;status:string;
  scheduledArrival:string|null;scheduledDeparture:string|null;
  estimatedArrival:string|null;estimatedDeparture:string|null;
  actualArrival:string|null;actualDeparture:string|null;
}
export interface AmtrakTrain {
  id:string;trainNumber:string;routeName:string;destination:string;serviceDate:string;
  source:string;updatedAt:string|null;expiresAt:string|null;state:string;
  lat:number|null;lon:number|null;calls:TrainCall[];routeId?:string;tripId?:string;
  matched:boolean;message:string;
}
export function iso(value:unknown):string|null {
  if(typeof value!=="string"||!/(Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const d=DateTime.fromISO(value,{setZone:true});
  return d.isValid?d.toUTC().toISO():null;
}
export function validZone(value:unknown):value is string {
  return typeof value==="string"&&value.includes("/")&&DateTime.now().setZone(value).isValid;
}
export function observationFresh(t:Pick<AmtrakTrain,"updatedAt">,now=Date.now()) {
  const at=Date.parse(t.updatedAt||"");
  return Number.isFinite(at)&&at<=now+30_000&&now-at<=AMTRAK_FRESH_MS;
}
/** Read the provider's offered JSON API, never its library or private Amtrak endpoints.
 * arr/dep represent predictions at unvisited stops, not actuals. */
export function normalizeAmtraker(data:unknown,metadata:Record<string,any>={}):AmtrakTrain[] {
  if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("Amtraker response is not a train dictionary");
  const result:AmtrakTrain[]=[];
  for(const group of Object.values(data)){
    if(!Array.isArray(group))throw new Error("Amtraker train group changed format");
    for(const raw of group.slice(0,20)){
      try {
        if(!raw||raw.provider!=="Amtrak"||!/^\d{1,5}$/.test(raw.trainNum)||!Array.isArray(raw.stations))continue;
        const calls:TrainCall[]=raw.stations.slice(0,200).flatMap((s:any,index:number)=>{
          if(!s||s.bus||!/^[A-Z0-9]{2,5}$/.test(s.code))return [];
          const zone=metadata[s.code]?.tz||s.tz;
          const status=String(s.status||"Unknown"),departed=status==="Departed",arrived=status==="Station";
          return [{code:s.code,name:typeof s.name==="string"?s.name:s.code,sequence:index+1,
            timezone:validZone(zone)?zone:null,status,
            scheduledArrival:iso(s.schArr),scheduledDeparture:iso(s.schDep),
            actualArrival:departed||arrived?iso(s.arr):null,actualDeparture:departed?iso(s.dep):null,
            estimatedArrival:status==="Enroute"?iso(s.arr):null,estimatedDeparture:status==="Enroute"||arrived?iso(s.dep):null}];
        });
        const origin=calls[0]?.scheduledDeparture||calls[0]?.scheduledArrival;
        if(!origin||!calls.length)continue;
        // The API's trainID contains only a day-of-month and is not globally unique.
        const serviceDate=DateTime.fromISO(origin).setZone("America/New_York").toFormat("yyyyMMdd");
        const at=iso(raw.lastValTS); // never createdAt, provider update time, or fetch time
        const lat=typeof raw.lat==="number"&&Number.isFinite(raw.lat)&&Math.abs(raw.lat)<=90?raw.lat:null;
        const lon=typeof raw.lon==="number"&&Number.isFinite(raw.lon)&&Math.abs(raw.lon)<=180?raw.lon:null;
        result.push({id:`amtrak:observation:${raw.trainNum}:${Date.parse(origin)}`,trainNumber:raw.trainNum,
          routeName:typeof raw.routeName==="string"?raw.routeName:"Unknown route",destination:typeof raw.destName==="string"?raw.destName:calls.at(-1)!.name,
          serviceDate,source:AMTRAKER_SOURCE,updatedAt:at,expiresAt:at?new Date(Date.parse(at)+AMTRAK_FRESH_MS).toISOString():null,
          state:String(raw.trainState||"Unknown"),lat,lon,calls,matched:false,
          message:"Unresolved tracking identity: no unique published trip association. No scheduled train is replaced."});
      }catch{ /* One malformed record cannot disable the other trains. */ }
    }
  }
  if(result.length>2000)throw new Error("Amtraker train count exceeds limit");
  return [...new Map(result.map(t=>[t.id,t])).values()];
}
export interface PublishedTrain {
  id:string;trip:Record<string,string>;route:{id:string;name:string};
  calendar:Record<string,string>|undefined;exceptions:Record<string,string>[];
  calls:{code:string;arrival:number;departure:number;pickup?:string}[];
}
const aliases:Record<string,string>={"cascades":"amtrak cascades","hiawatha":"hiawatha service","hartford line":"amtrak hartford line"};
const routeKey=(name:string)=>{const key=name.trim().toLowerCase();return aliases[key]||key;};
export function matchAmtrakTrain(train:AmtrakTrain,candidates:PublishedTrain[]):AmtrakTrain {
  const matches=candidates.filter(p=>{
    if(p.trip.trip_short_name!==train.trainNumber||routeKey(p.route.name)!==routeKey(train.routeName))return false;
    if(!activeService(p.calendar,p.exceptions,train.serviceDate)||p.calls.length!==train.calls.length)return false;
    return p.calls.every((c,i)=>{
      const call=train.calls[i],at=call.scheduledDeparture||call.scheduledArrival,seconds=c.departure>=0?c.departure:c.arrival;
      return c.code===call.code&&!!at&&seconds>=0&&
        Math.abs(serviceInstant(train.serviceDate,seconds,p.trip.agency_timezone||"America/New_York")-Date.parse(at))<=60_000;
    });
  });
  return matches.length===1?{...train,routeId:matches[0].route.id,tripId:matches[0].id,matched:true,
    message:"Matched by service date, train number, verified route name and ordered scheduled station calls."}:train;
}
export function trainPosition(t:AmtrakTrain,now=Date.now()) {
  // Coordinates alone do not imply movement: predeparture/completed/canceled runs stay details-only.
  if(!observationFresh(t,now)||t.state!=="Active"||t.lat===null||t.lon===null||
    t.calls.every(c=>c.status==="Departed")||t.calls.every(c=>!c.actualDeparture&&!c.actualArrival))return;
  return {id:t.id,runId:t.id,routeId:t.routeId,agencyId:"amtrak",routeName:t.routeName,trainNumber:t.trainNumber,
    destination:t.destination,lat:t.lat,lon:t.lon,source:t.source,updatedAt:t.updatedAt!,expiresAt:t.expiresAt!};
}
