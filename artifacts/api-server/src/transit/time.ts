import { DateTime } from "luxon";
export const ZONE="America/New_York";
export function gtfsSeconds(value:string) {
  if(!/^\d{1,3}:\d\d:\d\d$/.test(value))throw new Error("Invalid GTFS time");
  const [h,m,s]=value.split(":").map(Number);
  if(m>59||s>59)throw new Error("Invalid GTFS time");
  return h*3600+m*60+s;
}
// GTFS defines service-day times relative to noon minus 12 elapsed hours.
// This is important across DST: civil midnight + elapsed seconds is not equivalent.
export function serviceInstant(date:string,seconds:number,zone=ZONE) {
  return DateTime.fromFormat(date,"yyyyMMdd",{zone}).set({hour:12}).minus({hours:12}).plus({seconds}).toMillis();
}
export function serviceDates(now=Date.now(),zone=ZONE) {
  const day=DateTime.fromMillis(now,{zone});
  return [-2,-1,0,1,2].map(d=>day.plus({days:d}).toFormat("yyyyMMdd"));
}
export function activeService(calendar:Record<string,any>|undefined,exceptions:Record<string,any>[],date:string) {
  const override=exceptions.find(e=>e.date===date);
  if(override)return override.exception_type==="1";
  if(!calendar||date<calendar.start_date||date>calendar.end_date)return false;
  const weekday=DateTime.fromFormat(date,"yyyyMMdd",{zone:ZONE}).toFormat("cccc").toLowerCase();
  return calendar[weekday]==="1";
}
