import rawDocuments from "./transbridge-tables.json";
import type { DocumentRoute,DocumentTrip,PublishedPoint } from "./uploaded-data";

export const TRANSBRIDGE_HOLIDAY_DATES=["2026-11-26","2026-11-27"];
type Table={routeId:string;effectiveDate:string;runs:string[];frequencies:string[];gates:string[];stopIds:string[];
  rows:{kind:string;cells:string[];y:number}[]};
type Source={file:string;sha256:string;sourceUrl:string;role:string;holiday:boolean;tables:Table[]};
export const transbridgeDocuments:Source[]=rawDocuments;
const weekdays:Record<string,number[]>={WD:[1,2,3,4,5],"M-F":[1,2,3,4,5],"M-TH":[1,2,3,4],F:[5],"S/S":[6,7],SAT:[6],SUN:[7]};
function requireValue<T>(v:T|undefined,message:string):T {if(v===undefined)throw new Error(message);return v;}
function clock(cell:string,first:number) {
  const m=/^D?(\d{1,2}):(\d{2})([ap])$/i.exec(cell);
  if(!m||+m[1]<1||+m[1]>12||+m[2]>59)throw new Error("Invalid Trans-Bridge clock: "+cell);
  let minutes=(+m[1]%12)*60+(+m[2])+(m[3].toLowerCase()==="p"?720:0);
  if(minutes<first)minutes+=1440;
  return minutes;
}
function tripFrom(source:Source,table:Table,col:number):DocumentTrip {
  const number=table.runs[col].replace("*","");
  const firstRow=table.rows.find(r=>/^\d/.test(r.cells[col])&&r.kind==="Lv.");
  const first=clock(requireValue(firstRow,"No timed boarding point").cells[col],0);
  let previous=first;
  const staged=table.rows.flatMap((r,index)=>{
    const cell=r.cells[col];
    if(cell==="-"||!cell)return [];
    const timed=/\d/.test(cell),minutes=timed?clock(cell,first):undefined;
    const pickup=r.kind==="Lv."&&!cell.startsWith("D");
    const point:PublishedPoint={stopId:table.stopIds[index],minutes,pickup,dropoff:!pickup,
      ...(cell==="R"?{reservationOnly:true}:{})};
    // Keys order printed times, not physical table rows (some rows are not
    // chronological). Untimed D/R retain their logical position without a clock.
    const order=minutes??(cell==="R"?(pickup?-1:1e9):previous+0.01);
    if(minutes!=null)previous=minutes;
    return [{point,order}];
  }).sort((a,b)=>a.order-b.order);
  if(staged.filter(s=>s.point.minutes!=null).some(s=>s.point.minutes!>first+6*60))throw new Error("Implausible Trans-Bridge duration");
  const holiday=source.holiday;
  const days=holiday?[1,2,3,4,5,6,7]:requireValue(weekdays[table.frequencies[col]],"Unknown Trans-Bridge frequency");
  let note=`${holiday?"Verified November 26–27, 2026 holiday replacement":"Regular published "+table.frequencies[col]+" service"}. Arrival rows and D stops are not boarding departures.`;
  if(table.gates[col])note+=` PABT published gate ${table.gates[col]}, lower level South Wing; confirm current gate.`;
  if(staged.some(s=>s.point.reservationOnly))note+=" Cruise-terminal extension/pickup is reservation-only; its time is not published.";
  const points=staged.map(s=>s.point);
  if(number==="128"&&!holiday) {
    points.push({stopId:"transbridge:ATC",pickup:false,dropoff:true,boardingStopIds:["transbridge:EWR"]});
    note+=" Run 128 serves Allentown Transportation Center for Newark Airport passengers only; its arrival time is not published.";
  }
  if(["204","232"].includes(number))note+=" Newark Airport passengers may request discharge at stops along the route per the printed footnote; unprinted times remain unavailable.";
  return {id:`transbridge:${table.routeId.split(":")[1]}:${holiday?"holiday":"regular"}:${number}`,routeId:table.routeId,providerId:"transbridge",number,
    days,effectiveDate:table.effectiveDate,points,sourceUrl:source.sourceUrl,
    ...(holiday?{serviceDates:TRANSBRIDGE_HOLIDAY_DATES}:{}),
    direction:table.routeId.endsWith("east")?"Eastbound to New York":"Westbound from New York & Newark",note};
}
export const transbridgeTrips:DocumentTrip[]=transbridgeDocuments.filter(d=>d.role==="primary")
  .flatMap(d=>d.tables.flatMap(t=>t.runs.map((_,col)=>tripFrom(d,t,col))));
if(new Set(transbridgeTrips.map(t=>t.id)).size!==transbridgeTrips.length)throw new Error("Duplicate Trans-Bridge trip IDs");

// Reference tables are subsets, not additional buses. Verify every printed time
// against its parent run. Preserve omissions and discrepancies in an audit
// rather than inventing extra services or overwriting the newer full timetable.
export const transbridgeCrossChecks:{file:string;run:string;matchedTripIds:string[];differences:string[]}[]=[];
for(const source of transbridgeDocuments.filter(d=>d.role==="cross-check"))for(const table of source.tables)for(let col=0;col<table.runs.length;col++) {
  const number=table.runs[col].replace("*","");
  const candidates=transbridgeTrips.filter(t=>t.routeId===table.routeId&&!!t.serviceDates===source.holiday&&
    (t.number===number||number==="181"&&t.number==="181F")&&
    (source.holiday||t.days.some(day=>(weekdays[table.frequencies[col]]||[]).includes(day))));
  if(!candidates.length)throw new Error("Reference sheet missing parent: "+source.file+" "+number);
  const differences:string[]=[];
  for(const candidate of candidates)for(let row=0;row<table.rows.length;row++) {
    const cell=table.rows[row].cells[col];
    if(!/\d/.test(cell))continue;
    const pt=candidate.points.find(p=>p.stopId===table.stopIds[row]);
    const first=candidate.points.find(p=>p.pickup&&p.minutes!=null)!.minutes!;
    if(pt?.minutes!==clock(cell,first))differences.push(`${candidate.number} ${table.stopIds[row]}: subset ${cell}, complete timetable ${pt?.minutes??"unpublished"}`);
    if(pt?.minutes!=null&&pt.minutes!==clock(cell,first)) {
      pt.timeUnverified=true;
      if(!candidate.note.includes("Conflicting airport-subset"))
        candidate.note+=" Conflicting airport-subset onward times are withheld pending carrier confirmation; see each affected stop.";
    }
  }
  transbridgeCrossChecks.push({file:source.file,run:number,matchedTripIds:candidates.map(t=>t.id),differences});
}
export const transbridgeRoutes:DocumentRoute[]=["allentown-east","allentown-west","doylestown-east","doylestown-west"].map(code=>{
  const east=code.endsWith("east"),doy=code.startsWith("doylestown");
  const documents=transbridgeDocuments.filter(d=>d.role==="primary"&&d.tables.some(t=>t.routeId===`transbridge:${code}`));
  return {id:`transbridge:${code}`,name:`${doy?"Doylestown / Flemington":"Allentown / Clinton"} · ${east?"Eastbound":"Westbound"}`,
    longName:doy?"Doylestown, Lahaska, New Hope, Lambertville, Flemington, Branchburg, New York PABT":
      "Allentown, Bethlehem, Wescosville, Hellertown, Wind Creek, ABE, William Penn, Easton, Clinton, Newark Airport, New York PABT",
    providerId:"transbridge",agency:"Trans-Bridge Lines",type:"intercity",color:"#52ad8b",
    sourceUrl:documents.find(d=>!d.holiday)!.sourceUrl,
    notes:[
      `User-supplied, carrier-published ${doy?"Doylestown/Flemington":"Allentown/Clinton/NYC"} schedules. Regular weekday and weekend calendars are distinct. Published times, not live predictions.`,
      "Verified Thanksgiving (November 26) and Black Friday (November 27), 2026 schedules REPLACE regular service on those exact dates. All other unverified holiday service is withheld. Wall Street is separately closed in both directions.",
      "Separate Newark Airport and Wind Creek sheets describe existing runs. Each physical run is shown once with its complete main-table stop pattern; blank cells in a subset do not cancel stops in the complete timetable.",
      "Lv. means boarding/departure; Ar. means arrival, not permission to board. D is discharge-only. Untimed D and reservation-only R points remain visible without invented times.",
      "Some tables list geographic rows out of chronological order; trip stops are ordered by their explicit printed clock times, including after-midnight arrivals on the next date.",
      "Stop addresses and map-place links checked against https://transbridgelines.com/schedules-stops/bus-stops on October 30, 2026. Area/airport/place markers are labeled and are not exact bus-pole coordinates. No route lines or vehicle locations have been fabricated.",
      ...(doy?["Flemington uses the temporary/current 80 Park Avenue transfer center, not the stale 81 NJ-12 map target. Quakertown is not served by every run."]:
        ["At Newark Airport, printed times refer to Terminal A, lower-level roadway Zone 16; Terminal B is two minutes later and C four minutes later per the carrier. One shared airport location is used; individual terminal minutes are not duplicated as separate buses.",
          "Cruise-terminal R service requires reservation with 610-868-6001 and has no published clock time in these tables.",
          "Published PABT gates are 2/4/6, lower level South Wing; confirm the current gate. No cash fares at PABT.",
          "Run 128's Allentown extension is for Newark Airport passengers only, without a printed arrival time. Runs 204/232 allow Newark-passenger drop-offs along the route per their footnote."]),
      ...documents.map(d=>`${d.holiday?"Holiday replacement":"Regular source"}: ${d.sourceUrl}`),
      ...(!doy?["Source discrepancy: regular weekend run 214 has conflicting Hellertown, Wescosville and Allentown arrival times in the airport extract versus complete timetable. Those three onward clock times are withheld; boarding times and other matching stops remain published.",
        "The June airport extract labels run 181 as all weekdays and lists Allentown/Bethlehem on Fridays. The newer July 10 full timetable's Friday run 181F starts at ABE; the superseded Friday Allentown/Bethlehem pickups are not shown."]:[]),
    ]};
});
