import { DateTime } from "luxon";
/** Deliberately closed approval list. Discovery never grants permission. */
export const odptRegistry = [
  {id:"odpt-sendai",organization:"SendaiMunicipal",dataset:"bus_realtime_information",
    name:"仙台市交通局 / Transportation Bureau City of Sendai",title:"Bus information",
    catalog:"sendai_municipal_bus_realtime_information",type:"bus" as const,routeTypes:["3"],
    catalogTermsHash:"1fab277de84887d4ab0a71638ec4233bfcd71d1feca5e0879c5a2f74798875ab",
    realtime:["vehicle","trip_update","alert"],
    description:"仙台市交通局のGTFS-JPデータ及びGTFSリアルタイムデータです。\r\n※運用の関係で、GTFS-JP内に一部類似データがございます。\r\nこのため、リアルタイムデータとの連携に一部不具合が生じる場合がございますのでご注意ください。"},
  {id:"odpt-hana",organization:"NishitokyoCity",dataset:"AllLines",
    name:"西東京市 / Nishitokyo City",title:"西東京市はなバス / Nishitokyo City Hana Bus",
    catalog:"nishitokyo_city_all_lines",type:"bus" as const,routeTypes:["3"],realtime:[],
    catalogTermsHash:"fd57326386d30d12b5b8bfb358cd17d8280e22bf9b3d58670df581bde602b28c",
    description:"西東京市コミュニティバス「はなバス」のGTFS-JPデータです。（第１ルート、第２ルート、第３ルート、第４北ルート、第４南ルート）"},
  {id:"odpt-tosaden",organization:"TosadenTraffic",dataset:"Streetcar",
    name:"とさでん交通株式会社 / Tosaden Traffic CO.,LTD",title:"とさでん交通 路面電車 / Tosaden Traffic Streetcar",
    catalog:"tosaden_traffic_streetcar",type:"rail" as const,routeTypes:["0"],realtime:[],
    catalogTermsHash:"09da752dfb5f134ab98c3906f086f5fc62a0e393af28b2647f30d84ec35c8700",
    description:"とさでん交通、路面電車のGTFS Scheduleデータです"},
];
export type OdptSource = typeof odptRegistry[number];
export const odptSource=(id:string)=>odptRegistry.find(s=>s.id===id);
export const odptEnabled=()=>process.env.ODPT_ENABLED!=="false";
export function odptRefreshDue(data:any,now=Date.now()){
  return !data||!data.serviceEnd||data.serviceEnd<DateTime.fromMillis(now,{zone:"Asia/Tokyo"}).toISODate()!||
    !Number.isFinite(Date.parse(data.importedAt))||now-Date.parse(data.importedAt)>=22*3600000;
}
export const odptLicense="https://creativecommons.org/licenses/by/4.0/";
export const odptTerms="https://developer.odpt.org/en/faq-info#cc-by-credit";
export const sendaiRealtimeCatalog="https://ckan.odpt.org/dataset/odpt_sendai_municipal_bus_realtime_information";
export const sendaiRealtimeTermsHash="c625eb8976784f116eead16e69520e9af688a59e218f4ec846c6ebd64110fb3d";
export const catalogUrl=(s:OdptSource)=>`https://ckan.odpt.org/dataset/${s.catalog}`;
export function realtimeUrl(s:OdptSource,kind:string){
  if(!(s.realtime as string[]).includes(kind))throw new Error("ODPT capability not approved");
  return `https://api-public.odpt.org/api/v4/gtfs/realtime/odpt_${s.organization}_${s.dataset}_${kind}`;
}
export function attribution(s:OdptSource){
  return `Transtop uses the following material with modifications: ${s.name}, ${s.title}, via Public Transportation Open Data Center (ODPT), CC BY 4.0. No affiliation or accuracy guarantee.`;
}
