import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps';
import { SchematicMap } from './schematic-map';
import { MODE_COLOR } from './transit';
import { DARK_ROADMAP } from '@/lib/map-style';
import { useLocation } from 'wouter';
import { vehicleFresh } from '@/lib/vehicle-visibility';
import { MapOverlays } from '@/lib/map-overlays';

export type MapStop = { id: string; name: string; lat: number; lon: number; type: string; color?: string; label?: boolean; routes?: {id:string;name:string;color:string}[] };
export type MapVehicle = { id: string; lat: number; lon: number; source: string; updatedAt?: string; color?: string; routeId?: string; routeName?: string;agencyId?:string;vehicleType?:string;trainNumber?:string;destination?:string;runId?:string;expiresAt?:string };
export type MapLine = { id: string; name: string; color: string; coords: number[][]; shapeId?: string; type?: string; agency?: string };
export type MapBounds = { west: number; south: number; east: number; north: number };
export type MapViewport = MapBounds & { zoom: number };

export function vehicleKind(source: string): 'official' | 'demo' | 'community' {
  const s = source.toLowerCase();
  return s.includes('demo') ? 'demo' : s.includes('community') ? 'community' : 'official';
}
function sourceText(source: string) {
  const k = vehicleKind(source);
  return k === 'community' ? 'Approximate community position' : source.toLowerCase() === 'live' ? 'Live agency data' : source;
}
function agoText(iso?: string) {
  const minutes = iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : NaN;
  return Number.isNaN(minutes) ? 'update time unknown' : minutes < 1 ? 'updated just now' : `updated ${minutes} min ago`;
}

type Props = {
  center: { lat: number; lon: number };
  stops?: MapStop[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  shape?: { coords: number[][]; color: string } | null;
  vehicles?: MapVehicle[];
  network?: MapLine[];
  onRoute?: (id: string) => void;
  zoom?: number;
  className?: string;
  label?: string;
  googleOnly?: boolean;
  onViewport?: (viewport: MapViewport) => void;
  fitBounds?: MapBounds;
  fitKey?: number;
  labelStops?: boolean;
};

// One shared auth-error notification for all map instances (Nearby, stop and route).
type MapsWindow = Window & { gm_authFailure?: () => void };
let authHookInstalled = false;
let authenticationFailed = false;
function installAuthHook() {
  if (authHookInstalled) return;
  authHookInstalled = true;
  const w = window as MapsWindow;
  const previous = w.gm_authFailure;
  w.gm_authFailure = () => {
    authenticationFailed = true;
    window.dispatchEvent(new Event('transtop:maps-auth-failure'));
    previous?.();
  };
}

export function TransitMap({ center, stops = [], activeId, onSelect, shape, vehicles = [], network, onRoute, zoom = 14.5, className, label = 'Transit map', googleOnly = false, onViewport, fitBounds, fitKey, labelStops = false }: Props) {
  const [,navigate]=useLocation();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const libraries = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
  const layers = useRef<MapOverlays | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!vehicles.length) return;
    const id = window.setInterval(() => setClock(Date.now()), 10000);
    return () => window.clearInterval(id);
  }, [vehicles.length]);
  const visibleVehicles = useMemo(() => vehicles.filter(v => {
    if (vehicleKind(v.source) === 'demo') return false;
    return vehicleKind(v.source) !== 'official' || vehicleFresh(v,clock);
  }), [vehicles, clock]);
  const failed = failure !== null;
  const callbacks = useRef({ onSelect, onRoute, onViewport });
  callbacks.current = { onSelect, onRoute, onViewport };
  const camera = useRef({ center, zoom });
  const lastCenter = useRef(center);
  const lastRegionFit = useRef<string | null>(null);
  const lastShapeFit = useRef<Props['shape']>(null);

  useEffect(() => {
    if (!el.current) return;
    let disposed = false;
    const listeners: google.maps.MapsEventListener[] = [];
    let resize: ResizeObserver | undefined;
    let loaded = false;
    let viewportTimer: number | undefined;
    let timer: number | undefined;
    const fail = (message: string) => { if (!disposed) setFailure(message); };
    const authFail = () => fail(`Google rejected map authorization. Enable Maps JavaScript API and billing, and allow ${window.location.origin} in the browser key’s website restrictions. After correcting access, reload this page. Never share your key.`);
    const offline = () => fail('You are offline. Reconnect to load the Google basemap; schedules already loaded remain available below.');
    const online = () => { if (!authenticationFailed) { setReady(false); setTilesReady(false); setFailure(null); setAttempt(a => a + 1); } };
    // Watch the initial load only. Panning, zooming and resize can change bounds
    // using cached tiles without a corresponding new tilesloaded event. Never
    // invalidate a verified basemap or replace it with a schematic for that.
    timer = window.setTimeout(() => { if (!loaded) fail('Google map tiles have not arrived. Check your connection, content blocker, Maps JavaScript API authorization and billing, then retry.'); }, 20000);
    window.addEventListener('transtop:maps-auth-failure', authFail);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    installAuthHook();
    if (authenticationFailed) authFail();
    else if (!navigator.onLine) offline();
    else void loadGoogleMaps().then((libs) => {
      if (disposed || !el.current) return;
      libraries.current = libs;
      const [{ Map, RenderingType }] = libs;
      // Raster also works without WebGL, unlike the previous MapLibre basemap.
      const m = new Map(el.current, {
        center: { lat: camera.current.center.lat, lng: camera.current.center.lon },
        zoom: camera.current.zoom,
        renderingType: RenderingType.RASTER,
        // Embedded dark styles work on raster without a cloud map ID or WebGL.
        // Advanced markers require a map ID; use supported classic markers here.
        styles: DARK_ROADMAP,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
        gestureHandling: 'cooperative',
      });
      map.current = m;
      const reportRendering = () => { if (el.current) el.current.dataset.renderingType = m.getRenderingType(); };
      listeners.push(m.addListener('renderingtype_changed', reportRendering));
      reportRendering();
      const rememberCamera = () => {
        const c = m.getCenter(), z = m.getZoom();
        if (c && z != null) camera.current = { center: { lat: c.lat(), lon: c.lng() }, zoom: z };
      };
      listeners.push(m.addListener('bounds_changed', rememberCamera));
      listeners.push(m.addListener('tilesloaded', () => {
        loaded = true;
        window.clearTimeout(timer);
        if (!disposed && !authenticationFailed && navigator.onLine) { setTilesReady(true); setFailure(null); }
      }));
      listeners.push(m.addListener('idle', () => {
        rememberCamera();
        window.clearTimeout(viewportTimer);
        viewportTimer = window.setTimeout(() => {
          const bounds = m.getBounds(), z = m.getZoom();
          if (disposed || !bounds || z == null) return;
          const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
          callbacks.current.onViewport?.({ west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat(), zoom: z });
        }, 350);
      }));
      // Overlays may be mounted before tiles arrive, but loading remains visible.
      if (!authenticationFailed) setReady(true);
      resize = new ResizeObserver(() => google.maps.event.trigger(m, 'resize'));
      resize.observe(el.current);
    }).catch((error: unknown) => fail(error instanceof Error && error.message === 'Google Maps key is not configured'
      ? 'Google Maps browser configuration is missing. Set VITE_GOOGLE_MAPS_API_KEY securely and restart the preview or rebuild the client. Schedules and lists still work.'
      : 'Google Maps SDK could not load. Check your connection or content blocker and retry. Schedules and lists still work.'));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(viewportTimer);
      window.removeEventListener('transtop:maps-auth-failure', authFail);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      resize?.disconnect();
      listeners.forEach((l) => l.remove());
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (!map.current || !ready || !fitBounds) return;
    const key = `${fitBounds.west},${fitBounds.south},${fitBounds.east},${fitBounds.north}|${fitKey ?? ''}`;
    if (lastRegionFit.current === key) return;
    lastRegionFit.current = key;
    map.current.fitBounds({ west: fitBounds.west, east: fitBounds.east, south: fitBounds.south, north: fitBounds.north }, 32);
  }, [fitBounds, fitKey, ready, attempt]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || failed) return;
    if (fitBounds) return;
    if (lastCenter.current.lat === center.lat && lastCenter.current.lon === center.lon) return;
    lastCenter.current = center;
    const c = { lat: center.lat, lng: center.lon };
    const reduce = document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) m.setCenter(c); else m.panTo(c);
  }, [center.lat, center.lon, ready, failed, fitBounds]);

  useEffect(() => {
    const m=map.current,libs=libraries.current;
    if(!m||!libs||!ready||failed)return;
    const controller=new MapOverlays(m,libs[1].Marker,libs[0].InfoWindow,
      id=>callbacks.current.onSelect?.(id),id=>callbacks.current.onRoute?.(id),
      id=>navigate(`/trains/${encodeURIComponent(id)}`));
    layers.current=controller;
    return()=>{controller.dispose();if(layers.current===controller)layers.current=null;};
  },[ready,failed,attempt]);

  useEffect(()=>{layers.current?.setLines(network??[],shape);},[network,shape,ready,failed,attempt]);
  useEffect(()=>{layers.current?.setStops(stops,activeId,labelStops);},[stops,activeId,labelStops,ready,failed,attempt]);
  useEffect(()=>{layers.current?.setVehicles(visibleVehicles);},[visibleVehicles,ready,failed,attempt]);

  // Fit only when route geometry changes, not on each vehicle refresh.
  useEffect(() => {
    if (!map.current || !ready || failed || !shape || shape.coords.length < 2) return;
    if (lastShapeFit.current && lastShapeFit.current.color===shape.color&&JSON.stringify(lastShapeFit.current.coords)===JSON.stringify(shape.coords)) return;
    lastShapeFit.current = shape;
    const bounds = new google.maps.LatLngBounds();
    shape.coords.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
    map.current.fitBounds(bounds, 48);
  }, [shape, ready, failed]);

  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      <div className="relative min-h-0 w-full flex-1" role="region" aria-label={`${label} · Google Maps`} data-testid="google-map" data-map-status={failed ? 'error' : tilesReady ? 'tiles-ready' : 'loading'}>
        <div ref={el} className={failed ? 'invisible h-full w-full' : 'h-full w-full'} />
        {failed && !googleOnly && <div className="absolute inset-0"><SchematicMap center={center} stops={stops} activeId={activeId} onSelect={onSelect} shape={shape} vehicles={visibleVehicles} network={network} onRoute={onRoute} className="h-full w-full" label={label} /></div>}
        {!tilesReady && !failed && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-[#151515]/95 p-3 text-sm text-white" role="status">Loading Google map tiles…</div>}
        {(vehicles.some(v=>v.agencyId==='amtrak')||network?.some(l=>l.id.startsWith('amtrak:')))&&
          <a href="https://amtraker.com" target="_blank" rel="noreferrer" className="absolute bottom-8 right-2 z-10 rounded bg-black/85 px-2 py-1 text-[10px] text-white underline">Train reports © Amtraker · ODC-By</a>}
      </div>
      {failed && <div className="relative z-10 max-h-[60%] shrink-0 overflow-y-auto rounded-lg border border-white/20 bg-black p-3 text-xs text-white" role="alert">
        <p className="break-words">{failure} {googleOnly ? '' : 'Schematic only — not the Google basemap. Lists and schedules remain available.'}</p>
        <button type="button" className="mt-2 min-h-11 rounded-lg border border-white/30 px-4 font-bold" onClick={() => { setReady(false); setTilesReady(false); setFailure(null); setAttempt(a => a + 1); }}>Retry Google Maps</button>
        {authenticationFailed && <button type="button" className="ml-3 min-h-11 underline" onClick={() => window.location.reload()}>Reload after fixing access</button>}
      </div>}
    </div>
  );
}
