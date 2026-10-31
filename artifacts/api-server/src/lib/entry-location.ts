import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Reader, type CityResponse } from "mmdb-lib";
import { publicAddress } from "./entry-country";

export const entryThemes = ["default","new-york","new-jersey","connecticut","san-francisco","philadelphia","dallas","miami","atlanta","detroit","cincinnati","chicago","los-angeles"] as const;
export type EntryTheme = typeof entryThemes[number];
export type EntryLocation = {
  country:string|null; city:string|null; region:string|null;
  theme:EntryTheme; operator:string|null; accuracy:"approximate"|"unknown";
  matchedBy:"city"|"region"|"country"|"default"; source:"db-ip-lite";
};
export const unknownLocation = ():EntryLocation => ({country:null,city:null,region:null,theme:"default",operator:null,accuracy:"unknown",matchedBy:"default",source:"db-ip-lite"});
type CityRecord = {
  country?:{iso_code?:string}; city?:{names?:{en?:string}};
  subdivisions?:{iso_code?:string;names?:{en?:string}}[];
};
type CityReader = {get(address:string):CityRecord|null};
const clean = (value:unknown) => typeof value==="string" && value.trim() && !/[\u0000-\u001f\u007f<>]/.test(value) ? value.trim().slice(0,100) : null;
const key = (s:string|null) => (s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const cities:Record<string,{state:string;theme:EntryTheme;operator:string;name:string}> = {
  "san francisco":{state:"CA",theme:"san-francisco",operator:"SFMTA Muni · BART · Caltrain",name:"San Francisco"},
  philadelphia:{state:"PA",theme:"philadelphia",operator:"SEPTA · PATCO",name:"Philadelphia"},
  dallas:{state:"TX",theme:"dallas",operator:"DART · Trinity Railway Express",name:"Dallas"},
  miami:{state:"FL",theme:"miami",operator:"Miami-Dade Transit",name:"Miami"},
  atlanta:{state:"GA",theme:"atlanta",operator:"MARTA",name:"Atlanta"},
  detroit:{state:"MI",theme:"detroit",operator:"DDOT · SMART",name:"Detroit"},
  cincinnati:{state:"OH",theme:"cincinnati",operator:"Metro · Connector · TANK",name:"Cincinnati"},
  chicago:{state:"IL",theme:"chicago",operator:"CTA · Metra · Pace",name:"Chicago"},
  "los angeles":{state:"CA",theme:"los-angeles",operator:"LA Metro · Metrolink",name:"Los Angeles"},
};
const stateNames:Record<string,string> = {"california":"CA","pennsylvania":"PA","texas":"TX","florida":"FL","georgia":"GA","michigan":"MI","ohio":"OH","illinois":"IL","new york":"NY","new jersey":"NJ","connecticut":"CT","massachusetts":"MA","washington":"WA","district of columbia":"DC","colorado":"CO","oregon":"OR","maryland":"MD"};
const defaultOperators:Record<string,string> = {
  "MA:boston":"MBTA","WA:seattle":"King County Metro · Sound Transit","DC:washington":"WMATA",
  "TX:austin":"CapMetro","TX:houston":"METRO","CO:denver":"RTD","OR:portland":"TriMet",
  "MD:baltimore":"Maryland Transit Administration","CA:san diego":"MTS","CA:sacramento":"SacRT",
};
/** Approximate database municipality only. This is NOT a municipal-boundary or GPS test. */
export function locationFromRecord(record:CityRecord|null|undefined):EntryLocation {
  if(!record)return unknownLocation();
  const country=typeof record.country?.iso_code==="string"&&/^[A-Z]{2}$/.test(record.country.iso_code)?record.country.iso_code:null;
  const city=clean(record.city?.names?.en),region=clean(record.subdivisions?.[0]?.names?.en);
  if(!country)return unknownLocation();
  const result:EntryLocation={country,city,region,theme:"default",operator:null,accuracy:"approximate",matchedBy:"country",source:"db-ip-lite"};
  if(country!=="US")return {...result,matchedBy:city?"city":"country"};
  const rawState=record.subdivisions?.[0]?.iso_code;
  const state=typeof rawState==="string"&&/^[A-Z]{2}$/.test(rawState)?rawState:stateNames[key(region)];
  if(state==="NJ")return {...result,region:"New Jersey",theme:"new-jersey",operator:"NJ TRANSIT · PATH",matchedBy:"region"};
  if(state==="CT")return {...result,region:"Connecticut",theme:"connecticut",operator:"CTtransit · CTrail · Metro-North",matchedBy:"region"};
  const cityKey=key(city);
  if(state==="NY"&&["new york","new york city","manhattan","brooklyn","queens","bronx","the bronx","staten island"].includes(cityKey))
    return {...result,city:"New York City",theme:"new-york",operator:"MTA · New York City Transit",matchedBy:"city"};
  const named=cities[cityKey];
  if(named&&state===named.state)return {...result,city:named.name,theme:named.theme,operator:named.operator,matchedBy:"city"};
  return {...result,operator:defaultOperators[`${state}:${cityKey}`]||null,matchedBy:city?"city":"country"};
}
export const cityDatabasePath=fileURLToPath(new URL("../../dist/geo/city.mmdb",import.meta.url));
export async function loadCityReader(path:string):Promise<CityReader|null>{
  try{return new Reader<CityResponse>(await readFile(path));}catch{return null;}
}
export function createLocationLookup(reader:Promise<CityReader|null>){
  return async(address:string|null):Promise<EntryLocation>=>{
    // No per-address cache, persistence, logging, outgoing request or coordinates in response.
    if(!address||!publicAddress(address))return unknownLocation();
    try{return locationFromRecord((await reader)?.get(address));}catch{return unknownLocation();}
  };
}
export const lookupEntryLocation=createLocationLookup(loadCityReader(
  import.meta.url.endsWith("/dist/index.mjs")?fileURLToPath(new URL("./geo/city.mmdb",import.meta.url)):cityDatabasePath
));
