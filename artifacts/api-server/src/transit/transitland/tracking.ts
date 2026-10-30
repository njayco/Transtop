import type { TransitRoute } from "../types";
export const activeGlobalRoutes = new Map<string,{route:TransitRoute;at:number;lat:number;lon:number}>();
export const globalFeedStates=new Map<string,{name:string;status:string;updatedAt:string}>();
export function feedState(id:string,status:string,name=id){
  if(globalFeedStates.size>=100)globalFeedStates.delete(globalFeedStates.keys().next().value!);
  globalFeedStates.set(id,{name,status,updatedAt:new Date().toISOString()});
}
export function rememberRoute(route:TransitRoute,lat:number,lon:number) {
  if(activeGlobalRoutes.size>=600)activeGlobalRoutes.delete(activeGlobalRoutes.keys().next().value!);
  activeGlobalRoutes.set(route.id,{route,at:Date.now(),lat,lon});
}
