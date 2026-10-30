import { useEffect,useState } from 'react';
import type { Arrival } from '@workspace/api-client-react';
import { safeAmtrakArrival } from './vehicle-visibility';

/** Revert expired observations even if the browser is offline or a refresh fails. */
export function useFreshArrivals(items:Arrival[]) {
  const [now,setNow]=useState(Date.now);
  const tracking=items.some(a=>(a.trainNumber||a.expiresAt)&&a.source==='live');
  useEffect(()=>{
    if(!tracking)return;
    const timer=setInterval(()=>setNow(Date.now()),10_000);
    return ()=>clearInterval(timer);
  },[tracking]);
  return items.map(a=>{
    const at=Math.max(now,Date.now());
    if(a.source==='live'&&!a.trainNumber&&a.expiresAt&&Date.parse(a.expiresAt)<=at){
      const published=Date.parse(a.publishedAt||'');
      return {...a,source:Number.isFinite(published)?'scheduled' as const:'unavailable' as const,scheduledAt:a.publishedAt||a.scheduledAt,
        minutes:Math.max(0,Math.ceil((published-at)/60000)),status:'Prediction expired · published schedule'};
    }
    return safeAmtrakArrival(a,at);
  });
}
