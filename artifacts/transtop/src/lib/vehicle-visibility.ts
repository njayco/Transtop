/** Train positions are gated by their own coordinates, not by GTFS shape availability. */
export function amtrakVisible(v:{lat:number;lon:number;routeId?:string},p:{
  type?:string;agency?:string;serviceClass?:string;routeId?:string;
  west?:number;east?:number;south?:number;north?:number;
}) {
  return (!p.type||p.type==='all'||p.type==='rail')&&(!p.agency||p.agency==='amtrak')&&
    p.serviceClass!=='express'&&(!p.routeId||v.routeId===p.routeId)&&
    (p.west===undefined||v.lon>=p.west&&v.lon<=p.east!&&v.lat>=p.south!&&v.lat<=p.north!);
}
export function vehicleFresh(v:{updatedAt?:string;expiresAt?:string;agencyId?:string},now=Date.now()) {
  const at=Date.parse(v.updatedAt||'');
  const expires=v.agencyId==='amtrak'?Math.min(Date.parse(v.expiresAt||''),at+300_000):at+60_000;
  return Number.isFinite(at)&&Number.isFinite(expires)&&at<=now+30_000&&expires>=now;
}
export function safeAmtrakArrival<T extends {source:string;trainNumber?:string;updatedAt?:string;expiresAt?:string;publishedAt?:string}>(a:T,now=Date.now()):T {
  if(!a.trainNumber||a.source!=='live'||vehicleFresh({...a,agencyId:'amtrak'},now))return a;
  const scheduled=Date.parse(a.publishedAt||'');
  return {...a,source:Number.isFinite(scheduled)?'scheduled':'unavailable',scheduledAt:a.publishedAt,
    minutes:Math.max(0,Math.ceil((scheduled-now)/60_000)),status:'Tracking stale or unavailable · scheduled fallback'};
}
