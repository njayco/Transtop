import { useEffect, useMemo, useRef, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { Link, useParams, useSearch } from 'wouter';
import { ArrowLeft, ArrowRight, ArrowUpDown, ExternalLink, X } from 'lucide-react';
import { getGetNetworkQueryKey, getGetRouteQueryKey, useGetNetwork, useGetRoute, type GetNetworkParams } from '@workspace/api-client-react';
import { LiveIndicator } from '@/components/shell';
import { AlertRow, Countdown, ErrorState, FavButton, MODE_NAME, RouteBadge, SkeletonCards, SourceLabel } from '@/components/transit';
import { TransitMap } from '@/components/transit-map';
import { TimetablePanel } from '@/components/timetable';
import { TransitlandDetails } from '@/components/global-coverage';
import { IntercityModule, providerFor } from '@/components/intercity';
import { honest, usePrefs } from '@/lib/prefs';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TflDetails, tflErrorDetail } from '@/components/tfl-details';
import { OdptDetails } from '@/components/odpt-details';
import { IdfmDetails } from '@/components/idfm-details';

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
  const trackedRoute = useRef<string | null>(null);
  useEffect(() => {
    if (d && d.route.id === routeId && trackedRoute.current !== routeId) {
      trackedRoute.current = routeId;
      trackEvent('route_viewed', { mode: d.route.type });
    }
  }, [d, routeId]);
  const dirs = d?.directions ?? [];
  const activeDir = direction ?? dirs[0];
  const color = d?.route.color ?? '#888';
  const vehicles = useMemo(() => honest(d?.vehicles ?? []).map((v) => ({ ...v, color, routeName: d?.route.name })), [d, color]);
  const netParams: GetNetworkParams = useMemo(() => ({ mode, routeId, zoom: 14 }), [mode, routeId]);
  const net = useGetNetwork(netParams, { query: { queryKey: getGetNetworkQueryKey(netParams), staleTime: 60_000, retry: 1 } });
  const [selStop, setSelStop] = useState<string | null>(null);
  // Key geometry by content so 30-second route refreshes never refit the map.
  const shapeKey = d ? `${d.route.id}|${activeDir ?? ''}|${JSON.stringify(d.shape)}` : '';
  const shape = useMemo(() => {
    if (!d || d.shape.length < 2) return null;
    // In live mode never draw a stop-to-stop straight-line fallback; rely on official network shapes.
    if (mode === 'live' && (net.data?.lines.length ?? 0) === 0 && d.shape.length <= 2) return null;
    return { coords: d.shape, color };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, color, mode, (net.data?.lines.length ?? 0) > 0]);
  const branches = useMemo(() => (net.data?.lines ?? []).map((l) => ({ id: l.route.id, shapeId: l.shapeId, type: l.route.type, agency: l.route.agency, name: l.route.name, color: l.route.color, coords: l.shape })), [net.data]);
  const mapStops = useMemo(() => (d?.stops ?? []).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, type: s.type, color, label: true, routes: s.routes.map((r) => ({ id: r.id, name: r.name, color: r.color })) })), [d, color]);
  const picked = d?.stops.find((s) => s.id === selStop);
  const pickedIndex = picked ? d!.stops.indexOf(picked) + 1 : 0;
  const center = d?.stops[0] ? { lat: d.stops[0].lat, lon: d.stops[0].lon } : { lat: 40.758, lon: -73.9855 };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between">
        <button onClick={() => history.back()} className="inline-flex h-11 items-center gap-2 pr-3 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-back"><ArrowLeft className="h-5 w-5" />Back</button>
        <div className="md:hidden"><LiveIndicator compact /></div>
      </div>
      {q.isLoading && <SkeletonCards n={2} />}
      {q.isError && <ErrorState title={q.error?.status === 404 ? "Route unavailable" : "Could not load this route"} detail={q.error?.status === 404 ? "This route is not available in the current coverage. Browse nearby services or check coverage in Settings." : routeId.startsWith('tfl:') ? tflErrorDetail(q.error) : undefined} onRetry={q.error?.status === 404 ? undefined : () => q.refetch()} />}
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
              <TransitlandDetails info={d.route.transitland}/>
              <OdptDetails info={d.route.odpt}/>
              <IdfmDetails info={d.route.idfm}/>
              {dirs.length > 0 && <p className="text-xs text-muted-foreground" data-testid="text-patterns">{dirs.length} {d.route.tfl?'TfL direction choices':'published service patterns'}. Stops shown for {activeDir}.</p>}
              {((d.route.scheduleNotes?.length ?? 0) > 0 || d.route.sourceUrl) && (
                <section aria-labelledby="h-published-schedule" className="rounded-2xl border border-card-border bg-card p-4 text-sm" data-testid="section-published-schedule">
                  <h2 id="h-published-schedule" className="font-bold">{d.route.tfl?'TfL source and coverage':'Published schedule information'}</h2>
                  {(d.route.scheduleNotes?.length ?? 0) > 0 && (
                    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
                      {d.route.scheduleNotes!.map((n, i) => <li key={i} className="break-words" data-testid={`text-schedule-note-${i}`}>{n}</li>)}
                    </ul>
                  )}
                  {d.route.sourceUrl && <a href={d.route.sourceUrl} target="_blank" rel="noreferrer" data-testid="link-route-source" className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold underline underline-offset-2 hover:text-foreground">{d.route.tfl?'TfL data terms':'Official schedule source'}<ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens in new tab)</span></a>}
                </section>
              )}
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
                        <span className={cn('relative z-10 ml-[6px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[3px] bg-background text-[11px] font-bold tabular', (cur || selStop === s.id) && 'ring-2 ring-foreground')} style={{ borderColor: color }} aria-label={`Stop ${i + 1}`} data-testid={`text-stop-number-${i + 1}`}>{i + 1}</span>
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
            <aside className="space-y-3">
              <TransitMap center={center} stops={mapStops} activeId={selStop ?? currentStop} shape={shape} network={branches} labelStops vehicles={vehicles} onSelect={setSelStop} className="h-[380px] w-full overflow-hidden rounded-2xl border border-border" label={`Map of route ${d.route.name}`} />
              {mode === 'live' && net.data && (net.data.missingGeometry.length > 0 || net.data.lines.length === 0) && (
                <p className="rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground" data-testid="text-route-geometry">Some or all official path geometry for this route is not published, so parts of the line may not be drawn. Numbered stops are shown at their true locations.</p>
              )}
              {net.data && net.data.lines.length > 1 && <p className="text-xs text-muted-foreground" data-testid="text-route-branches">{net.data.lines.length} official path shapes drawn; the selected direction is emphasized.</p>}
              {picked ? (
                <div className="rise rounded-2xl border border-card-border bg-card p-4" data-testid="card-route-selected-stop">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[3px] text-xs font-bold tabular" style={{ borderColor: color }}>{pickedIndex}</span>
                    <div className="min-w-0 flex-1"><p className="font-bold">{picked.name}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{picked.routes.map((r) => <RouteBadge key={r.id} name={r.name} color={r.color} size="sm" />)}</div></div>
                    <button onClick={() => setSelStop(null)} aria-label="Clear stop" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>
                  </div>
                  <Link href={`/stops/${encodeURIComponent(picked.id)}`} data-testid="link-route-selected-stop" className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground">Arrivals<ArrowRight className="h-4 w-4" /></Link>
                </div>
              ) : <p className="text-xs text-muted-foreground">Tap a numbered stop on the map to see its routes.</p>}
              <div className="rounded-2xl border border-card-border bg-card p-4 text-sm">
                <p className="font-bold">Vehicle positions</p>
                {vehicles.length === 0 ? <p className="mt-1 text-muted-foreground">No positions available for this route right now.</p> : (
                  <ul className="mt-2 space-y-1.5">
                    {vehicles.map((v) => <li key={v.id} className="flex items-center justify-between gap-2">{v.runId?<Link href={`/trains/${encodeURIComponent(v.runId)}`} className="font-bold underline">Train {v.trainNumber} · to {v.destination}</Link>:<span className="text-muted-foreground">Vehicle {v.id.split(':').pop()}</span>}<SourceLabel source={v.source} updatedAt={v.updatedAt} /></li>)}
                  </ul>
                )}
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rotate-45 bg-foreground align-middle" />Agency-reported position</span>
                  <span><span className="mr-1.5 inline-block h-3 w-3 rounded-full border border-dashed border-[hsl(var(--community))] align-middle" />Approximate community area</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">Individual riders are never shown. Updated {ago(vehicles[0]?.updatedAt)}.</p>
              </div>
              <TflDetails info={d.route.tfl} />
              {!d.route.tfl&&(d.route.type==='intercity'&&!d.route.transitland?<IntercityModule key={d.route.id} center={center} provider={providerFor(d.route.agencyId, d.route.id)} routeId={d.route.id}/>:<TimetablePanel key={d.route.id} routeId={d.route.id} timezone={d.route.transitland?.timezone} stopOptions={d.route.transitland?d.stops.map(s=>({id:s.id,name:s.name})):d.timetableStops?.map((s) => ({ id: s.id, name: s.name }))} direction={activeDir} color={color} title={activeDir ? `Timetable · ${activeDir}` : 'Timetable'} />)}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
