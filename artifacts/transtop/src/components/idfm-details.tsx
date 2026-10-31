import type { IdfmInfo } from '@workspace/api-client-react';
export function IdfmDetails({info,compact=false}:{info?:IdfmInfo;compact?:boolean}){
  if(!info)return null;
  if(compact)return <p className="mt-2 text-xs text-muted-foreground">Île-de-France Mobilités · Licence Mobilités · {info.modeDetail||"Published schedules"} · {info.timezone}. Open details for source, validity and license links.</p>;
  return <div className={compact?"mt-2 text-xs text-muted-foreground":"space-y-2 rounded-xl border border-white/10 p-4 text-sm text-muted-foreground"} aria-label="Île-de-France Mobilités source">
    <p>Contient des informations des <a href={info.url} target="_blank" rel="noreferrer" className="underline">Horaires prévus Île-de-France Mobilités</a>, mises à disposition sous <a href={info.license} target="_blank" rel="noreferrer" className="underline">Licence Mobilités</a>.</p>
    <p>{info.modeDetail?`${info.modeDetail} · `:""}Published schedules · {info.timezone}. {info.platform?`Platform ${info.platform}. `:""}{!compact&&`Accessibility: ${info.accessibility||"unknown"}. No vehicle positions.`}</p>
    {info.realtimeStatus?<div className="space-y-1 border-t border-white/10 pt-2">
      <p>{info.realtimeStatus}</p>
      <p><a href={info.realtimeUrl} target="_blank" rel="noreferrer" className="underline">PRIM / Île-de-France Mobilités live estimates and terms</a> · {info.realtimeLicense}. Checked {info.realtimeCheckedAt||"not yet"}.</p>
      <p>Live coverage is partial. Live and scheduled rows remain separate without a verified trip match; a service may appear twice. Predictions do not provide map positions.</p>
    </div>:<p>Live availability is checked on stop details; dated timetables remain published schedules.</p>}
    {!compact&&<>
      <p>Source published {info.publishedAt||"unknown"} · service validity {info.validFrom||"unknown"}–{info.validThrough||"unknown"}. Missing geometry and boarding details remain unknown.</p>
      <a href="/api/transit/idfm/method" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center underline">Transformation method and reuse notice</a>
    </>}
  </div>;
}
