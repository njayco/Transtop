import { useMemo, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { ArrowLeft, ArrowUpDown } from 'lucide-react';
import { getGetRouteQueryKey, useGetRoute } from '@workspace/api-client-react';
import { ModeSwitch } from '@/components/shell';
import { AlertRow, Countdown, ErrorState, FavButton, MODE_NAME, RouteBadge, SkeletonCards, SourceLabel } from '@/components/transit';
import { TransitMap } from '@/components/transit-map';
import { honest, usePrefs } from '@/lib/prefs';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function RoutePage() {
  const { id = '' } = useParams<{ id: string }>();
  const routeId = decodeURIComponent(id);
  const search = new URLSearchParams(useSearch());
  const currentStop = search.get('stop');
  const { mode, isFavRoute, toggleRoute } = usePrefs();
  const [direction, setDirection] = useState<string | undefined>(undefined);
  const params = { mode, ...(direction ? { direction } : {}) };
  const q = useGetRoute(routeId, params, { query: { queryKey: getGetRouteQueryKey(routeId, params), refetchInterval: 30_000, retry: 1 } });
  const d = q.data;
  const dirs = d?.directions ?? [];
  const activeDir = direction ?? dirs[0];
  const color = d?.route.color ?? '#888';
  const vehicles = useMemo(() => honest(d?.vehicles ?? [], mode).filter((v) => mode === 'demo' || !v.source.toLowerCase().includes('demo')).map((v) => ({ ...v, color, routeName: d?.route.name })), [d, mode, color]);
  const shape = useMemo(() => (d ? { coords: d.shape, color } : null), [d, color]);
  const mapStops = useMemo(() => (d?.stops ?? []).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, type: s.type, color })), [d, color]);
  const center = d?.stops[0] ? { lat: d.stops[0].lat, lon: d.stops[0].lon } : { lat: 40.758, lon: -73.9855 };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between">
        <button onClick={() => history.back()} className="inline-flex h-11 items-center gap-2 pr-3 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-back"><ArrowLeft className="h-5 w-5" />Back</button>
        <div className="md:hidden"><ModeSwitch compact /></div>
      </div>
      {q.isLoading && <SkeletonCards n={2} />}
      {q.isError && <ErrorState title="Could not load this route" onRetry={() => q.refetch()} />}
      {d && (
        <>
          <header className="rise mt-2 flex items-center gap-4">
            <RouteBadge name={d.route.name} color={color} size="lg" className="h-16 min-w-16 text-3xl" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-4xl md:text-5xl" data-testid="text-route-name">{d.route.name} {MODE_NAME[d.route.type]}</h1>
              <p className="text-muted-foreground">{d.route.agency}{activeDir ? ` · ${activeDir}` : ''}</p>
            </div>
            <FavButton active={isFavRoute(d.route.id)} onClick={() => toggleRoute(d.route)} label={`route ${d.route.name}`} />
          </header>
          {dirs.length > 0 && (
            <div role="radiogroup" aria-label="Direction" className="no-scrollbar mt-5 flex gap-2 overflow-x-auto">
              <ArrowUpDown className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {dirs.map((dir) => (
                <button key={dir} role="radio" aria-checked={activeDir === dir} onClick={() => setDirection(dir)} data-testid={`button-direction-${dir}`}
                  className={cn('h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', activeDir === dir ? 'border-transparent text-black' : 'border-border text-muted-foreground')}
                  style={activeDir === dir ? { background: color } : undefined}>{dir}</button>
              ))}
            </div>
          )}
          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              {d.alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
              <ol className="relative" aria-label="Stops in order">
                <span className="absolute bottom-6 left-[19px] top-6 w-1" style={{ background: color }} aria-hidden />
                {d.stops.map((s, i) => {
                  const cur = s.id === currentStop;
                  const next = honest(s.arrivals, mode).filter((a) => a.routeId === d.route.id).sort((a, b) => a.minutes - b.minutes)[0];
                  return (
                    <li key={s.id} className="rise relative" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                      <Link href={`/stops/${encodeURIComponent(s.id)}`} data-testid={`link-route-stop-${s.id}`} aria-current={cur ? 'location' : undefined}
                        className={cn('flex min-h-[56px] items-center gap-4 rounded-xl py-2 pr-3 hover:bg-white/5', cur && 'bg-white/[.06]')}>
                        <span className={cn('relative z-10 ml-[10px] shrink-0 rounded-full border-[3px] bg-background', cur ? 'h-[22px] w-[22px] -ml-px' : 'h-5 w-5')} style={{ borderColor: cur ? '#f4f1ea' : color }} />
                        <div className="min-w-0 flex-1">
                          <p className={cn('truncate', cur ? 'text-lg font-extrabold' : 'font-semibold')}>{s.name}{cur && <span className="ml-2 text-xs font-bold uppercase tracking-wider text-primary">Your stop</span>}</p>
                          {next && <SourceLabel source={next.source} className="mt-1" />}
                        </div>
                        {next && <Countdown a={next} />}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
            <aside className="space-y-3 md:sticky md:top-20 md:self-start">
              <TransitMap center={center} stops={mapStops} activeId={currentStop} shape={shape} vehicles={vehicles} className="h-[380px] w-full overflow-hidden rounded-2xl border border-border" label={`Map of route ${d.route.name}`} />
              <div className="rounded-2xl border border-card-border bg-card p-4 text-sm">
                <p className="font-bold">Vehicle positions</p>
                {vehicles.length === 0 ? <p className="mt-1 text-muted-foreground">No positions available for this route right now.</p> : (
                  <ul className="mt-2 space-y-1.5">
                    {vehicles.map((v) => <li key={v.id} className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Vehicle {v.id.split(':').pop()}</span><SourceLabel source={v.source} updatedAt={v.updatedAt} /></li>)}
                  </ul>
                )}
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rotate-45 bg-foreground align-middle" />Agency or demo position</span>
                  <span><span className="mr-1.5 inline-block h-3 w-3 rounded-full border border-dashed border-[hsl(var(--community))] align-middle" />Approximate community area</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">Individual riders are never shown. Updated {ago(vehicles[0]?.updatedAt)}.</p>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
