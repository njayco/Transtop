import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { LocateFixed, Search, List, Map as MapIcon, X, MapPin, Globe2 } from 'lucide-react';
import { getGetMapVehiclesQueryKey, getGetNetworkQueryKey, getGetStopsQueryKey, useGetAlerts, useGetMapVehicles, useGetNetwork, useGetSources, useGetStops, type GetMapVehiclesParams, type GetNetworkParams, type GetStopsParams } from '@workspace/api-client-react';
import { RegionalMap } from '@/components/regional-map';
import { MobileTop } from '@/components/shell';
import { AlertRow, ErrorState, SkeletonCards, StopCard, TransitLines } from '@/components/transit';
import { TransitMap, vehicleKind } from '@/components/transit-map';
import { RouteBadge } from '@/components/transit';
import { IntercityModule } from '@/components/intercity';
import { TIMES_SQUARE, usePrefs } from '@/lib/prefs';
import { ago } from '@/lib/format';
import { trackedVehicleVisible } from '@/lib/vehicle-visibility';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { MapViewport } from '@/components/transit-map';
import { GlobalCoverageNotice } from '@/components/global-coverage';

const FILTERS = [
  { v: 'all', l: 'All' }, { v: 'subway', l: 'Subway' }, { v: 'bus', l: 'Bus' }, { v: 'rail', l: 'Trains & Commuter Rail' }, { v: 'intercity', l: 'Intercity Bus Network' },
] as const;
type Place = { lat: number; lon: number; label: string } | { q: string; label: string };

export default function Nearby() {
  const isMobile = useIsMobile();
  const { mode } = usePrefs();
  const [, nav] = useLocation();
  const [place, setPlaceRaw] = useState<Place>(TIMES_SQUARE);
  const [provider, setProvider] = useState('');
  const [cursor,setCursor]=useState('');
  const setPlace = (p: Place) => { setPlaceRaw(p); setProvider('');setAgency('');setCursor(''); };
  const [filter, setFilterRaw] = useState<string>('all');
  const [agency, setAgency] = useState('');
  const [svc, setSvc] = useState<'all' | 'local' | 'express'>('all');
  const sources = useGetSources();
  const setFilter = (f: string) => {
    setFilterRaw(f);
    setCursor('');
    setProvider('');
    if (f==='intercity'||agency && !(sources.data ?? []).some((s) => s.id === agency && (f === 'all' || s.type === f))) setAgency('');
    if (f === 'intercity' || f === 'subway') setSvc('all');
  };
  const [view, setView] = useState<'list' | 'map'>('list');
  const [text, setText] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [geo, setGeo] = useState<'idle' | 'explain' | 'asking' | 'denied' | 'unsupported'>('idle');

  const params: GetStopsParams = useMemo(() => ({
    mode,...(cursor?{cursor}:{}), ...(filter !== 'all' ? { type: filter } : {}), ...((filter==='intercity'?provider:agency) ? { agency:filter==='intercity'?provider:agency } : {}), ...(svc !== 'all' ? { serviceClass: svc } : {}),
    ...('q' in place ? { q: place.q } : { lat: place.lat, lon: place.lon }),
  }), [mode, filter, place, agency, provider, svc,cursor]);
  const stops = useGetStops(params, { query: { queryKey: getGetStopsQueryKey(params), refetchInterval: 30_000, retry: 1 } });
  const alerts = useGetAlerts({ mode });
  const list = stops.data?.stops ?? [];
  const agencies = useMemo(() => [...new Map([
    ...(sources.data??[]).map(s=>({id:s.id,agency:s.agency,type:s.type})),
    ...list.flatMap(s=>s.routes.map(r=>({id:r.agencyId||r.id.split(':')[0],agency:r.agency,type:r.type}))),
  ].filter(s=>(filter==='all'?['subway','bus','rail','intercity']:[filter]).includes(s.type||'')).map(s=>[s.id,s])).values()]
    .sort((a,b)=>a.agency.localeCompare(b.agency)),[sources.data,list,filter]);
  const center = stops.data?.centerLat != null && stops.data?.centerLon != null
    ? { lat: stops.data.centerLat, lon: stops.data.centerLon }
    : 'lat' in place ? place : TIMES_SQUARE;
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const onViewport = useCallback((v: MapViewport) => setViewport(p=>{const n={ west: +v.west.toFixed(4), east: +v.east.toFixed(4), south: +v.south.toFixed(4), north: +v.north.toFixed(4), zoom: v.zoom };return p&&JSON.stringify(p)===JSON.stringify(n)?p:n;}), []);
  const netParams: GetNetworkParams = useMemo(() => ({ mode, ...(filter !== 'all' ? { type: filter } : {}), ...((filter==='intercity'?provider:agency) ? { agency:filter==='intercity'?provider:agency } : {}), serviceClass: svc, ...(viewport ?? { lat: center.lat, lon: center.lon, zoom: 14.5 }) }), [mode, filter, agency, provider, svc, viewport, center.lat, center.lon]);
  const networkQ = useGetNetwork(netParams, { query: { queryKey: getGetNetworkQueryKey(netParams), placeholderData: (previous,query) => {
    const old=query?.queryKey[1] as GetNetworkParams|undefined;
    return old?.mode===netParams.mode&&old?.type===netParams.type&&old?.agency===netParams.agency&&old?.serviceClass===netParams.serviceClass?previous:undefined;
  }, staleTime: 60_000, retry: 1 } });
  const mapStops = useMemo(() => (networkQ.data?.stops ?? list).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, type: s.type, routes: s.routes })), [networkQ.data, list]);
  const vParams: GetMapVehiclesParams = useMemo(() => ({ mode,...(viewport??{west:center.lon-.04,east:center.lon+.04,south:center.lat-.03,north:center.lat+.03}) }), [mode,viewport,center.lat,center.lon]);
  const vehQ = useGetMapVehicles(vParams, { query: { queryKey: getGetMapVehiclesQueryKey(vParams), refetchInterval: 30_000, retry: 1 } });
  const [regional, setRegional] = useState(false);
  const network = useMemo(() => ({ isError: networkQ.isError, data: networkQ.data?.lines.filter((l) => (!agency || l.route.id.split(':')[0] === agency || l.route.agencyId===agency) && (svc === 'all' || l.route.serviceClass === svc)) }), [networkQ.isError, networkQ.data, agency, svc]);
  const hoverRoutes = useMemo(() => new Set(list.find((s) => s.id === hover)?.routes.map((r) => r.id) ?? []), [list, hover]);
  const lines = useMemo(() => (network.data ?? []).map((l) => ({ id: l.route.id, shapeId: l.shapeId, type: l.route.type, agency: l.route.agency, name: l.route.name, color: hoverRoutes.size && !hoverRoutes.has(l.route.id) ? '#55555c' : l.route.color, coords: l.shape })), [network.data, hoverRoutes]);
  const legendRoutes = useMemo(() => { const m = new Map<string, NonNullable<typeof network.data>[number]['route']>(); (network.data ?? []).forEach((l) => { if (!m.has(l.route.id)) m.set(l.route.id, l.route); }); return [...m.values()]; }, [network.data]);
  const vehicles = useMemo(() => { const byId = new Map(legendRoutes.map((r) => [r.id, r])); return (vehQ.data ?? [])
    .filter((v) => vehicleKind(v.source) !== 'demo'&&trackedVehicleVisible(v,{
      ...(viewport||{west:center.lon-.1,east:center.lon+.1,south:center.lat-.08,north:center.lat+.08}),type:filter,agency:filter==='intercity'?provider:agency,serviceClass:svc},
       byId.get(v.routeId||''),v.vehicleType||sources.data?.find(s=>s.id===(v.agencyId||v.routeId?.split(':')[0]))?.type))
    .map((v) => ({ ...v, vehicleType:byId.get(v.routeId||'')?.type||v.vehicleType||sources.data?.find(s=>s.id===(v.agencyId||v.routeId?.split(':')[0]))?.type, color: byId.get(v.routeId||'')?.color||v.color||'#1769AA', routeName: byId.get(v.routeId||'')?.name||v.routeName })); }, [vehQ.data, legendRoutes, mode,viewport,center,filter,agency,provider,svc,sources.data]);
  const goRoute = (id: string) => nav(`/routes/${encodeURIComponent(id)}`);
  const legend = (
    <div className="space-y-1.5">
      <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto" aria-label="Routes on map">
        {legendRoutes.map((r) => (
          <button key={r.id} onClick={() => goRoute(r.id)} aria-label={`Route ${r.name} details`} data-testid={`button-map-route-${r.id}`} className="transition-transform hover:scale-110"><RouteBadge name={r.name} color={r.color} size="sm" /></button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Moving badges identify routes. Station reports are labeled “not GPS”; only GPS observations animate. Schedule-only services have no live vehicle marker.{' '}
        {network.isError ? 'Route lines unavailable right now.' : 'Positions refresh every 30 seconds.'}
      </p>
      {networkQ.data?.truncated && <p className="text-xs text-muted-foreground">Map limit reached: zoom in or filter an operator. Not every visible path/stop is shown.</p>}
      <GlobalCoverageNotice data={networkQ.data?.globalCoverage} credits={legendRoutes.map(r=>r.transitland?.attribution)} />
      {(networkQ.data?.missingGeometry.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">Some official route geometry is missing. Open Regional map for coverage details.</p>}
    </div>
  );

  const requestGeo = () => {
    if (!('geolocation' in navigator)) { setGeo('unsupported'); return; }
    setGeo('asking');
    navigator.geolocation.getCurrentPosition(
      (p) => { setPlace({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'Your location' }); setGeo('idle'); },
      () => setGeo('denied'),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q) { setPlace({ q, label: q }); setGeo('idle'); }
  };

  const panel = (
    <div className="space-y-4">
      <form onSubmit={submit} role="search" className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Address, neighborhood, station or route" aria-label="Search a place to see nearby stops"
          data-testid="input-nearby-search" className="h-14 w-full rounded-2xl border border-input bg-card pl-12 pr-24 text-base placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
        <button type="submit" data-testid="button-nearby-go" className="absolute right-2 top-1/2 h-10 -translate-y-1/2 rounded-xl bg-white/10 px-4 text-sm font-bold hover:bg-white/15">Go</button>
      </form>
      <p className="-mt-2 text-xs text-muted-foreground" data-testid="text-search-privacy">Known local stations stay on Transtop. Other place/address searches are sent to Photon/OpenStreetMap; worldwide transit searches use Transitland. You can also enter latitude, longitude. No location permission is required.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setGeo('explain')} data-testid="button-use-location"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-bold text-background transition-transform active:scale-95">
          <LocateFixed className="h-4 w-4" />Use my location
        </button>
        <button onClick={() => setRegional(true)} data-testid="button-open-regional"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-primary/60 px-4 text-sm font-bold text-primary hover:bg-primary/10">
          <Globe2 className="h-4 w-4" />Worldwide map
        </button>
        <button onClick={() => nav('/search')} className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-open-search">
          Find a route or station
        </button>
      </div>
      {geo !== 'idle' && (
        <div className="rise rounded-2xl border border-border bg-card p-4" role="dialog" aria-label="Location permission">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1 text-sm">
              {geo === 'explain' && <>
                <p className="font-bold">Find stops near you</p>
                <p className="mt-1 text-muted-foreground">Your browser will ask to share your location once. Transtop uses it only to sort nearby stops. It is not stored, and it is separate from Ride sharing.</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={requestGeo} data-testid="button-allow-location" className="h-11 rounded-full bg-primary px-5 font-bold text-primary-foreground">Continue</button>
                  <button onClick={() => setGeo('idle')} className="h-11 rounded-full px-4 font-semibold text-muted-foreground hover:text-foreground">Not now</button>
                </div>
              </>}
              {geo === 'asking' && <p aria-live="polite">Waiting for your browser...</p>}
              {(geo === 'denied' || geo === 'unsupported') && <>
                <p className="font-bold">{geo === 'denied' ? 'Location not shared' : 'Location not supported here'}</p>
                <p className="mt-1 text-muted-foreground">No problem. Type an address or neighborhood above, like "Penn Station" or "Jamaica".</p>
              </>}
            </div>
            <button onClick={() => setGeo('idle')} aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      <div role="radiogroup" aria-label="Service filter" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {FILTERS.map((f) => (
          <button key={f.v} role="radio" aria-checked={filter === f.v} onClick={() => setFilter(f.v)} data-testid={`filter-${f.v}`}
            className={cn('h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors', filter === f.v ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground')}>{f.l}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={filter==='intercity'?provider:agency} onChange={(e) => {filter==='intercity'?setProvider(e.target.value):setAgency(e.target.value);setCursor('');}} aria-label="Agency filter" data-testid="select-nearby-agency" className="h-10 max-w-full rounded-xl border border-input bg-card px-3 text-sm">
          <option value="">All agencies</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.agency}</option>)}
        </select>
        {filter !== 'intercity' && <select value={svc} onChange={(e) => setSvc(e.target.value as 'all' | 'local' | 'express')} aria-label="Local or express" data-testid="select-nearby-class" className="h-10 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="all">Local + express</option><option value="local">Local only</option><option value="express">Express only</option>
        </select>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Near</p>
          <h2 className="font-display text-2xl" data-testid="text-place">{place.label}</h2>
        </div>
        {stops.data && <p className="text-right text-xs text-muted-foreground">Updated {ago(stops.data.updatedAt)}</p>}
      </div>
      {stops.data?.message && <p className="rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground" role="status">{stops.data.message}</p>}
      <GlobalCoverageNotice data={stops.data?.globalCoverage} credits={list.flatMap(s=>s.routes.map(r=>r.transitland?.attribution))} onNext={setCursor} onReset={cursor?()=>setCursor(''):undefined} />
    </div>
  );

  const results = (
    <div className="space-y-3" aria-live="polite">
      {stops.isLoading && <SkeletonCards />}
      {stops.isError && <ErrorState onRetry={() => stops.refetch()} detail="Check your connection and try again. Settings shows feed status and agency coverage." />}
      {stops.data && list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="font-display text-xl">No stops found here</p>
          <p className="mt-1 text-sm text-muted-foreground">Coverage may not include this area. Try another neighborhood or clear a filter, and check Settings for agency coverage.</p>
        </div>
      )}
      {stops.data && !provider.startsWith('tl:') && (filter === 'all' || filter === 'intercity') && <div className={filter === 'intercity' ? '' : 'pb-2'}><IntercityModule key={`${center.lat},${center.lon}`} center={center} provider={provider} onProvider={setProvider} compact={filter !== 'intercity'} /></div>}
      {list.map((s, i) => <StopCard key={s.id} stop={s} index={i} active={hover === s.id} onHover={setHover} />)}
      {(alerts.data?.length ?? 0) > 0 && (
        <section className="pt-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Service alerts</h2>
          <div className="space-y-2">{alerts.data!.slice(0, 4).map((a) => <AlertRow key={a.id} alert={a} />)}</div>
        </section>
      )}
    </div>
  );

  if (regional) return (
    <div className="relative">
      <MobileTop />
      <div className="mx-auto max-w-7xl p-4 md:p-6"><RegionalMap initialCenter={center} onClose={() => setRegional(false)} /></div>
    </div>
  );

  return (
    <div className="relative md:grid md:h-[calc(100dvh-65px)] md:grid-cols-[440px_1fr] lg:grid-cols-[500px_1fr]">
      <TransitLines className="absolute inset-x-0 top-0 h-72 w-full opacity-40 md:hidden" />
      <div className="relative md:overflow-y-auto md:border-r md:border-border">
        <MobileTop />
        <div className="space-y-5 p-4 md:p-6">
          {panel}
          <div className="flex justify-end md:hidden">
            <div className="inline-flex rounded-full border border-border bg-card p-0.5" role="tablist" aria-label="View">
              {(['list', 'map'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} data-testid={`button-view-${v}`}
                  className={cn('inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold', view === v ? 'bg-white/10' : 'text-muted-foreground')}>
                  {v === 'list' ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}{v === 'list' ? 'List' : 'Map'}
                </button>
              ))}
            </div>
          </div>
          <div className="md:hidden">
            {view === 'map' && isMobile
              ? <div className="space-y-3"><TransitMap center={center} stops={mapStops} activeId={hover} network={lines} vehicles={vehicles} onViewport={onViewport} onRoute={goRoute} onSelect={(id) => nav(`/stops/${encodeURIComponent(id)}`)} className="h-[52dvh] w-full overflow-hidden rounded-2xl border border-border" /><p className="text-xs text-muted-foreground">Tap a stop for arrivals, or a line for the route. The map follows its viewport; the nearby list stays at your search. Bus paths need zoom 12; stops need zoom 13.</p>{legend}</div>
              : results}
          </div>
          <div className="hidden md:block">{results}</div>
        </div>
      </div>
      {!isMobile && <div className="hidden min-h-0 flex-col md:flex">
        <TransitMap center={center} stops={mapStops} activeId={hover} network={lines} vehicles={vehicles} onViewport={onViewport} onRoute={goRoute} onSelect={(id) => nav(`/stops/${encodeURIComponent(id)}`)} className="min-h-0 w-full flex-1" />
        <div className="shrink-0 border-t border-border bg-background p-3">{legend}<p className="mt-1 text-xs text-muted-foreground">Map follows the viewport. Nearby list stays at your search. Bus paths: zoom 12+; stops: zoom 13+.</p></div>
      </div>}
    </div>
  );
}
