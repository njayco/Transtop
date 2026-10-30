import type { TransitType } from "../types";
import { transbridgeTrips,transbridgeRoutes,TRANSBRIDGE_HOLIDAY_DATES } from "./transbridge";
import { transbridgeLocatedStops,transbridgeAddressStops } from "./transbridge-stops";

export type PublishedStop = { id:string; name:string; address:string; lat?:number; lon?:number };
export type PublishedPoint = { stopId:string; minutes?:number; pickup:boolean; dropoff:boolean;reservationOnly?:boolean;boardingStopIds?:string[];timeUnverified?:boolean };
export type DocumentTrip = { id:string; routeId:string; providerId:string; number:string; direction:string; days:number[];
  effectiveDate:string; points:PublishedPoint[]; note:string;sourceUrl?:string;serviceDates?:string[] };
export type DocumentRoute = { id:string; name:string; providerId:string; agency:string; type:TransitType; color:string;
  notes:string[]; sourceUrl:string;longName?:string };
export const VERIFIED_AT="2026-10-30T19:33:28.000Z";
export const WALL_CLOSED_DATES=TRANSBRIDGE_HOLIDAY_DATES;
export const WALL_CLOSURE="No Trans-Bridge Wall Street service eastbound or westbound on Thanksgiving, Thursday November 26, or Black Friday, Friday November 27, 2026. Confirmed by the supplied service notice.";
export const NJT_SOURCE="https://www.njtransit.com/bus-to";
export const WALL_SOURCE="https://transbridgelines.com/wp-content/uploads/2025/07/Wall-Street-Schedule-7-25-25.pdf";
const localNames=[
  "Pohatcong Wal-Mart","Pohatcong Plaza","Phillipsburg Mall","Brakeley Gardens",
  "Roseberry St. at Belvidere Rd.","Hillcrest Plaza","St. Luke's Warren Hospital","Phillipsburg Municipal Building",
  "Columbus Ave. at Congress St.","South Main St. at Abbott St.","South Main St. at Mercer St.",
  "Phillipsburg Senior Center","Lewis St. at Heckman St. / Heckman St. at Filmore St.",
  "Lewis St. at Summit Ave.","Summit Ave. at Route 22","Easton Transportation Center",
];
export const documentStops:PublishedStop[]=localNames.map((name,i)=>({
  id:`nj-transit:${i+1}`,name,address:`${name}; source map reference ${i+1}. Exact boarding pole not verified.`,
  ...(i===15?{lat:40.689434071649,lon:-75.209040322102,address:"Easton Transportation Center, 123 S 3rd Street, Easton, PA. Address-level map location; confirm boarding bay."}:{}),
  ...(i===0?{lat:40.677134426789,lon:-75.142608109327,address:"Wal-Mart, 1300 US Highway 22, Phillipsburg, NJ. Address-level map location; confirm designated boarding area."}:{}),
}));
function wallStop(code:string,name:string,address:string,coords?:[number,number]) {
  documentStops.push({id:`transbridge:${code}`,name,address,...(coords?{lat:coords[0],lon:coords[1]}:{})});
}
wallStop("ABE","Lehigh Valley International Airport (ABE)","3311 Airport Road, Allentown, PA · Intermodal; address-level map location",[40.651253803009,-75.43007448804]);
wallStop("WPH","William Penn Highway Park & Ride","Route 33 and Emrick Boulevard, off-ramp shelter; map location not yet verified");
wallStop("ANN","Annandale Square","Beaver Avenue at Old Allerton Road, Clinton, NJ; map location not yet verified");
wallStop("VAR","Varick & North Moore","Varick Street at North Moore Street, Manhattan · drop-off only");
wallStop("BTH","Broadway at Thomas","Broadway at Thomas Street, Manhattan · drop-off only; time not published");
wallStop("BWA","Broadway at Warren","Broadway at Warren Street, Manhattan · drop-off only; time not published");
wallStop("BCE","Broadway at Cedar","Broadway at Cedar Street, Manhattan · drop-off only; time not published");
wallStop("BRE","Broadway at Rector","Broadway at Rector Street, Manhattan · drop-off only; time not published");
wallStop("WBR-E","Water at Broad · eastbound drop-off","Water Street at Broad Street, Manhattan · drop-off only; time not published");
wallStop("WWA","Water and Wall","Water Street at Wall Street, Manhattan · drop-off only; time not published");
wallStop("WBR-W","Water and Broad · westbound boarding","Water and Broad Street near the restaurant listed in the PDF. Address-level orientation near 1 Water Street, not an exact bus-pole pin.",[40.703284765181,-74.010092405239]);
wallStop("BRI","Bridge Street","Bridge Street, Manhattan; confirm exact boarding position with carrier");
wallStop("TRI","Trinity at Rector","Trinity Place at Rector Street, Manhattan");
wallStop("CMU","Church and Murray","Church Street at Murray Street, Manhattan; map location not yet verified");
wallStop("CRE","Church and Reade","Church Street at Reade Street, Manhattan; map location not yet verified");
// Replace older address-only records where the carrier now supplies a verified
// map target. Stable IDs keep existing favorites intact.
const located=new Map([...documentStops,...transbridgeLocatedStops,...transbridgeAddressStops].map(s=>[s.id,s]));
documentStops.splice(0,documentStops.length,...located.values());

const njNotes=[
  "Uploaded NJ TRANSIT brochure T1890, issued July 11, 2026: local weekday routes 890 (South Main Street) and 891 (Heckman), operated by Delaware River Coach Lines under contract with NJ TRANSIT. Not an intercity or Port Authority service.",
  "Published timepoints only, not every local bus stop. All 16 numbered timepoints are retained in timetables. Only independently located points appear on the map; address-level markers are not boarding-pole coordinates.",
  "Route 891 reference 13 is Lewis Street at Heckman Street toward Pohatcong and Heckman Street at Filmore Street toward Easton.",
  "F: trip may flex approximately 3/4 mile off-route in New Jersey for pickup/drop-off. Arrange with Delaware River Coach at 610-253-0110; deviations can make fixed-route arrivals a few minutes late. Call in advance to arrange the location and any needed return trip.",
  "S: via Belvidere Road; does not flex when school is in session. N: does not flex. No school calendar or unprinted times have been invented.",
  "Brochure cash fares, effective July 1, 2026: one-zone adult $1.90; child 5–11 and senior 62+ $0.85. Transfers: adult $0.85; child/senior $0.40; purchase when boarding. Exact fare required; drivers do not make change. Check NJ TRANSIT for subsequent fare changes.",
  "All trips are lift-equipped according to the brochure. Transit information and lift-equipped bus reservations: 973-275-5555; text telephone 800-772-2287.",
  "Only weekday tables are supplied. Weekend service is not published here. The holiday guide refers riders to NJ TRANSIT for special schedules; unverified holiday service is withheld, not assumed to follow regular weekdays.",
  "Timepoints: "+localNames.map((n,i)=>`${i+1} ${n}`).join(" · "),
];
export const documentRoutes:DocumentRoute[]=[
  ...transbridgeRoutes,
  ...["890","891"].map(name=>({id:`nj-transit:${name}`,name,providerId:"nj-transit",agency:"NJ TRANSIT · Delaware River Coach",type:"bus" as const,
    color:"#e28035",notes:njNotes,sourceUrl:NJT_SOURCE})),
  ...["east","west"].map(dir=>({id:`transbridge:wall-${dir}`,name:`Wall Street ${dir==="east"?"Eastbound":"Westbound"}`,providerId:"transbridge",
    agency:"Trans-Bridge Lines",type:"intercity" as const,color:"#52ad8b",sourceUrl:WALL_SOURCE,notes:[
      "Supplied Wall Street timetable effective July 25, 2025. Runs 401/400 operate weekdays; 407/404 operate Monday–Thursday only. Published schedule, not live data.",
      WALL_CLOSURE,
      "Eastbound Manhattan stops are drop-off only. After Varick & North Moore the PDF marks D without clock times: remaining stops are retained, but no times are guessed.",
      "Westbound William Penn Highway arrival is marked D: discharge only. Confirm the exact street boarding position before travel.",
      "Other holidays are not verified by this upload and are withheld pending an official exception schedule.",
    ]})),
];
const ALL_WEEKDAYS=[1,2,3,4,5];
const parseCompact=(s:string)=>{const h=Math.floor(+s/100),m=+s%100;if(!/^\d{3,4}$/.test(s)||h<1||h>12||m>59)throw new Error("Invalid brochure time");return h%12*60+m;};
function localTrip(direction:"out"|"in",row:string):DocumentTrip {
  const [line,flag,period,...times]=row.split(" ");
  if(times.length!==16)throw new Error(`Brochure row needs 16 columns: ${row}`);
  let previous=-1;
  const points=times.flatMap((t,i)=>{
    if(t==="-")return [];
    let minutes=parseCompact(t)+(period==="p"?720:0);
    while(minutes<previous)minutes+=720;
    if(previous>=0&&minutes-previous>120)throw new Error("Brochure chronology error");
    previous=minutes;
    return [{stopId:`nj-transit:${direction==="out"?16-i:i+1}`,minutes,pickup:true,dropoff:true}];
  });
  if(points.length<2)throw new Error("Missing brochure trip timepoints");
  points.at(-1)!.pickup=false;
  return {id:`nj-transit:${line}:${direction}:${times.find(t=>t!=="-")}:${period}`,routeId:`nj-transit:${line}`,providerId:"nj-transit",number:line,
    direction:direction==="out"?"To Pohatcong":"To Easton",days:ALL_WEEKDAYS,effectiveDate:"2026-07-11",points,
    note:flag==="F"?"F · Flex service in New Jersey; call 610-253-0110.":flag==="S"?"S · Via Belvidere Road; no flex when school is in session.":"N · This trip does not flex."};
}
// Manually transcribed from both raster tables, checked against rendered PDF.
// Each row preserves all sixteen map-reference columns, including blank cells.
const outbound=[
  "891 S a 655 700 702 705 - - - - 710 712 - 714 717 - - -",
  "890 S a 727 - - - - 737 - 741 744 746 - 748 751 755 800 803",
  "891 F a 810 815 817 820 823 - 829 - 839 841 843 - 850 854 859 902",
  "890 F a 857 - - - - 907 - 911 914 916 - - - 922 927 930",
  "891 F a 1013 1018 1020 1023 1026 - 1032 - 1042 1044 1046 - 1053 1057 1102 1105",
  "890 F a 1027 - - - - 1037 - 1041 1044 1046 - - - 1052 1057 1100",
  "890 F a 1157 - - - - 1207 - 1211 1214 1216 - - - 1222 1227 1230",
  "891 F p 1213 1218 1220 1223 1226 - 1232 - 1242 1244 1246 - 1253 1257 102 105",
  "890 F p 127 - - - - 137 - 141 144 146 - - - - - -",
  "891 F p 213 218 220 223 226 - 232 - 242 244 246 - 253 257 302 305",
  "890 S p 225 - - - - 235 - 239 242 244 - 246 249 253 258 301",
  "890 F p 357 - - - - 407 - 411 414 416 - - - 422 427 430",
  "891 F p 413 418 420 423 - - - - 428 430 432 - 439 443 448 451",
  "890 F p 533 - - - - 543 - 547 550 552 - - - 558 603 606",
];
const inbound=[
  "890 S a - - - 655 658 - 700 702 707 711 - - - - - 721",
  "891 S a - - - 725 728 - 730 732 - - - - 738 740 742 748",
  "890 F a 810 813 818 - - - 827 829 834 838 - - - - - 848",
  "891 F a 912 915 920 926 - 932 934 936 - - 947 949 955 957 959 1005",
  "890 F a 940 943 948 - - - 957 959 1004 1008 - - - - - 1018",
  "890 F a 1110 1113 1118 - - - 1127 1129 1134 1138 - - - - - 1148",
  "891 F a 1112 1115 1120 1126 - 1132 1134 1136 - - 1147 1149 1155 1157 1159 1205",
  "890 F p 1240 1243 1248 - - - 1257 1259 104 108 - - - - - 118",
  "891 F p 112 115 120 126 - 132 134 136 - - 147 149 155 157 159 205",
  "890 N p - - - - - - 157 159 204 208 - - - - - 218",
  "890 F p 312 315 320 - - - 329 331 336 340 - - - - - 350",
  "891 S p 314 317 322 328 331 - 333 335 - - - - 341 343 345 351",
  "890 F p 445 448 453 - - - 502 504 509 513 - - - - - 523",
  "891 F p 514 517 522 528 - 534 536 538 - - 544 546 548 - - 554",
  "890 F p 615 618 623 - - - 632 634 639 643 - - - - - 653",
];
function wallTrip(number:string,east:boolean):DocumentTrip {
  const later=number==="407"||number==="404";
  const codes=east?["ABE","WPH","ANN","VAR","BTH","BWA","BCE","BRE","WBR-E","WWA"]:["WBR-W","BRI","TRI","CMU","CRE","ANN","WPH","ABE"];
  const values=east?[270,285,315,380,undefined,undefined,undefined,undefined,undefined,undefined]:
    later?[1005,1009,1012,1015,1018,1110,1140,1160]:[945,949,952,955,958,1035,1065,1085];
  return {id:`transbridge:wall:${number}`,routeId:`transbridge:wall-${east?"east":"west"}`,providerId:"transbridge",number,
    direction:east?"Eastbound to Wall Street":"Westbound from Wall Street",days:later?[1,2,3,4]:ALL_WEEKDAYS,effectiveDate:"2025-07-25",
    points:codes.map((code,i)=>({stopId:`transbridge:${code}`,minutes:values[i]==null?undefined:values[i]!+(east&&later?60:0),
      pickup:east?i<3:i<5,dropoff:east?i>=3:i>=5})),note:east?"Manhattan stops are discharge-only. Clock times after Varick & North Moore are not published.":"Manhattan street boarding; William Penn Highway is discharge-only."};
}
export const documentTrips:DocumentTrip[]=[
  ...transbridgeTrips,
  ...outbound.map(r=>localTrip("out",r)),...inbound.map(r=>localTrip("in",r)),
  wallTrip("401",true),wallTrip("407",true),wallTrip("400",false),wallTrip("404",false),
];
