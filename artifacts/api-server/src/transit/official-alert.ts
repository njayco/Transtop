import type { TransitAlert } from "./types";
const text=(t:any)=>t?.translation?.find((x:any)=>x.language==="en")?.text||t?.translation?.[0]?.text||"";
/** Global MTA alerts identify operators internally; operator feeds are scoped. */
export function officialAlert(entity:any,agency?:string):TransitAlert {
  const a=entity.alert;
  return {id:`${agency||"mta"}-alert:${entity.id}`,title:text(a.headerText),description:text(a.descriptionText),
    severity:a.effect===1?"disruption":a.effect===3?"delay":"notice",
    routeIds:[...new Set<string>((a.informedEntity||[]).filter((i:any)=>i.routeId||i.trip?.routeId).map((i:any)=>{
      const operator=agency||(i.agencyId==="LI"?"mta-lirr":i.agencyId==="MNR"?"mta-mnr":"mta-subway");
      return `${operator}:${i.routeId||i.trip.routeId}`;
    }))],source:"Live agency data"};
}
