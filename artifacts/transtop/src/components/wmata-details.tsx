import { Link } from "wouter";
import type { WmataInfo } from "@workspace/api-client-react";
import { WmataAccess } from "./wmata-access";

export function WmataDetails({info}:{info?:WmataInfo}){
  if(!info)return null;
  return <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="WMATA source and boarding location">
    <h2 className="font-bold">WMATA · {info.kind}</h2>
    {info.platform&&<p className="text-sm">{info.platform}</p>}
    {info.parentId&&<Link className="inline-block min-h-11 py-3 text-sm underline" href={`/stops/${encodeURIComponent(info.parentId)}`}>View parent station</Link>}
    {["entrance","passage","boarding area"].includes(info.kind)&&<p className="text-sm">Station location, not a scheduled boarding platform. Choose a platform below or open the parent station.</p>}
    <p className="text-xs text-muted-foreground">Predictions: {info.predictions||"not checked"}. Alerts: {info.alerts||"not checked"}.</p>
    <p className="text-xs text-muted-foreground">Published times remain scheduled. Empty means the source returned no predictions or advisories; it does not mean no service. Stale or unavailable predictions are withheld. Times use {info.timezone}. Platform accessibility does not certify a step-free journey.</p>
    {!!info.locations?.length&&<details><summary className="cursor-pointer py-2 text-sm font-semibold">Platforms and station locations ({info.locations.length})</summary>
      <ul className="space-y-1">{info.locations.map(location=><li key={location.id}><Link className="block min-h-11 py-2 text-sm underline" href={`/stops/${encodeURIComponent(location.id)}`}>{location.name} · {location.kind}</Link></li>)}</ul>
    </details>}
    {info.access&&<WmataAccess access={info.access}/>}
    <p className="text-xs text-muted-foreground">{info.attribution} <a className="underline" href={info.url} target="_blank" rel="noreferrer">Official WMATA source</a> · <a className="underline" href="https://developer.wmata.com/license" target="_blank" rel="noreferrer">Data terms</a></p>
  </section>;
}
