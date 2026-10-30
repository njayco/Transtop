import { useCallback, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Crosshair, Info, Layers, Search, X } from 'lucide-react';
import {
  getGetMapVehiclesQueryKey, getGetNetworkQueryKey, useGetMapVehicles, useGetNetwork, useGetSources,
  type GetMapVehiclesParams, type GetNetworkParams,
} from '@workspace/api-client-react';
import { TransitMap, vehicleKind } from '@/components/transit-map';
import { MODE_COLOR, MODE_NAME, RouteBadge } from '@/components/transit';
import { usePrefs } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { amtrakVisible } from '@/lib/vehicle-visibility';

export const REGION_BOUNDS = { west: -74.27, south: 40.48, east: -71.75, north: 42.15 };
const REGION_CENTER = { lat: 41.32, lon: -73.01 };
const REGION_ZOOM = 8;
const MODES = ['subway', 'bus', 'rail', 'intercity'] as const;
type Mode = (typeof MODES)[number];
type Viewport = { west: number; south: number; east: number; north: number; zoom: number };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function RegionalMap({ onClose }: { onClose?: () => void }) {
  const { mode } = usePrefs();
  const [vp, setVp] = useState<Viewport>({ ...REGION_BOUNDS, zoom: REGION_ZOOM });
  const [modes, setModes] = useState<Set<Mode>>(new Set(MODES));
  const [agency, setAgency] = useState('');
  const [svc, setSvc] = useState<'all' | 'local' | 'express'>('all');
  const [legendQ, setLegendQ] = useState('');
  const [selLine, setSelLine] = useState<string | null>(null);
  const [selStop, setSelStop] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(1);
  const [showCoverage, setShowCoverage] = useState(false);

  const onViewport = useCallback((v: Viewport) => {
    setVp((p) => {
      const n = { west: r3(v.west), south: r3(v.south), east: r3(v.east), north: r3(v.north), zoom: Math.round(v.zoom) };
      return p.west === n.west && p.south === n.south && p.east === n.east && p.north === n.north && p.zoom === n.zoom ? p : n;
    });
  }, []);

  const single = modes.size === 1 ? [...modes][0] : null;
  const params: GetNetworkParams = useMemo(() => ({
    mode, ...(single ? { type: single } : {}), ...(agency ? { agency } : {}), ...(svc !== 'all' ? { serviceClass: svc } : {}),
    west: vp.west, south: vp.south, east: vp.east, north: vp.north, zoom: vp.zoom,
  }), [mode, single, agency, svc, vp]);
  const net = useGetNetwork(params, { query: { queryKey: getGetNetworkQueryKey(params), staleTime: 60_000, refetchInterval: 300_000, retry: 1 } });
  const vParams: GetMapVehiclesParams = useMemo(() => ({ mode }), [mode]);
  const veh = useGetMapVehicles(vParams, { query: { queryKey: getGetMapVehiclesQueryKey(vParams), refetchInterval: 30_000, retry: 1 } });
  const sources = useGetSources();

  const data = net.data;
  const busZoom = data?.busDetailZoom ?? 12;
  const stopsZoom = data?.stopsZoom ?? 13;
  const shownLines = useMemo(() => (data?.lines ?? []).filter((l) => modes.has(l.route.type as Mode)), [data, modes]);
  const routeIndex = useMemo(() => {
    const m = new Map<string, (typeof shownLines)[number]['route']>();
    shownLines.forEach((l) => { if (!m.has(l.route.id)) m.set(l.route.id, l.route); });
    return m;
  }, [shownLines]);
  const legend = useMemo(() => {
    const q = legendQ.trim().toLowerCase();
    return [...routeIndex.values()]
      .filter((r) => !q || `${r.name} ${r.longName ?? ''} ${r.agency} ${MODE_NAME[r.type]}`.toLowerCase().includes(q))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [routeIndex, legendQ]);

  const mapLines = useMemo(() => shownLines.map((l) => ({
    id: l.route.id, name: l.route.name, shapeId: l.shapeId, type: l.route.type, agency: l.route.agency, coords: l.shape,
    color: selLine && selLine !== l.route.id ? '#3d3d44' : l.route.color,
  })), [shownLines, selLine]);
  const shownStops = useMemo(() => (data?.stops ?? []).filter((s) => modes.has(s.type as Mode)), [data, modes]);
  const mapStops = useMemo(() => shownStops.map((s) => ({
    id: s.id, name: s.name, lat: s.lat, lon: s.lon, type: s.type,
    label: vp.zoom >= 15, routes: s.routes.map((r) => ({ id: r.id, name: r.name, color: r.color })),
  })), [shownStops, vp.zoom]);
  const vehicles = useMemo(() => (veh.data ?? [])
    .filter((v) => vehicleKind(v.source) !== 'demo'&&(v.agencyId==='amtrak'?
      modes.has('rail')&&amtrakVisible(v,{...vp,agency,serviceClass:svc,routeId:selLine||undefined}):routeIndex.has(v.routeId||'')))
    .map((v) => { const r = routeIndex.get(v.routeId||''); return { ...v, color: r?.color||'#CAE4F1', routeName: r?.name||v.routeName }; }), [veh.data, routeIndex,modes,vp,agency,svc,selLine]);

  const line = selLine ? routeIndex.get(selLine) ?? (data?.lines.find((l) => l.route.id === selLine)?.route) : undefined;
  const stop = selStop ? shownStops.find((s) => s.id === selStop) : undefined;
  const agencies = useMemo(() => (sources.data ?? []).filter((s) => modes.has(s.type as Mode)).sort((a, b) => a.agency.localeCompare(b.agency)), [sources.data, modes]);
  const toggle = (m: Mode) => {
    const n = new Set(modes); if (n.has(m)) { if (n.size > 1) n.delete(m); } else n.add(m);
    setModes(n);
    if (agency && !(sources.data ?? []).some((s) => s.id === agency && n.has(s.type as Mode))) setAgency('');
  };
  const pickLine = (id: string) => { setSelLine((p) => (p === id ? null : id)); setSelStop(null); };
  const pickStop = (id: string) => { setSelStop(id); setSelLine(null); };

  const hints: string[] = [];
  if (modes.has('bus') && vp.zoom < busZoom) hints.push(`Zoom in to level ${busZoom} to draw bus paths.`);
  if (vp.zoom < stopsZoom) hints.push(`Zoom in to level ${stopsZoom} to show stops and stations.`);

  return (
    <section className="space-y-4" aria-label="Regional transit map" data-testid="section-regional-map">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Regional map</p>
          <h2 className="font-display text-2xl md:text-3xl">NYC, Long Island and Connecticut</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFitKey((k) => k + 1)} data-testid="button-fit-region" className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold hover:bg-white/5"><Crosshair className="h-4 w-4" />Fit region</button>
          {onClose && <button onClick={onClose} data-testid="button-close-regional" className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-bold text-background"><X className="h-4 w-4" />Back to nearby</button>}
        </div>
      </div>


      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Modes shown" className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <button key={m} aria-pressed={modes.has(m)} onClick={() => toggle(m)} data-testid={`toggle-mode-${m}`}
              className={cn('inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors', modes.has(m) ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground')}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: MODE_COLOR[m] }} aria-hidden />{MODE_NAME[m]}
            </button>
          ))}
        </div>
        <select value={agency} onChange={(e) => setAgency(e.target.value)} aria-label="Operator filter" data-testid="select-regional-agency" className="h-10 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="">All operators</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.agency}</option>)}
        </select>
        <select value={svc} onChange={(e) => setSvc(e.target.value as 'all' | 'local' | 'express')} aria-label="Local or express" data-testid="select-regional-class" className="h-10 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="all">Local + express</option><option value="local">Local only</option><option value="express">Express only</option>
        </select>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-2">
          <div className="relative">
            <TransitMap center={REGION_CENTER} zoom={REGION_ZOOM} network={mapLines} stops={mapStops} vehicles={vehicles} activeId={selStop}
              onRoute={pickLine} onSelect={pickStop} onViewport={onViewport} fitBounds={REGION_BOUNDS} fitKey={fitKey}
              label="Regional transit map" className="h-[58dvh] min-h-[340px] w-full overflow-hidden rounded-2xl border border-border lg:h-[620px]" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span data-testid="text-regional-counts">
              {net.isLoading ? 'Loading network...' : net.isError ? 'Route lines unavailable right now.' : `${routeIndex.size} routes from ${mapLines.length} of ${data?.totalLines ?? 0} path shapes, ${shownStops.length} of ${data?.totalStops ?? 0} stops in view`}
              {net.isFetching && !net.isLoading ? ' · updating' : ''}
            </span>
            <span>Zoom {vp.zoom} · vehicles refresh every 30 s</span>
          </div>
          {net.isError && <button onClick={() => net.refetch()} className="h-10 rounded-full border border-border px-4 text-sm font-semibold" data-testid="button-regional-retry">Retry</button>}
          {hints.length > 0 && <p className="rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground" data-testid="text-zoom-hint">{hints.join(' ')}</p>}
          {data?.truncated && <p role="status" className="rounded-xl border border-[hsl(var(--warn))]/50 bg-[hsl(var(--warn))]/10 px-3 py-2 text-sm" data-testid="text-truncated">Not every path or stop in this area is drawn (map limit reached). Zoom in, pick a single mode, or filter by operator to see the rest.</p>}
          {(data?.missingGeometry.length ?? 0) > 0 && (
            <details className="rounded-xl border border-border bg-card/60 px-3 py-2 text-sm" data-testid="details-missing-geometry">
              <summary className="cursor-pointer font-semibold">{data!.missingGeometry.length} route{data!.missingGeometry.length > 1 ? 's' : ''} missing some or all official path geometry</summary>
              <div className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {data!.missingGeometry.map((r) => <Link key={r.id} href={`/routes/${encodeURIComponent(r.id)}`} aria-label={`Route ${r.name} details`}><RouteBadge name={r.name} color={r.color} size="sm" /></Link>)}
              </div>
            </details>
          )}
          {data?.message && <p className="text-xs text-muted-foreground">{data.message}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rotate-45 bg-foreground align-middle" />Official vehicle position</span>
            <span><span className="mr-1.5 inline-block h-3 w-3 rounded-full border-2 border-foreground align-middle" />Stop or station at its published location</span>
          </div>
          <p className="text-xs text-muted-foreground">Mode outlines: green subway, purple commuter rail (wide line), gold bus (dashed). Intercity Bus Network boarding points appear as orange stops; no road paths are drawn for them. Inner colors follow the operator’s published line colors. Express classification comes from the published route metadata; other commuter bus classifications are not inferred.</p>
          {veh.isError && <p className="text-xs text-muted-foreground" role="status">Vehicle feed unavailable. Old positions expire automatically; static paths are still routes, not live vehicles.</p>}
        </div>

        <aside className="min-w-0 space-y-3">
          {line && (
            <div className="rise rounded-2xl border border-card-border bg-card p-4" data-testid="card-selected-line">
              <div className="flex items-start gap-3">
                <RouteBadge name={line.name} color={line.color} size="lg" className="max-w-[7rem] text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{line.longName || `Route ${line.name}`}</p>
                  <p className="text-sm text-muted-foreground">{MODE_NAME[line.type]} · {line.agency}{line.serviceClass === 'express' ? ' · Express' : ''}</p>
                </div>
                <button onClick={() => setSelLine(null)} aria-label="Clear selection" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>
              </div>
              <Link href={`/routes/${encodeURIComponent(line.id)}`} data-testid="link-selected-route" className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground">Route details<ArrowRight className="h-4 w-4" /></Link>
            </div>
          )}
          {stop && (
            <div className="rise rounded-2xl border border-card-border bg-card p-4" data-testid="card-selected-stop">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{MODE_NAME[stop.type] ?? stop.type} stop</p>
                  <p className="font-display text-xl">{stop.name}</p>
                </div>
                <button onClick={() => setSelStop(null)} aria-label="Clear stop" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">{stop.routes.map((r) => <button key={r.id} onClick={() => pickLine(r.id)} aria-label={`Highlight route ${r.name}`}><RouteBadge name={r.name} color={r.color} size="sm" /></button>)}</div>
              <Link href={`/stops/${encodeURIComponent(stop.id)}`} data-testid="link-selected-stop" className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground">Arrivals<ArrowRight className="h-4 w-4" /></Link>
            </div>
          )}

          <div className="rounded-2xl border border-card-border bg-card p-3">
            <div className="flex items-center gap-2 px-1 pb-2"><Layers className="h-4 w-4 text-muted-foreground" /><p className="text-sm font-bold">Lines in view</p><span className="ml-auto text-xs text-muted-foreground tabular">{legend.length}</span></div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input value={legendQ} onChange={(e) => setLegendQ(e.target.value)} placeholder="Filter lines" aria-label="Filter lines in legend" data-testid="input-legend-search" className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none" />
            </div>
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto" aria-label="Legend">
              {net.isLoading && [0, 1, 2, 3].map((i) => <li key={i} className="skel h-9" />)}
              {!net.isLoading && legend.length === 0 && <li className="px-2 py-4 text-center text-sm text-muted-foreground">{legendQ ? 'No lines match.' : 'No lines drawn here at this zoom.'}</li>}
              {legend.slice(0, 200).map((r) => (
                <li key={r.id}>
                  <button onClick={() => pickLine(r.id)} aria-pressed={selLine === r.id} data-testid={`button-legend-${r.id}`}
                    className={cn('flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-white/5', selLine === r.id && 'bg-white/10')}>
                    <RouteBadge name={r.name} color={r.color} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm">{r.agency}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{MODE_NAME[r.type]}{r.serviceClass === 'express' ? ' · Exp' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {shownStops.length > 0 && (
            <div className="rounded-2xl border border-card-border bg-card p-3">
              <p className="px-1 pb-2 text-sm font-bold">Stops on the map <span className="font-normal text-muted-foreground">({shownStops.length})</span></p>
              <ul className="max-h-56 space-y-0.5 overflow-y-auto" aria-label="Stops rendered on map">
                {shownStops.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => pickStop(s.id)} aria-pressed={selStop === s.id} data-testid={`button-map-stop-${s.id}`}
                      className={cn('flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-white/5', selStop === s.id && 'bg-white/10')}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MODE_COLOR[s.type] ?? '#888' }} aria-hidden />
                      <span className="truncate">{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-card-border bg-card p-3 text-sm">
            <button onClick={() => setShowCoverage((v) => !v)} aria-expanded={showCoverage} data-testid="button-coverage" className="flex min-h-[40px] w-full items-center gap-2 px-1 text-left font-bold">
              <Info className="h-4 w-4 text-muted-foreground" />Coverage and operators
            </button>
            <p className="px-1 text-xs text-muted-foreground">Only the operators listed here are mapped. Other services in the region are not shown.</p>
            {showCoverage && (
              <ul className="mt-2 space-y-1.5" data-testid="list-coverage">
                {sources.isLoading && <li className="skel h-8" />}
                {agencies.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 rounded-lg px-1 py-1">
                    <span className="min-w-0 truncate">{s.agency}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', s.status === 'ok' || s.status === 'live' ? 'bg-[hsl(var(--ok))]' : 'bg-[hsl(var(--warn))]')} />
                      {s.status}{s.routeCount != null ? ` · ${s.routeCount} routes` : ''}{s.stopCount != null ? ` · ${s.stopCount} stops` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
