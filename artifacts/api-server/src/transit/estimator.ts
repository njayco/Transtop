import { db, pool, derivedEstimates } from "@workspace/db";
import { distance, type Arrival, type TransitStop } from "./types";
export const MIN_CONTRIBUTORS=Math.max(3,Number(process.env.COMMUNITY_MIN_CONTRIBUTORS)||3);
export const SAMPLE_FRESH_MS=90000;
// Orthogonal projection onto consecutive shape segments; progress is meters along
// the trip's own directional GTFS shape, never a guess from route name alone.
export function project(lat:number,lon:number,shape:number[][]) {
  let best={distance:Infinity,progress:0}, travelled=0;
  for(let i=1;i<shape.length;i++){
    const [x1,y1]=shape[i-1],[x2,y2]=shape[i];
    const scale=Math.cos(lat*Math.PI/180), dx=(x2-x1)*scale,dy=y2-y1;
    const t=Math.max(0,Math.min(1,((lon-x1)*scale*dx+(lat-y1)*dy)/(dx*dx+dy*dy||1)));
    const length=distance(y1,x1,y2,x2), d=distance(lat,lon,y1+t*dy,x1+t*(x2-x1));
    if(d<best.distance)best={distance:d,progress:travelled+t*length};
    travelled+=length;
  }
  return best;
}
export async function tripShape(mode:string,tripId:string) {
  const {rows}=await pool.query(`SELECT s.data FROM transit_trips t JOIN transit_shapes s
    ON s.mode=t.mode AND s.id=(t.agency || ':' || (t.data->>'shape_id'))
    WHERE t.mode=$1 AND t.id=$2`,[mode,tripId]);
  if(rows[0])return rows[0].data.coordinates as number[][];
  // Demo shapes already carry the complete namespaced shape identifier.
  const {rows:demo}=await pool.query(`SELECT s.data FROM transit_trips t JOIN transit_shapes s ON s.mode=t.mode AND s.id=t.data->>'shape_id' WHERE t.mode=$1 AND t.id=$2`,[mode,tripId]);
  return demo[0]?.data.coordinates as number[][]|undefined;
}
const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
export async function communityArrivals(stop:TransitStop,now=Date.now()):Promise<Arrival[]> {
  const output:Arrival[]=[];
  for(const route of stop.routes) {
    // Only recent, consented, explicitly trip-associated sessions qualify.
    // A browser-scoped pseudonym prevents one browser opening multiple rides
    // from satisfying the independent-contribution threshold.
    const {rows}=await pool.query(`
      SELECT s.trip_id, s.contributor_hash, l.progress, l.timestamp FROM transit_ride_sessions s
      JOIN transit_location_samples l ON l.ride_id=s.id
      WHERE s.active=true AND s.mode='live' AND s.route_id=$1 AND s.trip_id IS NOT NULL
        AND s.expires_at>now() AND l.timestamp>now()-interval '90 seconds'
      ORDER BY l.timestamp DESC`,[route.id]);
    const byTrip=new Map<string,Map<string,any[]>>();
    for(const r of rows){
      if(!byTrip.has(r.trip_id))byTrip.set(r.trip_id,new Map());
      const group=byTrip.get(r.trip_id)!;
      if(!group.has(r.contributor_hash))group.set(r.contributor_hash,[]);
      group.get(r.contributor_hash)!.push(r);
    }
    for(const [tripId,people] of byTrip){
      const votes=[...people.values()].filter(s=>s.length>=2&&new Date(s[0].timestamp).getTime()-new Date(s[1].timestamp).getTime()>=5000);
      if(votes.length<MIN_CONTRIBUTORS)continue;
      const positions=votes.map(s=>Number(s[0].progress));
      if(Math.max(...positions)-Math.min(...positions)>400)continue; // Different vehicles / ambiguous association.
      const speeds=votes.map(s=>(s[0].progress-s[1].progress)/((+new Date(s[0].timestamp)-+new Date(s[1].timestamp))/1000)).filter(v=>v>1&&v<55);
      if(speeds.length<MIN_CONTRIBUTORS)continue;
      const shape=await tripShape("live",tripId);if(!shape||shape.length<2)continue;
      const destination=project(stop.lat,stop.lon,shape);
      const remaining=destination.progress-median(positions);
      if(remaining<0||destination.distance>200)continue;
      const seconds=remaining/median(speeds)+30;
      const min=Math.max(1,Math.floor(seconds*.75/60)),max=Math.max(min+1,Math.ceil(seconds*1.35/60));
      const arrival:Arrival={id:`community:${tripId}:${stop.id}`,routeId:route.id,routeName:route.name,color:route.color,
        direction:"Selected trip direction",destination:stop.name,minutes:min,rangeMax:max,confidence:"Heuristic · uncalibrated",source:"community",
        updatedAt:new Date(now).toISOString(),scheduledAt:new Date(now+seconds*1000).toISOString(),status:"Community estimate",tripId};
      output.push(arrival);
      await db.insert(derivedEstimates).values({id:arrival.id,mode:"live",agency:route.id.split(":")[0],data:{...arrival,contributors:votes.length}})
        .onConflictDoUpdate({target:[derivedEstimates.mode,derivedEstimates.id],set:{data:{...arrival,contributors:votes.length},updatedAt:new Date()}});
    }
  }
  return output;
}
