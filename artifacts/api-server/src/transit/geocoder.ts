// US Census public Geocoding Services API, verified against its official
// Geocoding_Services_API.html documentation. Only complete numbered addresses
// are sent; station/neighborhood search stays local.
const cache=new Map<string,{at:number;point:{lat:number;lon:number}|null}>();
let nextRequest=0;
export async function geocodeAddress(q:string) {
  if(!/^\d+\s+\S/.test(q))return null;
  const cached=cache.get(q);
  if(cached&&Date.now()-cached.at<15*60000)return cached.point;
  if(Date.now()<nextRequest)throw new Error("Address search is busy. Please retry in a moment.");
  nextRequest=Date.now()+1000;
  const address=/\b(ny|new york|\d{5})\b/i.test(q)?q:`${q}, New York, NY`;
  const url=new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.search=new URLSearchParams({address,benchmark:"Public_AR_Current",format:"json"}).toString();
  const response=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:"error"});
  if(!response.ok)throw new Error("Address search is unavailable; search for a station or neighborhood instead.");
  const data=await response.json() as any;
  const coordinates=data.result?.addressMatches?.[0]?.coordinates;
  const point=coordinates&&Number.isFinite(coordinates.x)&&Number.isFinite(coordinates.y)?{lat:coordinates.y,lon:coordinates.x}:null;
  if(cache.size>=1000)cache.clear();
  cache.set(q,{at:Date.now(),point});
  return point;
}
