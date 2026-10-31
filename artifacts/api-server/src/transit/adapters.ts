import { busRealtimeUrls } from "./bus-time";
import { odptRegistry, catalogUrl, attribution, realtimeUrl } from "./odpt/registry";
import { sourceUrl as wmataUrl, WMATA_CREDIT } from "./wmata/client";

export interface AgencyAdapter {
  mobility?:import("./types").MobilityInfo;
  mobilityRegional?:boolean;
  id:string; name:string; type:"subway"|"bus"|"rail"; staticUrl?:string; realtimeUrls:string[];
  documentation:string; status:string; setup:string;
  staticFeeds?:{id:string;url:string}[];
  staticAgencyIds?:string[];
  staticRouteTypes?:string[];
  routeName?:string;
}
const rt="https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/";
// Allowlist verified against https://www.mta.info/developers and the linked
// official realtime catalog on 2026-10-29. No caller-supplied fetch URLs.
export const adapters:AgencyAdapter[]=[
  {id:"wmata",name:"WMATA Metrobus / Metrorail",type:"subway",staticUrl:wmataUrl("static"),
    staticAgencyIds:["1"],staticRouteTypes:["1","3"],realtimeUrls:[],
    documentation:"https://developer.wmata.com/",status:"access verification required",
    setup:`${WMATA_CREDIT} Direct official combined GTFS, Metrobus and Metrorail predictions and alerts. Server-only WMATA_API_KEY and owner-verified WMATA_VERIFIED_DAILY_LIMIT required. America/New_York; platform identities retained. Predictions are checked on demand, not vehicle GPS. Alerts have independent freshness. GTFS product access does not prove other API entitlements. Terms: https://developer.wmata.com/license . No independent bulk-data API license is implied.`},
  {id:"idfm",name:"Île-de-France Mobilités",type:"rail",staticUrl:"https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip",
    realtimeUrls:[],documentation:"https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/",status:"scheduled only",
    setup:"Contient des informations des Horaires prévus Île-de-France Mobilités, sous Licence Mobilités (https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm/download). Mixed Métro, RER/Transilien/train, tramway, fixed-route bus/coach schedules in Europe/Paris. Optional PRIM predictions on selected stop details use a server-side key; no GPS or bulk polling. Schedules publication 08:00, 13:00, 17:00 Paris time. Funicular and unsupported native types excluded. Public use is blocked until owner resolves required sharing/notification and PRIM license notices; see docs/idfm.md."},
  ...odptRegistry.map(s=>({id:s.id,name:s.name,type:s.type,staticUrl:catalogUrl(s),realtimeUrls:s.realtime.map(k=>realtimeUrl(s,k)),
    documentation:catalogUrl(s),status:"scheduled only",setup:`${attribution(s)} ${s.type==="rail"?"Tram / streetcar (GTFS route_type 0), not subway or commuter rail.":"Fixed-route buses."} GTFS/GTFS-JP, Asia/Tokyo. Initial selected ODPT coverage only; no national or Tokyo Metro/JR claim. Realtime only where fresh exact static matches are verified. Sendai has no supplied route shapes. License: https://creativecommons.org/licenses/by/4.0/ Credits: https://developer.odpt.org/en/faq-info#cc-by-credit`})),
  {id:"amtrak",name:"Amtrak",type:"rail",staticUrl:"https://content.amtrak.com/content/gtfs/GTFS.zip",
    staticAgencyIds:["51"],staticRouteTypes:["2"],realtimeUrls:[],
    documentation:"https://github.com/piemadd/amtrak",status:"scheduled only",
    setup:"Published Amtrak agency 51 rail schedules. Tracking supplied by Amtraker (unofficial), upstream Amtrak observations, under ODC-By 1.0; no affiliation or uninterrupted access guarantee. Only fresh source timestamps qualify as live. Thruway buses, charters, MARC, VIA-only services and Shore Line East are excluded. Shared-operator route portions owned by other agencies (including the VIA portion of Maple Leaf) are not included. Missing tracking or ambiguous trip matches remain scheduled/unresolved. https://amtraker.com"},
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
  {id:"cttransit",name:"CTtransit / CTfastrak",type:"bus",
    staticUrl:"https://www.cttransit.com/sites/default/files/gtfs/googlect_transit.zip",
    realtimeUrls:["TripUpdate/TripUpdates","Vehicle/VehiclePositions","Alert/Alerts"].map(p=>`https://cttprdtmgtfs.ctttrpcloud.com/TMGTFSRealTimeWebService/${p}.pb`),
    documentation:"https://www.cttransit.com/about/developers",status:"configured",
    setup:"Official CTtransit schedules for Hartford, New Haven, Stamford, New Britain, Waterbury and Meriden, including CTfastrak and published express services. Public trip updates, vehicle positions and alerts need no API key; only fresh observations are labeled live. Data as-is; no agency affiliation. Data license: https://www.cttransit.com/about/developers/terms-of-use"},
  {id:"ctrail-hartford",name:"CTrail Hartford Line",type:"rail",staticUrl:"https://ctrides.com/hlgtfs.zip",
    realtimeUrls:[],documentation:"https://www.cttransit.com/about/developers",status:"scheduled only",
    setup:"Official linked Hartford Line GTFS: New Haven–Hartford–Springfield. Published calendars, stops and route shapes; no verified public rail realtime feed configured. Metro-North New Haven service remains separately provided by Metro-North."},
  {id:"ctrail-sle",name:"CTrail Shore Line East",type:"rail",staticUrl:"https://content.amtrak.com/content/gtfs/GTFS.zip",
    staticAgencyIds:["1230"],routeName:"Shore Line East",realtimeUrls:[],
    documentation:"https://www.cttransit.com/about/developers",status:"scheduled only",
    setup:"CTtransit's official Shore Line East download links to a shared Amtrak GTFS archive. Only the Shore Line East operator (agency 1230) and its referenced data are imported; national Amtrak services are excluded. Current trips do not reference shape geometry: stations and timetables are available, not a fabricated route line. Published schedules, not live rail predictions. Check https://shorelineeast.com/schedules for service changes."},
  {id:"private-commuter",name:"Private commuter operators",type:"bus",realtimeUrls:[],documentation:"https://www.hamptonjitney.com/",status:"coverage gap",
    setup:"Hampton Jitney, Hampton Luxury Liner, and other private commuter services are not in this catalog: no current authorized bulk feed verified. Check each operator's official timetable. Google may return some services but does not guarantee coverage."},
];
export const alertUrl=rt+"camsys%2Fall-alerts";
export function adapter(id:string) { const a=adapters.find(a=>a.id===id); if(!a)throw new Error("Unknown agency"); return a; }
