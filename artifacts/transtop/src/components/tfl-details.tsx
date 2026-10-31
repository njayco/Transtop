import type { TflInfo } from '@workspace/api-client-react';
import { ago, clock } from '@/lib/format';

export function tflErrorDetail(error:unknown) {
  const body=(error as {data?:{error?:unknown}}|undefined)?.data;
  return typeof body?.error==='string'?body.error:"TfL is unavailable. Check the TfL source status in Settings, then retry. Other providers and saved map data remain usable.";
}

export function TflDetails({info}:{info?:TflInfo}) {
  if(!info)return null;
  return <section className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="tfl-source-details">
    <p className="font-semibold text-foreground">{info.attribution} · {info.status}</p>
    <p className="mt-1">{info.message}</p>
    {info.platform&&<p className="mt-1">Boarding point: {info.platform}</p>}
    {info.parentId&&<p>Station relationship: {info.parentId}</p>}
    {info.lastSuccess&&<p className="mt-1">Last successful source request: {clock(info.lastSuccess,info.timezone)} ({ago(info.lastSuccess)}). This is not a prediction observation time.</p>}
    <p className="mt-1">London clocks use GMT/BST. Independent app, not endorsed by TfL. No GPS positions are inferred from predictions.</p>
    <p className="mt-1">Contains public sector information licensed under the Open Government Licence v3.0 (including NaPTAN stops). TfL rail information may include National Rail Darwin / Knowledgebase data.</p>
    <a href="https://tfl.gov.uk/corporate/data-sources" target="_blank" rel="noreferrer" className="mt-1 mr-3 inline-block underline">TfL underlying data sources</a>
    <a href={info.url} target="_blank" rel="noreferrer" className="mt-1 inline-block underline">TfL data terms and credits</a>
  </section>;
}
