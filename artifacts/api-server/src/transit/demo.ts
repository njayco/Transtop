import { db, agencies, stops, routes, alerts, trips, shapes } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { TransitStop, TransitRoute, TransitAlert } from "./types";

const route = (name:string,color:string,type:"subway"|"bus"|"rail"="subway",agency="mta-subway"):TransitRoute =>
  ({id:`${agency}:${name}`,name,color,type,agency:type==="subway"?"MTA New York City Transit":agency==="mta-lirr"?"Long Island Rail Road":agency==="mta-mnr"?"Metro-North Railroad":"MTA Bus"});
export const demoRoutes:TransitRoute[]=[
  ...["1","2","3"].map(n=>route(n,"#EE352E")), ...["N","Q","R","W"].map(n=>route(n,"#FCCC0A")),
  route("7","#B933AD"),route("S","#808183"),...["B","D","F","M"].map(n=>route(n,"#FF6319")),
  ...["A","C","E"].map(n=>route(n,"#2850AD")), ...["4","5","6"].map(n=>route(n,"#00933C")),
  route("M42","#2485D6","bus","mta-bus"),route("M7","#2485D6","bus","mta-bus"),
  route("M20","#2485D6","bus","mta-bus"),route("Port Washington","#2D8CDB","rail","mta-lirr"),
  route("Ronkonkoma","#AF62CA","rail","mta-lirr"),route("Hudson","#37B587","rail","mta-mnr"),
  route("Harlem","#2D8CDB","rail","mta-mnr"),
];
const defs:[string,string,number,number,string[],string][]=[
  ["mta-subway:127","Times Sq–42 St",40.75529,-73.98749,["1","2","3","N","Q","R","W","7","S"],"Theater District"],
  ["mta-subway:D16","42 St–Bryant Park",40.75422,-73.98459,["B","D","F","M"],"Midtown Manhattan"],
  ["mta-bus:403734","W 42 St / 7 Av",40.7555,-73.9871,["M42"],"Theater District"],
  ["mta-subway:128","34 St–Penn Station",40.75037,-73.99106,["1","2","3"],"Chelsea"],
  ["mta-subway:631","Grand Central–42 St",40.75178,-73.97685,["4","5","6","7","S"],"Midtown East"],
  ["mta-subway:A27","42 St–Port Authority",40.75731,-73.98973,["A","C","E"],"Hell's Kitchen"],
  ["mta-bus:403019","7 Av / W 41 St",40.7547,-73.9888,["M7","M20"],"Midtown Manhattan"],
  ["mta-lirr:237","Penn Station",40.7506,-73.9935,["Port Washington","Ronkonkoma"],"Midtown West"],
  ["mta-mnr:1","Grand Central Terminal",40.7527,-73.9772,["Hudson","Harlem"],"Midtown East"],
  ["mta-subway:R14","Union Sq–14 St",40.73574,-73.99057,["N","Q","R","W"],"Union Square"],
  ["mta-subway:R11","57 St–7 Av",40.76466,-73.98066,["N","Q","R","W"],"Midtown Manhattan"],
  ["mta-lirr:135","Mineola",40.7409,-73.6409,["Ronkonkoma"],"Long Island"],
];
export const demoAlerts:TransitAlert[]=[{id:"demo:alert:R",title:"R trains running with delays",description:"Allow additional travel time in both directions while crews address a signal issue near 34 St. This is an illustrative demo alert.",severity:"delay",routeIds:["mta-subway:R"],source:"demo"}];
export async function seedDemo() {
  const existing=await db.select().from(stops).where(and(eq(stops.mode,"demo"),eq(stops.id,defs[0][0]))).limit(1);
  if(existing.length)return;
  for(const a of ["mta-subway","mta-bus","mta-lirr","mta-mnr"]) {
    await db.insert(agencies).values({id:a,mode:"demo",agency:a,data:{name:a,timezone:"America/New_York"}}).onConflictDoNothing();
  }
  await db.insert(routes).values(demoRoutes.map(r=>({id:r.id,agency:r.id.split(":")[0],mode:"demo",data:r}))).onConflictDoNothing();
  for(const [i,d] of defs.entries()) {
    const rs=demoRoutes.filter(r=>d[4].includes(r.name));
    const s:TransitStop={id:d[0],name:d[1],lat:d[2],lon:d[3],routes:rs,agency:rs[0].agency,type:rs[0].type,
      neighborhood:d[5],distance:0,walkingMinutes:0,accessible:i!==1,arrivals:[],alerts:demoAlerts.filter(a=>rs.some(r=>a.routeIds.includes(r.id))),updatedAt:new Date().toISOString()};
    await db.insert(stops).values({id:s.id,agency:s.id.split(":")[0],mode:"demo",data:s}).onConflictDoNothing();
  }
  await db.insert(alerts).values(demoAlerts.map(a=>({id:a.id,agency:"mta-subway",mode:"demo",data:a}))).onConflictDoNothing();
  // An explicitly identified demo trip allows the contribution flow to be exercised.
  for(const r of demoRoutes) {
    const ss=defs.filter(d=>d[4].includes(r.name));
    const shape=ss.map(s=>[s[3],s[2]]);
    await db.insert(shapes).values({id:`${r.id}:shape`,agency:r.id.split(":")[0],mode:"demo",data:{coordinates:shape}}).onConflictDoNothing();
    await db.insert(trips).values({id:`${r.id}:demo-trip`,agency:r.id.split(":")[0],mode:"demo",data:{route_id:r.name,routeId:r.id,shape_id:`${r.id}:shape`,direction_id:"0",trip_headsign:"Uptown",stopIds:ss.map(s=>s[0])}}).onConflictDoNothing();
  }
}
export function demoArrivals(s:TransitStop):TransitStop {
  const now=Date.now();
  const destinations:Record<string,string>={"1":"Van Cortlandt Park–242 St","2":"Wakefield–241 St","3":"Harlem–148 St","N":"Astoria–Ditmars Blvd","Q":"96 St","R":"Forest Hills–71 Av","W":"Astoria–Ditmars Blvd","7":"Flushing–Main St","S":"Grand Central–42 St","M42":"East Side–United Nations","M7":"Harlem–147 St","M20":"Lincoln Center","Port Washington":"Port Washington","Ronkonkoma":"Ronkonkoma","Hudson":"Poughkeepsie","Harlem":"Southeast"};
  const as=s.routes.slice(0,5).flatMap((r,i)=>[0,1,2].map(j=>({
    id:`demo:${s.id}:${r.id}:${j}`,routeId:r.id,routeName:r.name,color:r.color,direction:j===2?"Downtown":"Uptown",
    destination:j===2?"Downtown & Brooklyn":destinations[r.name]||"Uptown & The Bronx",minutes:2+i*2+j*7,
    source:"demo" as const,updatedAt:new Date(now).toISOString(),scheduledAt:new Date(now+(2+i*2+j*7)*60000).toISOString(),
    status:r.name==="R"?"Delays":"On time",...(j!==2?{tripId:`${r.id}:demo-trip`}:{}),
  }))).sort((a,b)=>a.minutes-b.minutes);
  return {...s,arrivals:as,updatedAt:new Date(now).toISOString()};
}
