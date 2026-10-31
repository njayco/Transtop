import { useEffect, useMemo, useRef } from 'react';
import { trackEvent } from '@/lib/analytics';
import { usePageMetadata } from '@/lib/use-page-metadata';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Accessibility, Radio } from 'lucide-react';
import { getGetStopQueryKey, useGetStop, type Arrival } from '@workspace/api-client-react';
import { LiveIndicator } from '@/components/shell';
import { AlertRow, Countdown, ErrorState, FavButton, ModeIcon, RouteBadge, SkeletonCards, SourceLabel, StatusText, TransitLines } from '@/components/transit';
import { TransitMap } from '@/components/transit-map';
import { TimetablePanel } from '@/components/timetable';
import { IntercityModule, providerFor } from '@/components/intercity';
import { honest, usePrefs } from '@/lib/prefs';
import { ago, clock } from '@/lib/format';
import { useFreshArrivals } from '@/lib/amtrak-arrivals';
import { TransitlandDetails } from '@/components/global-coverage';
import { OdptDetails } from '@/components/odpt-details';
import { IdfmDetails } from '@/components/idfm-details';
import { TflDetails, tflErrorDetail } from '@/components/tfl-details';
import { WmataDetails } from '@/components/wmata-details';

export default function StopPage() {
  const { id = '' } = useParams<{ id: string }>();
  const stopId = decodeURIComponent(id);
  const { mode, isFavStop, toggleStop } = usePrefs();
  const params = { mode };
  const q = useGetStop(stopId, params, { query: { queryKey: getGetStopQueryKey(stopId, params), refetchInterval: 30_000, retry: 1 } });
  const stop = q.data;
  const trackedStop = useRef<string | null>(null);
  useEffect(() => {
    if (stop && stop.id === stopId && trackedStop.current !== stopId) {
      trackedStop.current = stopId;
      trackEvent('stop_viewed', { mode: stop.type });
    }
  }, [stop, stopId]);
  usePageMetadata(`/stops/${encodeURIComponent(stopId)}`, stop);
  const freshArrivals=useFreshArrivals(stop?.arrivals??[]);
  const groups = useMemo(() => {
    const m = new Map<string, Arrival[]>();
    honest(freshArrivals, mode).forEach((a) => {
      const k = `${a.direction}|${a.destination}`;
      m.set(k, [...(m.get(k) ?? []), a]);
    });
    return Array.from(m.entries()).map(([k, arr]) => ({ key: k, direction: k.split('|')[0], destination: k.split('|')[1], arr: arr.sort((x, y) => x.minutes - y.minutes) }));
  }, [freshArrivals, mode]);
  const mapStops = useMemo(() => (stop ? [{ id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, type: stop.type, label: true, routes: stop.routes }] : []), [stop]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="relative overflow-hidden border-b border-border">
        <TransitLines className="absolute inset-0 h-full w-full opacity-30" />
        <div className="relative space-y-4 p-4 md:p-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-full pr-3 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back"><ArrowLeft className="h-5 w-5" />Nearby</Link>
            <div className="md:hidden"><LiveIndicator compact /></div>
          </div>
          {q.isLoading && <div className="space-y-3"><div className="skel h-10 w-2/3" /><div className="skel h-6 w-1/3" /></div>}
          {stop && (
            <div className="rise flex items-start gap-4">
              <ModeIcon type={stop.type} size={56} className="hidden sm:inline-flex" />
              <div className="min-w-0 flex-1">
                <h1 className="break-words font-display text-4xl leading-[0.95] md:text-6xl" data-testid="text-stop-name">{stop.name}</h1>
                <p className="mt-2 text-muted-foreground">{stop.agency}{stop.neighborhood ? ` · ${stop.neighborhood}` : ''}
                  {stop.wmata ? <span className="ml-2">· Step-free access not verified</span> : stop.accessible ? <span className="ml-2 inline-flex items-center gap-1 text-foreground"><Accessibility className="h-4 w-4" />Accessible</span> : <span className="ml-2">· Accessibility not confirmed</span>}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {stop.routes.map((r) => <Link key={r.id} href={`/routes/${encodeURIComponent(r.id)}?stop=${encodeURIComponent(stop.id)}`} aria-label={`Route ${r.name} details`} className="transition-transform hover:scale-110"><RouteBadge name={r.name} color={r.color} size="md" /></Link>)}
                </div>
                {stop.wmata?.access && <a className="inline-block min-h-11 py-3 text-sm underline" href="#wmata-station-access">View entrances and equipment outages</a>}
              </div>
              <FavButton active={isFavStop(stop.id)} onClick={() => toggleStop(stop)} label={stop.name} />
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 p-4 md:grid-cols-[minmax(0,1fr)_340px] md:p-8">
        <div className="min-w-0 space-y-6">
          {q.isLoading && <SkeletonCards n={3} />}
          {q.isError && <ErrorState title={q.error?.status === 404 ? "Stop unavailable" : "Could not load this stop"} detail={q.error?.status === 404 ? "This stop is not available in the current coverage. Browse nearby services or check coverage in Settings." : stopId.startsWith('tfl:') ? tflErrorDetail(q.error) : undefined} onRetry={q.error?.status === 404 ? undefined : () => q.refetch()} />}
          {stop && stop.alerts.length > 0 && <div className="space-y-2">{stop.alerts.map((a) => <AlertRow key={a.id} alert={a} />)}</div>}
          {stop && groups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <p className="font-display text-xl">No departures to show</p>
              <p className="mt-1 text-sm text-muted-foreground">No official predictions, community estimates or scheduled departures are available for this stop right now. Check Settings for feed status.</p>
            </div>
          )}
          {groups.map((g, gi) => (
            <section key={g.key} className="rise overflow-hidden rounded-2xl border border-card-border bg-card" style={{ animationDelay: `${gi * 50}ms` }}>
              <header className="flex flex-col gap-1 border-b border-white/5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                <h2 className="text-xl font-bold tracking-tight">{g.direction} <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Now</span></h2>
                <p className="truncate text-sm text-muted-foreground">to {g.destination}</p>
              </header>
              <ul>
                {g.arr.map((a) => (
                  <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-white/5 px-4 py-3 last:border-0 sm:flex sm:items-center" data-testid={`row-arrival-${a.id}`}>
                    <div className="min-w-0 sm:shrink-0"><RouteBadge name={a.routeName} color={a.color} size="lg" className="max-w-full sm:max-w-36" /></div>
                    <div className="col-span-2 min-w-0 sm:flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 font-semibold">{a.destination} <StatusText status={a.status} /></p>
                      {a.runId&&<Link href={`/trains/${encodeURIComponent(a.runId)}`} className="text-sm font-bold underline">Train {a.trainNumber} · all stops</Link>}
                      <p className="text-xs text-muted-foreground">{a.source==='live'?'Estimated':'Scheduled'} {clock(a.scheduledAt,a.timezone)}{a.timezone?` · ${a.timezone}`:''}{a.confidence ? ` · ${a.confidence} confidence (heuristic)` : ''}</p>
                      <div className="mt-1.5"><SourceLabel source={a.trainNumber&&a.source==='live'?'Amtraker · unofficial':a.source} updatedAt={a.updatedAt} /></div>
                    </div>
                    <div className="col-start-2 row-start-1 self-center sm:shrink-0"><Countdown a={a} big /></div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {stop&&<TransitlandDetails info={stop.transitland}/>}
          {stop&&<OdptDetails info={stop.odpt}/>}
          <IdfmDetails info={stop?.idfm}/>
          <WmataDetails info={stop?.wmata}/>
          <TflDetails info={stop?.tfl} />
          {stop?.tfl?<p className="text-xs text-muted-foreground">TfL predictions are not a dated timetable. A missing prediction does not mean service has stopped.</p>:stop?.type==='intercity'&&!stop.transitland?<IntercityModule center={{lat:stop.lat,lon:stop.lon}} provider={providerFor(undefined, stop.id)} stopId={stop.id}/>:stop&&<TimetablePanel stopId={stop.id} timezone={stop.odpt?.timezone||stop.transitland?.timezone} title="Timetable for any date" />}
          {stop && <p className="text-xs text-muted-foreground">Stop data updated {ago(stop.updatedAt)}. Times refresh every 30 seconds while open.</p>}
        </div>
        <aside className="min-w-0 space-y-4">
          {stop && <TransitMap center={{ lat: stop.lat, lon: stop.lon }} stops={mapStops} activeId={stop.id} zoom={15.5} className="h-64 w-full overflow-hidden rounded-2xl border border-border" label={`Map of ${stop.name}`} />}
          {stop && !stop.tfl && stop.routes[0] && (
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
