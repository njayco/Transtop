import { useEffect,useState } from 'react';
import type { Arrival } from '@workspace/api-client-react';
import { safeAmtrakArrival } from './vehicle-visibility';

/** Revert expired observations even if the browser is offline or a refresh fails. */
export function useFreshArrivals(items:Arrival[]) {
  const [now,setNow]=useState(Date.now);
  const tracking=items.some(a=>a.trainNumber&&a.source==='live');
  useEffect(()=>{
    if(!tracking)return;
    const timer=setInterval(()=>setNow(Date.now()),10_000);
    return ()=>clearInterval(timer);
  },[tracking]);
  return items.map(a=>safeAmtrakArrival(a,Math.max(now,Date.now())));
}
