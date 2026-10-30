import { useMemo } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Accessibility, Radio } from 'lucide-react';
import { getGetStopQueryKey, useGetStop, type Arrival } from '@workspace/api-client-react';
import { ModeSwitch } from '@/components/shell';
import { AlertRow, Countdown, ErrorState, FavButton, ModeIcon, RouteBadge, SkeletonCards, SourceLabel, StatusText, TransitLines } from '@/components/transit';
import { TransitMap } from '@/components/transit-map';
import { TimetablePanel } from '@/components/timetable';
import { honest, usePrefs } from '@/lib/prefs';
import { ago, clock } from '@/lib/format';

export default function StopPage() {
  const { id = '' } = useParams<{ id: string }>();
  const stopId = decodeURIComponent(id);
  const { mode, isFavStop, toggleStop } = usePrefs();
  const params = { mode };
  const q = useGetStop(stopId, params, { query: { queryKey: getGetStopQueryKey(stopId, params), refetchInterval: 30_000, retry: 1 } });
  const stop = q.data;
  const groups = useMemo(() => {
    const m = new Map<string, Arrival[]>();
    honest(stop?.arrivals ?? [], mode).forEach((a) => {
      const k = `${a.direction}|${a.destination}`;
      m.set(k, [...(m.get(k) ?? []), a]);
    });
    return Array.from(m.entries()).map(([k, arr]) => ({ key: k, direction: k.split('|')[0], destination: k.split('|')[1], arr: arr.sort((x, y) => x.minutes - y.minutes) }));
  }, [stop, mode]);
  const mapStops = useMemo(() => (stop ? [{ id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, type: stop.type, label: true, routes: stop.routes }] : []), [stop]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="relative overflow-hidden border-b border-border">
        <TransitLines className="absolute inset-0 h-full w-full opacity-30" />
        <div className="relative space-y-4 p-4 md:p-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-full pr-3 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back"><ArrowLeft className="h-5 w-5" />Nearby</Link>
            <div className="md:hidden"><ModeSwitch compact /></div>
          </div>
          {q.isLoading && <div className="space-y-3"><div className="skel h-10 w-2/3" /><div className="skel h-6 w-1/3" /></div>}
          {stop && (
            <div className="rise flex items-start gap-4">
              <ModeIcon type={stop.type} size={56} className="hidden sm:inline-flex" />
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-4xl leading-[0.95] md:text-6xl" data-testid="text-stop-name">{stop.name}</h1>
                <p className="mt-2 text-muted-foreground">{stop.agency}{stop.neighborhood ? ` · ${stop.neighborhood}` : ''}
                  {stop.accessible ? <span className="ml-2 inline-flex items-center gap-1 text-foreground"><Accessibility className="h-4 w-4" />Accessible</span> : <span className="ml-2">· Accessibility not confirmed</span>}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {stop.routes.map((r) => <Link key={r.id} href={`/routes/${encodeURIComponent(r.id)}?stop=${encodeURIComponent(stop.id)}`} aria-label={`Route ${r.name} details`} className="transition-transform hover:scale-110"><RouteBadge name={r.name} color={r.color} size="md" /></Link>)}
                </div>
              </div>
              <FavButton active={isFavStop(stop.id)} onClick={() => toggleStop(stop)} label={stop.name} />
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-6 p-4 md:grid-cols-[1fr_340px] md:p-8">
        <div className="space-y-6">
          {q.isLoading && <SkeletonCards n={3} />}
          {q.isError && <ErrorState title="Could not load this stop" onRetry={() => q.refetch()} />}
          {stop && stop.alerts.length > 0 && <div className="space-y-2">{stop.alerts.map((a) => <AlertRow key={a.id} alert={a} />)}</div>}
          {stop && groups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <p className="font-display text-xl">No departures to show</p>
              <p className="mt-1 text-sm text-muted-foreground">{mode === 'live' ? 'No fresh live, community or scheduled data for this stop. Transtop will not show demo times in Live mode.' : 'Nothing scheduled soon.'}</p>
            </div>
          )}
          {groups.map((g, gi) => (
            <section key={g.key} className="rise overflow-hidden rounded-2xl border border-card-border bg-card" style={{ animationDelay: `${gi * 50}ms` }}>
              <header className="flex items-baseline justify-between gap-2 border-b border-white/5 px-4 py-3">
                <h2 className="text-xl font-bold tracking-tight">{g.direction} <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Now</span></h2>
                <p className="truncate text-sm text-muted-foreground">to {g.destination}</p>
              </header>
              <ul>
                {g.arr.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-0" data-testid={`row-arrival-${a.id}`}>
                    <RouteBadge name={a.routeName} color={a.color} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 font-semibold">{a.destination} <StatusText status={a.status} /></p>
                      <p className="text-xs text-muted-foreground">Scheduled {clock(a.scheduledAt)}{a.confidence ? ` · ${a.confidence} confidence (heuristic)` : ''}</p>
                      <div className="mt-1.5"><SourceLabel source={a.source} updatedAt={a.updatedAt} /></div>
                    </div>
                    <Countdown a={a} big />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {stop && <TimetablePanel stopId={stop.id} title="Timetable for any date" />}
          {stop && <p className="text-xs text-muted-foreground">Stop data updated {ago(stop.updatedAt)}. Times refresh every 30 seconds while open.</p>}
        </div>
        <aside className="space-y-4">
          {stop && <TransitMap center={{ lat: stop.lat, lon: stop.lon }} stops={mapStops} activeId={stop.id} zoom={15.5} className="h-64 w-full overflow-hidden rounded-2xl border border-border" label={`Map of ${stop.name}`} />}
          {stop && stop.routes[0] && (
            <Link href={`/ride?route=${encodeURIComponent(stop.routes[0].id)}&stop=${encodeURIComponent(stop.id)}`} data-testid="link-ride-from-stop"
              className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-4 hover:border-white/25">
              <Radio className="h-6 w-6 text-[hsl(var(--community))]" />
              <div><p className="font-bold">On board from here?</p><p className="text-sm text-muted-foreground">Optionally help improve estimates for other riders.</p></div>
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
