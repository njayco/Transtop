/** Photon permits reasonable project use; no account, paid service or Google API enablement.
 * Debounce in the UI, at most one new lookup/second here, no persisted search text.
 */
let last = 0;
const cache = new Map<string,{at:number;point:{lat:number;lon:number;label:string}|null}>();
export async function globalPlace(q: string) {
  const coordinate = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordinate && Math.abs(+coordinate[1]) <= 90 && Math.abs(+coordinate[2]) <= 180) return {
    lat: +coordinate[1], lon: +coordinate[2], label: q.trim() };
  if (q.length < 3) return null;
  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < 300000) return cached.point;
  if (Date.now() - last < 1000) return null;
  last = Date.now();
  try {
    const url = new URL("https://photon.komoot.io/api/"); url.searchParams.set("q",q.slice(0,180)); url.searchParams.set("limit","1");
    const res = await fetch(url,{ redirect: "error", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Transtop transit place lookup" } });
    if (!res.ok) return null;
    const text = await res.text(); if (text.length > 100000) return null;
    const item = JSON.parse(text).features?.[0], xy = item?.geometry?.coordinates;
    const point = Array.isArray(xy) && Number.isFinite(xy[0]) && Number.isFinite(xy[1]) && Math.abs(xy[0]) <= 180 && Math.abs(xy[1]) <= 90 ?
      { lat: xy[1], lon: xy[0], label: [item.properties?.name,item.properties?.city,item.properties?.country].filter(Boolean).join(", ") } : null;
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(q,{at:Date.now(),point}); return point;
  } catch { return null; }
}
