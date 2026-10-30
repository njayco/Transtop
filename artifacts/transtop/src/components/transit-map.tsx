import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps';
import { SchematicMap } from './schematic-map';
import { MODE_COLOR } from './transit';
import { DARK_ROADMAP } from '@/lib/map-style';

export type MapStop = { id: string; name: string; lat: number; lon: number; type: string; color?: string; label?: boolean; routes?: {id:string;name:string;color:string}[] };
export type MapVehicle = { id: string; lat: number; lon: number; source: string; updatedAt?: string; color?: string; routeId?: string; routeName?: string };
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
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const libraries = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
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
    const age = v.updatedAt ? clock - new Date(v.updatedAt).getTime() : Infinity;
    return vehicleKind(v.source) !== 'official' || Number.isFinite(age) && age <= 60000 && age >= -30000;
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
    const m = map.current;
    if (!m || !ready || failed) return;
    const paths: google.maps.Polyline[] = [];
    const listeners: google.maps.MapsEventListener[] = [];
    for (const line of network ?? []) {
      if (line.coords.length < 2) continue;
      const path = line.coords.map(([lng, lat]) => ({ lat, lng }));
      paths.push(new google.maps.Polyline({ map: m, path, strokeColor: MODE_COLOR[line.type ?? ''] ?? line.color, strokeWeight: 9, strokeOpacity: 0.4, clickable: false, zIndex: 1 }));
      const visible = new google.maps.Polyline({ map: m, path, strokeColor: line.color, strokeWeight: line.type === 'rail' ? 5 : 3, strokeOpacity: line.type === 'bus' ? .35 : .95, zIndex: line.type === 'subway' ? 3 : 2,
        icons: line.type === 'bus' ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 }, offset: '0', repeat: '14px' }] : undefined });
      paths.push(visible);
      listeners.push(visible.addListener('click', () => callbacks.current.onRoute?.(line.id)));
    }
    if (shape && shape.coords.length > 1) {
      const path = shape.coords.map(([lng, lat]) => ({ lat, lng }));
      paths.push(new google.maps.Polyline({ map: m, path, strokeColor: shape.color, strokeWeight: 11, strokeOpacity: 0.2, clickable: false, zIndex: 3 }));
      paths.push(new google.maps.Polyline({ map: m, path, strokeColor: shape.color, strokeWeight: 4, strokeOpacity: 1, clickable: false, zIndex: 4 }));
    }
    return () => {
      listeners.forEach((l) => l.remove());
      paths.forEach((p) => p.setMap(null));
    };
  }, [network, shape, ready, failed]);

  // Fit only when route geometry changes, not on each vehicle refresh.
  useEffect(() => {
    if (!map.current || !ready || failed || !shape || shape.coords.length < 2) return;
    if (lastShapeFit.current === shape) return;
    lastShapeFit.current = shape;
    const bounds = new google.maps.LatLngBounds();
    shape.coords.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
    map.current.fitBounds(bounds, 48);
  }, [shape, ready, failed]);

  useEffect(() => {
    const m = map.current, libs = libraries.current;
    if (!m || !libs || !ready || failed) return;
    const [{ InfoWindow }, { Marker }] = libs;
    const popup = new InfoWindow();
    const markers: google.maps.Marker[] = [];
    const listeners: google.maps.MapsEventListener[] = [];
    for (const [index, s] of stops.entries()) {
      const active = s.id === activeId;
      const color = s.color ?? MODE_COLOR[s.type] ?? '#888';
      const marker = new Marker({ map: m, position: { lat: s.lat, lng: s.lon }, title: `${s.name} stop${s.routes?.length ? ` · ${s.routes.map(r => r.name).join(', ')}` : ''}`,
        zIndex: active ? 100 : 20, optimized: false,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: labelStops ? 12 : active ? 11 : 7, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: active ? 3 : 1.5 },
        label: labelStops ? { text: String(index + 1), color: '#111', fontSize: '11px', fontWeight: '800' } : s.label || active ? { text: s.name, color: '#fff', fontSize: '12px', className: 'map-stop-label' } : undefined });
      listeners.push(marker.addListener('click', () => {
        const content = document.createElement('div');
        content.style.cssText = 'color:#111;font:600 13px Arial,sans-serif;max-width:240px';
        const name = document.createElement('p'); name.textContent = s.name; content.append(name);
        if (s.routes?.length) { const lines = document.createElement('p'); lines.textContent = `Lines: ${s.routes.map(r => r.name).join(', ')}`; content.append(lines); }
        if (callbacks.current.onSelect) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Select stop for details';
          button.style.cssText = 'text-decoration:underline;padding:8px 0'; button.onclick = () => callbacks.current.onSelect?.(s.id); content.append(button);
        }
        popup.setContent(content); popup.open({ map: m, anchor: marker });
        callbacks.current.onSelect?.(s.id);
      }));
      markers.push(marker);
    }
    for (const v of visibleVehicles) {
      const kind = vehicleKind(v.source), color = v.color ?? '#f4f1ea';
      const age = v.updatedAt ? Date.now() - new Date(v.updatedAt).getTime() : Infinity;
      if (kind === 'official' && (!Number.isFinite(age) || age > 60000 || age < -30000)) continue;
      const title = `${v.routeName ? `Route ${v.routeName} vehicle` : 'Vehicle'} · ${sourceText(v.source)} · ${agoText(v.updatedAt)}`;
      const marker = new Marker({ map: m, position: { lat: v.lat, lng: v.lon }, title, zIndex: 40,
        icon: { path: kind === 'community' ? google.maps.SymbolPath.CIRCLE : 'M 0,-8 8,0 0,8 -8,0 z',
          scale: kind === 'community' ? 14 : 1, fillColor: color, fillOpacity: kind === 'community' ? .15 : 1,
          strokeColor: kind === 'community' ? '#5cc2f2' : '#fff', strokeWeight: 2 } });
      listeners.push(marker.addListener('click', () => {
        const content = document.createElement('div');
        content.style.cssText = 'color:#111;font:600 13px Arial,sans-serif;max-width:240px;';
        const text = document.createElement('p');
        text.textContent = title;
        content.append(text);
        if (v.routeId) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'View route';
          button.style.cssText = 'text-decoration:underline;padding:8px 0;cursor:pointer;';
          button.onclick = () => callbacks.current.onRoute?.(v.routeId!);
          content.append(button);
        }
        popup.setContent(content);
        popup.open({ map: m, anchor: marker });
      }));
      markers.push(marker);
    }
    return () => {
      popup.close();
      listeners.forEach((l) => l.remove());
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [stops, visibleVehicles, activeId, ready, failed, labelStops]);

  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      <div className="relative min-h-0 w-full flex-1" role="region" aria-label={`${label} · Google Maps`} data-testid="google-map" data-map-status={failed ? 'error' : tilesReady ? 'tiles-ready' : 'loading'}>
        <div ref={el} className={failed ? 'invisible h-full w-full' : 'h-full w-full'} />
        {failed && !googleOnly && <div className="absolute inset-0"><SchematicMap center={center} stops={stops} activeId={activeId} onSelect={onSelect} shape={shape} vehicles={visibleVehicles} network={network} onRoute={onRoute} className="h-full w-full" label={label} /></div>}
        {!tilesReady && !failed && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-[#151515]/95 p-3 text-sm text-white" role="status">Loading Google map tiles…</div>}
      </div>
      {failed && <div className="relative z-10 max-h-[60%] shrink-0 overflow-y-auto rounded-lg border border-white/20 bg-black p-3 text-xs text-white" role="alert">
        <p className="break-words">{failure} {googleOnly ? '' : 'Schematic only — not the Google basemap. Lists and schedules remain available.'}</p>
        <button type="button" className="mt-2 min-h-11 rounded-lg border border-white/30 px-4 font-bold" onClick={() => { setReady(false); setTilesReady(false); setFailure(null); setAttempt(a => a + 1); }}>Retry Google Maps</button>
        {authenticationFailed && <button type="button" className="ml-3 min-h-11 underline" onClick={() => window.location.reload()}>Reload after fixing access</button>}
      </div>}
    </div>
  );
}
