export interface AgencyAdapter {
  id:string; name:string; type:"subway"|"bus"|"rail"; staticUrl?:string; realtimeUrls:string[];
  documentation:string; status:string; setup:string;
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
    realtimeUrls:[],documentation:"https://bustime.mta.info/wiki/Developers/Index",status:"awaiting credentials",
    setup:"Integration not configured. MTA Bus Time requires an authorized API key and a SIRI/GTFS-RT adapter. Manhattan static GTFS is supported by the importer; other boroughs await adapter configuration."},
  {id:"nice",name:"NICE Bus",type:"bus",realtimeUrls:[],documentation:"https://www.nicebus.com/",status:"unsupported",
    setup:"Planned coverage. No permitted documented live feed verified for this build; no live NICE arrivals are shown."},
];
export const alertUrl=rt+"camsys%2Fall-alerts";
export function adapter(id:string) { const a=adapters.find(a=>a.id===id); if(!a)throw new Error("Unknown agency"); return a; }
