import {pool} from "@workspace/db";

export function applyVehicleRoutes(entities:any[],agency:string,rows:{id:string;data:any}[]){
  const byId=new Map(rows.map(row=>[row.id,row.data.route_id]));
  for(const entity of entities)for(const trip of [entity.vehicle?.trip,entity.tripUpdate?.trip]){
    if(!trip?.tripId||trip.routeId)continue;
    const route=byId.get(`${agency}:${trip.tripId}`);
    if(typeof route==="string"&&route)trip.routeId=route.replace(new RegExp(`^${agency}:`),"");
  }
}
/** Commuter feeds omit route IDs. Resolve exact published trip identities only;
 * never infer a line from train number, nearest track or station proximity. */
export async function matchVehicleTrips(entities:any[],agency:string){
  const ids=[...new Set<string>(entities.flatMap(entity=>[entity.vehicle?.trip,entity.tripUpdate?.trip]
    .filter(trip=>trip?.tripId&&!trip.routeId).map(trip=>`${agency}:${trip.tripId}`)))];
  if(!ids.length)return;
  const {rows}=await pool.query("SELECT id,data FROM transit_trips WHERE mode='live' AND agency=$1 AND id=ANY($2::text[])",[agency,ids]);
  applyVehicleRoutes(entities,agency,rows);
}
