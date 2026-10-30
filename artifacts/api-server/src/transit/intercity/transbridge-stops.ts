import type { PublishedStop } from "./uploaded-data";

const SOURCE="https://transbridgelines.com/schedules-stops/bus-stops";
function point(code:string,name:string,address:string,lat:number,lon:number,precision="operator-linked place; confirm the designated boarding area"):PublishedStop {
  return {id:`transbridge:${code}`,name,lat,lon,address:`${address}. Map: ${precision}. Location source: ${SOURCE}`};
}
// Coordinates with !3d/!4d come from the carrier's own linked place targets.
// Links containing only @ coordinates are marked as map areas, never stop poles.
export const transbridgeLocatedStops:PublishedStop[]=[
  point("NY","New York · Port Authority Bus Terminal (PABT)","625 8th Avenue, 41st Street, NYC. Departures: lower level, South Wing, published gates 2/4/6; confirm today's gate. Cash fares not available at PABT",40.7568858,-73.9910078),
  point("ATC","Allentown Transportation Center","603 Linden Street, Allentown, PA · Platform C",40.6041606,-75.4708817),
  point("BTC","Bethlehem Transportation Center","635 Guetter Street, Bethlehem, PA",40.6232824,-75.3806705),
  point("ABE","Lehigh Valley International Airport (ABE)","3311 Airport Road, Allentown, PA · Intermodal pickup; follow carrier's pickup-area map, not an airport road geocoder",40.651834,-75.441415),
  point("WPH","William Penn Highway Park & Ride","Route 33 & Emrick Boulevard off-ramp shelters. Pickup/drop-off may be in front of or behind the ramp shelters. NOT the park-and-ride entrance shelters across from Outback",40.667847,-75.294886,"operator map area, not the shelter or entrance"),
  point("EAS","Easton Intermodal Transportation Center","123 S 3rd Street, Suite 200, Easton, PA",40.689163,-75.2092504),
  point("CLI","Clinton Park & Ride","Route 31 & Center Street, Clinton, NJ",40.6392178,-74.8938984),
  point("ANN","Annandale Square","Beaver Avenue at Old Allerton Road, Clinton, NJ · separate stop approximately one mile from Clinton Park & Ride",40.6405204,-74.8833887,"carrier-linked intersection"),
  point("WES","Wescosville Park & Ride","Schuler Street off Hamilton Boulevard, east of the Charcoal Drive-In, Wescosville, PA",40.5699371,-75.5433452),
  point("HEL","Hellertown Park & Ride","Silvex Road off Main Street, near I-78, Hellertown, PA",40.598301,-75.34127),
  point("EWR","Newark Airport (EWR) · all terminals","Terminal A: lower-level roadway, Bus Zone 16; published time is Terminal A. B is two minutes after A and C four minutes after A, per carrier instructions. B/C: lower-level roadway, Trans-Bridge signs. This shared airport pin is NOT an individual terminal's boarding zone",40.6895304,-74.1744626,"carrier-linked airport orientation only; follow terminal-specific signs"),
  point("QUA","Quakertown · 60 4th Street","Posted Trans-Bridge stop outside Bucks County Transportation Office parking lot, 60 4th Street, Quakertown, PA",40.4423151,-75.3392324),
  point("BRA","Branchburg Municipal Park & Ride","US 202 North, approximately 1.5 miles north of the municipal complex at 1077 US 202. Do not use the municipal complex itself as the stop. Parking permit required",40.567986,-74.681282),
  point("LAM","Lambertville · Bridge Street","Bus shelter near Exxon, 83 Bridge Street, Lambertville, NJ",40.3660101,-74.9424031),
  point("LAH","Lahaska · Peddler's Village","Peddler's Village at Street Road, Lahaska, PA · confirm the designated bus shelter",40.3470512,-75.0341856,"carrier-linked map search area, not an exact boarding pole"),
  point("NHO","New Hope · Logan Square","Bus shelter in Logan Square Shopping Center near The UPS Store, US 202/Lower York Road, approximately two miles from downtown New Hope",40.357323,-74.976715,"carrier-linked map area, not an exact boarding pole"),
];

// These are supplied separately from the carrier map links because the carrier's
// Flemington map still links to 81 NJ-12, not the current 80 Park Avenue location.
export const transbridgeAddressStops:PublishedStop[]=[
  {id:"transbridge:DOY",name:"Doylestown · SEPTA station bus shelter",lat:40.306967382307,lon:-75.13046693438,
    address:"130 S Clinton Avenue, Doylestown, PA · shelter in front of SEPTA station. Carrier address; Census Public_AR_Current address-level coordinates verified 2026-10-30, not an exact boarding pole. Source: "+SOURCE},
  {id:"transbridge:FLE",name:"Flemington · 80 Park Avenue",lat:40.51365591579,lon:-74.861464217167,
    address:"Temporary relocation: Hunterdon County Link Bus Transfer Center, 80 Park Avenue, Flemington, NJ. Do NOT use the older 81 NJ-12 map link. Census Public_AR_Current address-level coordinates verified 2026-10-30; not an exact boarding pole. Source: "+SOURCE},
  {id:"transbridge:WC",name:"Wind Creek Bethlehem",lat:40.6152097,lon:-75.3592084,
    address:"Designated bus lanes in the Wind Creek Bethlehem parking garage, 77 Wind Creek Boulevard. Map is casino-building orientation, NOT the garage boarding lane. Location: https://www.openstreetmap.org/way/134584342 · © OpenStreetMap contributors, ODbL. Boarding source: https://transbridgelines.com/schedules-stops/wind-creek-bethlehem-casino"},
  {id:"transbridge:CRU",name:"Manhattan Cruise Terminal · reservation only",lat:40.7677234,lon:-73.9990239,
    address:"Reservation required with Trans-Bridge at 610-868-6001. No departure/arrival clock time is printed for R cells; do not assume walk-up service. Map is terminal-complex orientation, NOT a particular pier or boarding lane. Location: https://www.openstreetmap.org/way/495267270 · © OpenStreetMap contributors, ODbL. Service source: https://transbridgelines.com/schedules-stops/pier-transportation"},
];
