import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Search as SearchIcon, ArrowUpRight } from 'lucide-react';
import { getGetCatalogQueryKey, useGetCatalog, useGetSources, useGetIntercityProviders, getGetIntercityProvidersQueryKey, type GetCatalogParams, type GetCatalogServiceClass } from '@workspace/api-client-react';
import { MobileTop } from '@/components/shell';
import { ErrorState, ModeIcon, RouteBadge, SkeletonCards, StopCard, MODE_NAME } from '@/components/transit';
import { Pager, apiErrorText } from '@/components/timetable';
import { INTERCITY_LABEL, providerStatus } from '@/components/intercity';
import { usePrefs } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { GlobalCoverageNotice } from '@/components/global-coverage';

const SUGGEST = ['Times Square', 'Grand Central', 'Penn Station', 'Jamaica', 'M15', 'Port Washington', 'n6'];
const TYPES = [{ v: '', l: 'All modes' }, { v: 'subway', l: 'Subway' }, { v: 'bus', l: 'Bus' }, { v: 'rail', l: 'Commuter Rail' }, { v: 'intercity', l: 'Intercity Bus Network' }];
const CLASSES: { v: GetCatalogServiceClass; l: string }[] = [{ v: 'all', l: 'Local + express' }, { v: 'local', l: 'Local' }, { v: 'express', l: 'Express' }];
const LIMIT = 20;

export default function SearchPage() {
  const { mode } = usePrefs();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [agency, setAgency] = useState('');
  const [type, setType] = useState('');
  const [serviceClass, setServiceClass] = useState<GetCatalogServiceClass>('all');
  const [offset, setOffset] = useState(0);
  const [cursor,setCursor]=useState('');
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setQ(text.trim()); setOffset(0); }, 300);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [text]);
  useEffect(() => {setOffset(0);setCursor('');}, [agency, type, serviceClass, mode,q]);

  const sources = useGetSources();
  const intercity = useGetIntercityProviders({ query: { queryKey: getGetIntercityProvidersQueryKey(), enabled: type === 'intercity' || type === '', staleTime: 300_000 } });
  const gaps = (intercity.data ?? []).filter((p) => providerStatus(p.status).k !== 'imported');
  const pickType = (t: string) => { setType(t); if (agency && t && !(sources.data ?? []).some((s) => s.id === agency && s.type === t)) setAgency(''); if (t === 'intercity') setServiceClass('all'); };
  const params: GetCatalogParams = { mode, offset, limit: LIMIT, serviceClass,...(cursor?{cursor}:{}), ...(q ? { q } : {}), ...(agency ? { agency } : {}), ...(type ? { type } : {}) };
  const res = useGetCatalog(params, { query: { queryKey: getGetCatalogQueryKey(params), placeholderData: (p) => p, retry: 1 } });
  const d = res.data;
  const agencies=useMemo(()=>{
    const all=new Map((sources.data??[]).filter(s=>(type?[type]:['subway','bus','rail','intercity']).includes(s.type||'')).map(s=>[s.id,{id:s.id,agency:s.agency}]));
    for(const r of [...(d?.routes||[]),...(d?.stops||[]).flatMap(s=>s.routes)])if(r.transitland&&r.agencyId)all.set(r.agencyId,{id:r.agencyId,agency:r.agency});
    if(agency&&!all.has(agency))all.set(agency,{id:agency,agency:"Selected provider · no matches on this page"});
    return [...all.values()].sort((a,b)=>a.agency.localeCompare(b.agency));
  },[sources.data,d,type,agency]);
  const total = Math.max(d?.totalRoutes ?? 0, d?.totalStops ?? 0);
  const sel = 'h-11 rounded-xl border border-input bg-card px-3 text-sm';

  return (
    <div className="mx-auto max-w-4xl">
      <MobileTop />
      <div className="space-y-6 p-4 md:p-8">
        <h1 className="font-display text-4xl md:text-6xl">Where to?</h1>
        <p className="text-sm text-muted-foreground">Browse published routes, stop locations and dated timetables. <Link href="/settings" className="underline">Check agency coverage</Link>.</p>
        <p className="text-xs text-muted-foreground">Worldwide stop/route searches are sent to Transitland. For a city, country or address, use Nearby place search, then explore its map. <Link href="/" className="underline">Open Nearby</Link>.</p>
          <>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={180} type="search" aria-label="Search stations, stops and routes" data-testid="input-search"
                placeholder="Stations, stops, routes" className="h-16 w-full rounded-2xl border border-input bg-card pl-14 pr-4 text-lg placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={agency} onChange={(e) => setAgency(e.target.value)} aria-label="Agency" data-testid="select-catalog-agency" className={sel}>
                <option value="">All agencies</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.agency}</option>)}
              </select>
              <select value={type} onChange={(e) => pickType(e.target.value)} aria-label="Mode" data-testid="select-catalog-type" className={sel}>
                {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <select value={serviceClass} onChange={(e) => setServiceClass(e.target.value as GetCatalogServiceClass)} aria-label="Service class" data-testid="select-catalog-class" className={sel}>
                {CLASSES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
            {type === 'intercity' && gaps.length > 0 && (
              <details className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm" data-testid="details-search-intercity-gaps">
                <summary className="cursor-pointer font-semibold">{INTERCITY_LABEL}: {gaps.length} provider{gaps.length > 1 ? 's' : ''} without imported times</summary>
                <p className="mt-1 text-xs text-muted-foreground">Their routes and stops will not appear in results. Use the official schedules.</p>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{gaps.map((p) => { const st = providerStatus(p.status); return <li key={p.id} className="flex items-center justify-between gap-2"><span>{p.name} <span className={cn('text-xs font-bold', st.c)}>{st.l}</span></span>{p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-xs underline">Schedule</a>}</li>; })}</ul>
              </details>
            )}
            {!q && (
              <div className="flex flex-wrap gap-2">
                {SUGGEST.map((s) => <button key={s} onClick={() => setText(s)} className="h-10 rounded-full border border-border px-4 text-sm font-semibold hover:border-white/40" data-testid={`button-suggest-${s}`}>{s}</button>)}
              </div>
            )}
            {res.isLoading && <SkeletonCards n={3} />}
            {res.isError && <ErrorState title="Catalog unavailable" detail={apiErrorText(res.error, 'Check Settings for feed status.')} onRetry={() => res.refetch()} />}
            {d && (
              <div className={cn('space-y-6 transition-opacity', res.isFetching && 'opacity-60')}>
                <GlobalCoverageNotice data={d.globalCoverage} onNext={c=>{setCursor(c);setOffset(0);}} onReset={cursor?()=>{setCursor('');setOffset(0);}:undefined} />
                <section>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground" data-testid="text-total-routes">Routes · {d.totalRoutes.toLocaleString()}</h2>
                  {d.routes.length === 0 ? <p className="text-sm text-muted-foreground">{offset > 0 && d.totalRoutes > 0 ? 'No more routes on this page.' : 'No routes match these filters.'}</p> : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {d.routes.map((r) => (
                        <Link key={r.id} href={`/routes/${encodeURIComponent(r.id)}`} data-testid={`link-route-${r.id}`} className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-3 hover:border-white/25">
                          <RouteBadge name={r.name} color={r.color} size="lg" />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold">{r.name} {MODE_NAME[r.type]}{r.serviceClass === 'express' && <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-primary">Express</span>}</p>
                            <p className="truncate text-sm text-muted-foreground">{r.longName ? `${r.longName} · ` : ''}{r.agency}</p>
                          </div>
                          <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground" data-testid="text-total-stops">Stations and stops · {d.totalStops.toLocaleString()}</h2>
                  {d.stops.length === 0
                    ? <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-6"><ModeIcon type="bus" size={36} /><p className="text-muted-foreground">{q ? `No stops match "${q}".` : 'No stops on this page.'} Try a station name, a route like "M15", or clear a filter.</p></div>
                    : <div className="space-y-3">{d.stops.map((s, i) => <StopCard key={s.id} stop={s} index={i} />)}</div>}
                </section>
                {total > LIMIT && <div className="rounded-2xl border border-card-border bg-card"><Pager offset={offset} limit={LIMIT} total={total} onChange={(o) => { setOffset(o); window.scrollTo({ top: 0 }); }} label="results" /></div>}
              </div>
            )}
          </>
      </div>
    </div>
  );
}
