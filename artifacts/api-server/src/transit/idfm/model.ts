import type { TransitType } from "../types";
import { DateTime } from "luxon";
import { serviceInstant } from "../time";

export const IDFM_URL="https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip";
export const IDFM_SOURCE="https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/";
export const IDFM_LICENSE="https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm/download";
export const IDFM_ZONE="Europe/Paris";
export const IDFM_CREDIT="Contient des informations des Horaires prévus Île-de-France Mobilités, mises à disposition aux conditions de la Licence Mobilités.";
// Public deployment requires the owner to resolve PAN publication and notification.
// Development remains available for the approved integration and verification.
export function idfmEnabled(){
  return process.env.IDFM_ENABLED!=="false" &&
    (process.env.REPLIT_DEPLOYMENT!=="1"&&process.env.NODE_ENV!=="production" || process.env.IDFM_PUBLIC_COMPLIANCE_CONFIRMED==="true");
}
export function isIdfm(id?:string){return !!id?.startsWith("idfm:");}
export function expiredEdition(data:Record<string,any>|undefined,now=Date.now()){
  if(!data?.serviceEnd)return true;
  return serviceInstant(data.serviceEnd,Math.max(86400,Number(data.maxDepartureSeconds)||0),IDFM_ZONE)<=now;
}
export function parisMode(raw:string):{type:TransitType;detail:string}|undefined{
  if(raw==="0"||/^9\d\d$/.test(raw))return {type:"rail",detail:"Tramway"};
  if(raw==="1"||raw==="400"||raw==="401"||raw==="402")return {type:"subway",detail:"Métro"};
  if(raw==="2"||/^1\d\d$/.test(raw))return {type:"rail",detail:"RER / Transilien / train"};
  if(raw==="3"||/^7\d\d$/.test(raw))return {type:"bus",detail:"Bus"};
  if(/^2\d\d$/.test(raw))return {type:"bus",detail:"Car / coach"};
  return undefined;
}
/** Latest documented publication slot, allowing 30 minutes for upstream upload. */
export function publicationSlot(now=Date.now()){
  const paris=DateTime.fromMillis(now,{zone:IDFM_ZONE}).minus({minutes:30});
  const hour=[17,13,8].find(h=>paris.hour>=h);
  return (hour===undefined?paris.minus({days:1}).set({hour:17}):paris.set({hour})).startOf("hour").toISO()!;
}
export function refreshDue(data:Record<string,any>|undefined,now=Date.now()){
  return !data?.checkedAt||Date.parse(data.checkedAt)<Date.parse(publicationSlot(now));
}
