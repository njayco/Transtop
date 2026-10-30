import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Search as SearchIcon, ArrowUpRight } from 'lucide-react';
import { getGetStopsQueryKey, useGetStops, type Route } from '@workspace/api-client-react';
import { MobileTop } from '@/components/shell';
import { ErrorState, ModeIcon, RouteBadge, SkeletonCards, StopCard, MODE_NAME } from '@/components/transit';
import { usePrefs } from '@/lib/prefs';

const SUGGEST = ['Times Square', 'Grand Central', 'Penn Station', 'Bryant Park', 'Jamaica', 'M15', 'Port Washington'];

export default function SearchPage() {
  const { mode } = usePrefs();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setQ(text.trim()), 300);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [text]);
  const params = { q, mode };
  const res = useGetStops(params, { query: { queryKey: getGetStopsQueryKey(params), enabled: q.length >= 2 } });
  const stops = res.data?.stops ?? [];
  const routes = useMemo(() => {
    const m = new Map<string, Route>();
    stops.forEach((s) => s.routes.forEach((r) => {
      if (r.name.toLowerCase().includes(q.toLowerCase()) || r.id.toLowerCase().includes(q.toLowerCase())) m.set(r.id, r);
    }));
    return Array.from(m.values());
  }, [stops, q]);

  return (
    <div className="mx-auto max-w-3xl">
      <MobileTop />
      <div className="space-y-6 p-4 md:p-8">
        <h1 className="font-display text-4xl md:text-6xl">Where to?</h1>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} type="search" aria-label="Search stations, stops, routes and addresses" data-testid="input-search"
            placeholder="Stations, stops, routes, addresses" className="h-16 w-full rounded-2xl border border-input bg-card pl-14 pr-4 text-lg placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
        </div>
        {q.length < 2 && (
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Try</p>
            <div className="flex flex-wrap gap-2">
              {SUGGEST.map((s) => <button key={s} onClick={() => setText(s)} className="h-11 rounded-full border border-border px-4 text-sm font-semibold hover:border-white/40" data-testid={`button-suggest-${s}`}>{s}</button>)}
            </div>
          </div>
        )}
        {q.length >= 2 && res.isLoading && <SkeletonCards n={3} />}
        {res.isError && <ErrorState title="Search failed" onRetry={() => res.refetch()} />}
        {res.data && (
          <>
            {res.data.message && <p className="text-sm text-muted-foreground" role="status">{res.data.message}</p>}
            {routes.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Routes</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {routes.map((r) => (
                    <Link key={r.id} href={`/routes/${encodeURIComponent(r.id)}`} data-testid={`link-route-${r.id}`} className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-3 hover:border-white/25">
                      <RouteBadge name={r.name} color={r.color} size="lg" />
                      <div className="min-w-0 flex-1"><p className="font-bold">{r.name} {MODE_NAME[r.type]}</p><p className="truncate text-sm text-muted-foreground">{r.agency}</p></div>
                      <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Stations and stops</h2>
              {stops.length === 0
                ? <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-6"><ModeIcon type="bus" size={36} /><p className="text-muted-foreground">Nothing matches "{q}". Try a station name, a route like "Q" or "M15", or a neighborhood.</p></div>
                : <div className="space-y-3">{stops.map((s, i) => <StopCard key={s.id} stop={s} index={i} />)}</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
