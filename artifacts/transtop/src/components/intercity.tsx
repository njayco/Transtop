import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, CalendarClock, Route as RouteIcon } from 'lucide-react';
import { getGetIntercityDeparturesQueryKey, useGetIntercityDepartures, type GetIntercityDeparturesParams, type IntercityDeparture, type IntercityProvider } from '@workspace/api-client-react';
import { ago, clock } from '@/lib/format';
import { cn } from '@/lib/utils';

export const INTERCITY_LABEL = 'Intercity Bus Network';

/** Current New York date (YYYY-MM-DD) and time (HH:mm). */
export function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Descriptive provider status: imported / link-only / access required / service unverified. */
export function providerStatus(s: string) {
  const v = s.toLowerCase();
  if (/import/.test(v)) return { k: 'imported', l: 'Times imported', c: 'text-[hsl(var(--ok))]', dot: 'bg-[hsl(var(--ok))]' };
  if (/access|permission|credential/.test(v)) return { k: 'access', l: 'Access required', c: 'text-[hsl(var(--warn))]', dot: 'bg-[hsl(var(--warn))]' };
  if (/unverif/.test(v)) return { k: 'unverified', l: 'Service unverified', c: 'text-muted-foreground', dot: 'bg-muted-foreground' };
  if (/link/.test(v)) return { k: 'link', l: 'Official link only', c: 'text-[hsl(var(--scheduled))]', dot: 'bg-[hsl(var(--scheduled))]' };
  return { k: 'other', l: s, c: 'text-muted-foreground', dot: 'bg-muted-foreground' };
}

function DepartureRow({ d, index }: { d: IntercityDeparture; index: number }) {
  const [open, setOpen] = useState(false);
  const rest = [...d.stops].sort((a, b) => a.sequence - b.sequence);
  return (
    <li className="rise rounded-2xl border border-card-border bg-card" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }} data-testid={`card-intercity-${d.id}`}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={`button-intercity-expand-${d.id}`} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="w-16 shrink-0">
          <p className="tabular text-xl font-bold leading-none" data-testid={`text-intercity-time-${d.id}`}>{clock(d.time)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{d.serviceDate}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words font-bold leading-tight">to {d.destination}</p>
          <p className="break-words text-sm text-muted-foreground">{d.providerName} · from {d.stopName}</p>
          <span className="mt-1.5 inline-flex rounded-full border border-[hsl(var(--scheduled)/.4)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--scheduled))]">Scheduled · provider timetable</span>
        </div>
        <ChevronDown className={cn('mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3 text-sm">
          {d.boardingNotes && <p className="mb-3 rounded-xl border border-border bg-background/40 px-3 py-2"><b>Boarding:</b> {d.boardingNotes}</p>}
          <ol className="relative ml-1.5 space-y-2.5 border-l-2 border-dashed border-[hsl(var(--warn)/.6)] pl-4" aria-label="Remaining stops">
            {rest.map((s, i) => (
              <li key={`${s.id}-${s.sequence}`} className="relative">
                <span className={cn('absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-[hsl(var(--warn))]', i === 0 ? 'bg-[hsl(var(--warn))]' : 'bg-card')} aria-hidden />
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn(i === 0 && 'font-bold')}>{s.name}{i === 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">boarding</span>}</span>
                  <span className="tabular shrink-0 text-right text-xs text-muted-foreground">{s.time ? clock(s.time) : 'Time not published'}{s.time && s.time.slice(0,10)!==d.time.slice(0,10)&&<span className="block">{s.time.slice(0,10)}</span>}</span>
                </div>
                {s.address && <p className="text-xs text-muted-foreground">{s.address}</p>}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Times shown in New York local time · updated {ago(d.updatedAt)}</span>
            {d.sourceUrl && <a href={d.sourceUrl} target="_blank" rel="noreferrer" data-testid={`link-intercity-source-${d.id}`} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">Official source <ExternalLink className="h-3 w-3" /></a>}
          </div>
        </div>
      )}
    </li>
  );
}

export function ProviderGaps({ providers }: { providers: IntercityProvider[] }) {
  const gaps = providers.filter((p) => providerStatus(p.status).k !== 'imported');
  if (!gaps.length) return null;
  return (
    <details className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm" data-testid="details-intercity-gaps">
      <summary className="cursor-pointer font-semibold">{gaps.length} nearby provider{gaps.length > 1 ? 's' : ''} without imported times</summary>
      <ul className="mt-2 space-y-2">
        {gaps.map((p) => { const st = providerStatus(p.status); return (
          <li key={p.id} className="flex items-start justify-between gap-3" data-testid={`row-intercity-gap-${p.id}`}>
            <div className="min-w-0">
              <p className="font-semibold">{p.name} <span className={cn('ml-1 text-xs font-bold', st.c)}>{st.l}</span></p>
              <p className="text-xs text-muted-foreground">Coverage gap: Transtop has no departure times for this provider. Check the official schedule.</p>
            </div>
            {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs underline underline-offset-2">Schedule <ExternalLink className="h-3 w-3" /></a>}
          </li>
        ); })}
      </ul>
    </details>
  );
}

export function IntercityModule({ center, provider, onProvider, compact, routeId, stopId }: { center: { lat: number; lon: number }; provider: string; onProvider?: (p: string) => void; compact?: boolean; routeId?: string; stopId?: string }) {
  const now = useMemo(() => nyNow(), []);
  const [date, setDate] = useState(now.date);
  const [from, setFrom] = useState(now.time);
  const [followNow,setFollowNow]=useState(true);
  useEffect(()=>{
    if(!followNow)return;
    const id=setInterval(()=>{const n=nyNow();setDate(n.date);setFrom(n.time);},30_000);
    return ()=>clearInterval(id);
  },[followNow]);
  const base = { lat: +center.lat.toFixed(5), lon: +center.lon.toFixed(5), date, ...(from ? { from } : {}) };
  const params: GetIntercityDeparturesParams = { ...base, ...(provider ? { provider } : {}) };
  const q = useGetIntercityDepartures(params, { query: { queryKey: getGetIntercityDeparturesQueryKey(params), staleTime: 60_000, refetchInterval:60_000, retry: 1 } });
  // provider candidates independent of selected provider
  const candQ = useGetIntercityDepartures(base, { query: { queryKey: getGetIntercityDeparturesQueryKey(base), staleTime: 60_000, retry: 1, enabled: !!provider&&!!onProvider } });
  const candidates = (provider ? candQ.data?.providers : q.data?.providers) ?? q.data?.providers ?? [];
  const deps = useMemo(() => [...(q.data?.departures ?? [])].filter(d=>(!routeId||d.routeId===routeId)&&(!stopId||d.stopId===stopId)).sort((a, b) => a.time.localeCompare(b.time)), [q.data,routeId,stopId]);
  const shown = compact ? deps.slice(0, 4) : deps;
  if (compact && q.data && deps.length === 0 && candidates.length === 0) return null;
  const sel = 'h-10 rounded-xl border border-input bg-card px-3 text-sm';
  return (
    <section className="space-y-3" aria-label={INTERCITY_LABEL} data-testid="section-intercity">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[hsl(var(--warn))]">{INTERCITY_LABEL}</p>
          <h2 className="font-display text-xl">Departing nearby</h2>
        </div>
        {q.data && <p className="text-right text-xs text-muted-foreground">Within {(q.data.radiusMeters / 1000).toFixed(1)} km · {ago(q.data.updatedAt)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {onProvider&&<select value={provider} onChange={(e) => onProvider(e.target.value)} aria-label="Intercity provider" data-testid="select-intercity-provider" className={sel}>
          <option value="">All providers</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <label className="relative inline-flex items-center"><CalendarClock className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input type="date" value={date} min={now.date} onChange={(e) => {if(e.target.value){setFollowNow(false);setDate(e.target.value);}}} aria-label="Departure date" data-testid="input-intercity-date" className={cn(sel, 'pl-8')} /></label>
        <input type="time" value={from} onChange={(e) => {setFollowNow(false);setFrom(e.target.value);}} aria-label="Departing from time" data-testid="input-intercity-from" className={sel} />
        {!followNow && <button onClick={() => { const n = nyNow(); setDate(n.date); setFrom(n.time);setFollowNow(true); }} data-testid="button-intercity-now" className="h-10 rounded-full border border-border px-3 text-sm font-semibold text-muted-foreground hover:text-foreground">Now</button>}
      </div>
      {q.isLoading && <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="skel h-20" />)}</div>}
      {q.isError && <div className="rounded-2xl border border-[hsl(var(--bad)/.35)] bg-card p-4 text-sm" role="alert">Intercity departures unavailable. <button onClick={() => q.refetch()} className="font-semibold underline" data-testid="button-intercity-retry">Try again</button></div>}
      {q.data?.message && <p className="rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground" role="status">{q.data.message}</p>}
      {q.data && deps.length === 0 && !compact && (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground"><RouteIcon className="h-6 w-6 shrink-0" />No imported intercity departures near here for this date and time. Intercity results only cover boarding points within 3 km.</div>
      )}
      {shown.length > 0 && <ol className="space-y-2">{shown.map((d, i) => <DepartureRow key={d.id} d={d} index={i} />)}</ol>}
      {compact && deps.length > shown.length && <p className="text-xs text-muted-foreground">{deps.length - shown.length} more. Choose {INTERCITY_LABEL} above to see all.</p>}
      <ProviderGaps providers={candidates} />
    </section>
  );
}
