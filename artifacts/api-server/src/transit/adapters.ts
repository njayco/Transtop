import { busRealtimeUrls } from "./bus-time";

export interface AgencyAdapter {
  id:string; name:string; type:"subway"|"bus"|"rail"; staticUrl?:string; realtimeUrls:string[];
  documentation:string; status:string; setup:string;
  staticFeeds?:{id:string;url:string}[];
}
const rt="https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/";
// Allowlist verified against https://www.mta.info/developers and the linked
// official realtime catalog on 2026-10-29. No caller-supplied fetch URLs.
export const adapters:AgencyAdapter[]=[
  {id:"mta-subway",name:"MTA New York City Transit",type:"subway",staticUrl:"https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip",
    realtimeUrls:["gtfs","gtfs-ace","gtfs-bdfm","gtfs-g","gtfs-jz","gtfs-l","gtfs-nqrw","gtfs-si"].map(f=>rt+"nyct%2F"+f),
    documentation:"https://www.mta.info/developers",status:"configured",setup:"Public GTFS and GTFS-Realtime, no API key required. Data downloaded and redistributed by Transtop. Subway predictions do not imply GPS vehicle positions."},
  {id:"mta-lirr",name:"Long Island Rail Road",type:"rail",staticUrl:"https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip",
    realtimeUrls:[rt+"lirr%2Fgtfs-lirr"],documentation:"https://www.mta.info/developers",status:"configured",setup:"Public GTFS and GTFS-Realtime. No API key required. Initial import enables coverage."},
  {id:"mta-mnr",name:"Metro-North Railroad",type:"rail",staticUrl:"https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip",
    realtimeUrls:[rt+"mnr%2Fgtfs-mnr"],documentation:"https://www.mta.info/developers",status:"configured",setup:"Public GTFS and GTFS-Realtime. Port Jervis / Pascack Valley require NJ TRANSIT and are not included."},
  {id:"mta-bus",name:"MTA Bus",type:"bus",staticUrl:"https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip",
    staticFeeds:["m","bx","b","q","si","busco"].map(id=>({id,url:`https://rrgtfsfeeds.s3.amazonaws.com/gtfs_${id}.zip`})),
    realtimeUrls:busRealtimeUrls,documentation:"https://bustime.mta.info/wiki/Developers/GTFSRt",status:"configured",
    setup:"All five boroughs and MTA Bus Company, including express buses. Published schedules plus official MTA Bus Time predictions, vehicle locations and service alerts when fresh. Live coverage depends on buses reporting; missing or stale data falls back to clearly labeled published schedules. Requires the server-only MTA_BUS_TIME_API_KEY."},
  {id:"nice",name:"NICE Bus",type:"bus",staticUrl:"https://www.nicebus.com/NICE/media/nicebus-gtfs/NICE_GTFS.zip",realtimeUrls:[],
    documentation:"https://www.nicebus.com/Passenger-Information/App-showcase",status:"scheduled only",
    setup:"Official NICE GTFS published for app developers. Includes Nassau local and express service. Published schedules, not live bus predictions."},
  {id:"suffolk",name:"Suffolk County Transit",type:"bus",staticUrl:"https://suffolkcountyny.gov/Portals/0/formsdocs/publicworks/Zip/google_transit.zip",realtimeUrls:[],
    documentation:"https://suffolkcountyny.gov/Departments/Public-Works/Transportation/General-Transit-Feed-Specification-Details",status:"scheduled only",
    setup:"Official fixed-route schedules. Realtime API requires agency approval; demand-response zones are not fixed-route timetables."},
  {id:"hart",name:"Huntington HART",type:"bus",staticUrl:"https://s3.amazonaws.com/datatools-511ny/public/HART_Huntington_Area_Rapid_Transit.zip",realtimeUrls:[],
    documentation:"https://www.huntingtonny.gov/hart",status:"scheduled only",setup:"HART schedules distributed through NYSDOT 511NY, under NY open-data terms: https://data.ny.gov/download/77gx-ii52/application/pdf . No live predictions."},
  {id:"long-beach",name:"City of Long Beach",type:"bus",staticUrl:"https://s3.amazonaws.com/datatools-511ny/public/City_of_Long_Beach.zip",realtimeUrls:[],
    documentation:"https://www.longbeachny.gov/transportation",status:"scheduled only",setup:"NYSDOT 511NY public GTFS, under NY open-data terms: https://data.ny.gov/download/77gx-ii52/application/pdf . Check service dates for seasonal routes."},
  {id:"glen-cove",name:"Glen Cove Loop Bus",type:"bus",staticUrl:"https://s3.amazonaws.com/datatools-511ny/public/City_Of_Glen_Cove.zip",realtimeUrls:[],
    documentation:"https://glencoveny.gov/",status:"scheduled only",setup:"Municipal fixed-route schedules distributed through NYSDOT 511NY under NY open-data terms. No live predictions."},
  {id:"hudson-link",name:"Hudson Rail Link",type:"bus",staticUrl:"https://s3.amazonaws.com/datatools-511ny/public/Hudson_Rail_Link.zip",realtimeUrls:[],
    documentation:"https://www.mta.info/schedules",status:"scheduled only",setup:"Bronx commuter feeder buses to Metro-North stations. NYSDOT 511NY public GTFS under NY open-data terms."},
  {id:"airtrain-jfk",name:"JFK AirTrain",type:"rail",staticUrl:"https://s3.amazonaws.com/datatools-511ny/public/AirTrain_JFK.zip",realtimeUrls:[],
    documentation:"https://www.jfkairport.com/to-from-airport/air-train",status:"scheduled only",setup:"Airport rail connections in Queens, distributed through NYSDOT 511NY under NY open-data terms. Timetable departures are published estimates, not live vehicle predictions."},
  {id:"private-commuter",name:"Private commuter operators",type:"bus",realtimeUrls:[],documentation:"https://www.hamptonjitney.com/",status:"coverage gap",
    setup:"Hampton Jitney, Hampton Luxury Liner, and other private commuter services are not in this catalog: no current authorized bulk feed verified. Check each operator's official timetable. Google may return some services but does not guarantee coverage."},
];
export const alertUrl=rt+"camsys%2Fall-alerts";
export function adapter(id:string) { const a=adapters.find(a=>a.id===id); if(!a)throw new Error("Unknown agency"); return a; }
