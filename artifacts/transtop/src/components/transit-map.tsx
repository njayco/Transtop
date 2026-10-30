import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps';
import { SchematicMap } from './schematic-map';
import { MODE_COLOR } from './transit';

export type MapStop = { id: string; name: string; lat: number; lon: number; type: string; color?: string };
export type MapVehicle = { id: string; lat: number; lon: number; source: string; updatedAt?: string; color?: string; routeId?: string; routeName?: string };
export type MapLine = { id: string; name: string; color: string; coords: number[][] };

export function vehicleKind(source: string): 'official' | 'demo' | 'community' {
  const s = source.toLowerCase();
  return s.includes('demo') ? 'demo' : s.includes('community') ? 'community' : 'official';
}
function sourceText(source: string) {
  const k = vehicleKind(source);
  return k === 'demo' ? 'Demo data' : k === 'community' ? 'Approximate community position' : source.toLowerCase() === 'live' ? 'Live agency data' : source;
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

export function TransitMap({ center, stops = [], activeId, onSelect, shape, vehicles = [], network, onRoute, zoom = 14.5, className, label = 'Transit map' }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const libraries = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onSelect, onRoute });
  callbacks.current = { onSelect, onRoute };
  const initial = useRef({ center, zoom });

  useEffect(() => {
    if (failed || !el.current) return;
    let disposed = false;
    const listeners: google.maps.MapsEventListener[] = [];
    let resize: ResizeObserver | undefined;
    let loaded = false;
    const fail = () => { if (!disposed) setFailed(true); };
    const timer = window.setTimeout(() => { if (!loaded) fail(); }, 20000);
    window.addEventListener('transtop:maps-auth-failure', fail);
    installAuthHook();
    if (authenticationFailed) fail();
    else void loadGoogleMaps().then((libs) => {
      if (disposed || !el.current) return;
      libraries.current = libs;
      const [{ Map, RenderingType }] = libs;
      // Raster also works without WebGL, unlike the previous MapLibre basemap.
      const m = new Map(el.current, {
        center: { lat: initial.current.center.lat, lng: initial.current.center.lon },
        zoom: initial.current.zoom,
        mapId: (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID',
        renderingType: RenderingType.RASTER,
        colorScheme: google.maps.ColorScheme.DARK,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
        gestureHandling: 'cooperative',
      });
      map.current = m;
      listeners.push(m.addListener('tilesloaded', () => {
        loaded = true;
        window.clearTimeout(timer);
        if (!disposed && !authenticationFailed) setReady(true);
      }));
      // Overlays may be mounted before tiles arrive, but loading remains visible.
      if (!authenticationFailed) setReady(true);
      resize = new ResizeObserver(() => google.maps.event.trigger(m, 'resize'));
      resize.observe(el.current);
    }).catch(fail);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener('transtop:maps-auth-failure', fail);
      resize?.disconnect();
      listeners.forEach((l) => l.remove());
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, [failed]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || failed) return;
    const c = { lat: center.lat, lng: center.lon };
    const reduce = document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) m.setCenter(c); else m.panTo(c);
  }, [center.lat, center.lon, ready, failed]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || failed) return;
    const paths: google.maps.Polyline[] = [];
    const listeners: google.maps.MapsEventListener[] = [];
    for (const line of network ?? []) {
      if (line.coords.length < 2) continue;
      const path = line.coords.map(([lng, lat]) => ({ lat, lng }));
      paths.push(new google.maps.Polyline({ map: m, path, strokeColor: line.color, strokeWeight: 9, strokeOpacity: 0.18, clickable: false, zIndex: 1 }));
      const visible = new google.maps.Polyline({ map: m, path, strokeColor: line.color, strokeWeight: 3, strokeOpacity: 0.95, zIndex: 2 });
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
    const bounds = new google.maps.LatLngBounds();
    shape.coords.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
    map.current.fitBounds(bounds, 48);
  }, [shape, ready, failed]);

  useEffect(() => {
    const m = map.current, libs = libraries.current;
    if (!m || !libs || !ready || failed) return;
    const [{ InfoWindow }, { AdvancedMarkerElement }] = libs;
    const popup = new InfoWindow();
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const listeners: google.maps.MapsEventListener[] = [];
    for (const s of stops) {
      const active = s.id === activeId;
      const color = s.color ?? MODE_COLOR[s.type] ?? '#888';
      const dot = document.createElement('div');
      dot.style.cssText = `width:${active ? 26 : 17}px;height:${active ? 26 : 17}px;border-radius:50%;background:${color};border:3px solid #111;box-shadow:0 0 0 ${active ? 3 : 1}px #fff;`;
      const marker = new AdvancedMarkerElement({ map: m, position: { lat: s.lat, lng: s.lon }, title: `${s.name} stop`, zIndex: active ? 100 : 20 });
      marker.append(dot);
      listeners.push(marker.addListener('click', () => callbacks.current.onSelect?.(s.id)));
      markers.push(marker);
    }
    for (const v of vehicles) {
      const kind = vehicleKind(v.source), color = v.color ?? '#f4f1ea';
      const title = `${v.routeName ? `Route ${v.routeName} vehicle` : 'Vehicle'} · ${sourceText(v.source)} · ${agoText(v.updatedAt)}`;
      const dot = document.createElement('div');
      dot.style.cssText = kind === 'community'
        ? 'width:34px;height:34px;border-radius:50%;border:2px dashed #5cc2f2;background:rgba(92,194,242,.15);'
        : `width:17px;height:17px;transform:rotate(45deg);background:${color};border:2px solid ${kind === 'demo' ? '#f5b82e' : '#fff'};box-shadow:0 0 8px ${color};`;
      const marker = new AdvancedMarkerElement({ map: m, position: { lat: v.lat, lng: v.lon }, title, zIndex: 40 });
      marker.append(dot);
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
      markers.forEach((marker) => { marker.map = null; });
    };
  }, [stops, vehicles, activeId, ready, failed]);

  if (failed) return (
    <div className={`relative ${className ?? ''}`}>
      <SchematicMap center={center} stops={stops} activeId={activeId} onSelect={onSelect} shape={shape} vehicles={vehicles} network={network} onRoute={onRoute} className="h-full w-full" label={label} />
      <p className="absolute bottom-8 left-3 right-3 rounded-lg border border-white/10 bg-black/90 px-3 py-2 text-xs text-white" role="status">
        Google Maps could not load. Check connectivity, billing, Maps JavaScript API access and allowed website domains. Stops and routes remain available in this schematic and the list.
      </p>
    </div>
  );
  return (
    <div className={`relative ${className ?? ''}`} role="region" aria-label={`${label} · Google Maps`} data-testid="google-map">
      <div ref={el} className="h-full w-full" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center bg-[#151515] text-sm text-white" role="status">Loading Google Maps…</div>}
    </div>
  );
}
