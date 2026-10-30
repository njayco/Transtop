import type { GlobalCoverage, TransitlandInfo } from '@workspace/api-client-react';

export function GlobalCoverageNotice({ data, onNext, onReset,credits=[] }: { data?: GlobalCoverage; onNext?: (cursor:string)=>void; onReset?:()=>void;credits?:(string|undefined)[] }) {
  if (!data) return null;
  return <div className="space-y-2 rounded-xl border border-border bg-card/60 p-3 text-xs text-muted-foreground" role="status" data-testid="global-coverage">
    <p><a href="https://www.transit.land/terms" target="_blank" rel="noreferrer" className="font-semibold underline">Transitland</a> · {data.status} · {data.used ?? 0} / {data.limit ?? 0} app requests this UTC month</p>
    <p>{data.message}</p>
    {credits.some(Boolean)&&<p>Source credits: {[...new Set(credits.filter(Boolean))].join(' · ')}</p>}
    {data.hasMore && <p>Partial source page. More stops/routes may exist; narrow the area or advance the source page.</p>}
    <div className="flex flex-wrap gap-2">
      {data.cursor && onNext && <button onClick={()=>onNext(data.cursor!)} className="min-h-10 rounded-full border border-border px-3 font-semibold text-foreground">Next Transitland page</button>}
      {onReset && <button onClick={onReset} className="min-h-10 rounded-full border border-border px-3 font-semibold text-foreground">First source page</button>}
    </div>
  </div>;
}
export function TransitlandDetails({ info }: { info?:TransitlandInfo }) {
  if (!info) return null;
  return <section className="space-y-1 rounded-xl border border-border p-3 text-xs text-muted-foreground" aria-label="Transitland source details">
    <p><a href="https://www.transit.land/terms" className="font-bold underline" target="_blank" rel="noreferrer">Transitland</a> · {info.attribution} · {info.license}</p>
    <p>Source snapshot: {info.fetchedAt ? new Date(info.fetchedAt).toLocaleDateString() : 'unknown'} · {info.timezone || 'Timezone not supplied'}</p>
    {info.modeDetail && <p>{info.modeDetail}</p>}
    {(info.platform || info.parentStation) && <p>{info.parentStation}{info.platform ? ` · Platform ${info.platform}` : ''}</p>}
    {info.accessibility && <p>{info.accessibility}</p>}
    {info.notes?.map((n,i)=><p key={i}>{n}</p>)}
    <a href={info.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center underline">Source feed and reuse terms</a>
  </section>;
}
