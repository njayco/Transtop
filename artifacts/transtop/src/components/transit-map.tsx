import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { SchematicMap } from './schematic-map';
import { MODE_COLOR } from './transit';

export type MapStop = { id: string; name: string; lat: number; lon: number; type: string; color?: string };
export type MapVehicle = { id: string; lat: number; lon: number; source: string; updatedAt?: string; color?: string; routeId?: string; routeName?: string };
export type MapLine = { id: string; name: string; color: string; coords: number[][] };

export function vehicleKind(source: string): 'official' | 'demo' | 'community' {
  const s = source.toLowerCase();
  if (s.includes('demo')) return 'demo';
  if (s.includes('community')) return 'community';
  return 'official';
}
function sourceText(source: string) {
  const k = vehicleKind(source);
  return k === 'demo' ? 'Demo data' : k === 'community' ? 'Approximate community position' : source.toLowerCase() === 'live' ? 'Live agency data' : source;
}
function agoText(iso?: string) {
  if (!iso) return 'update time unknown';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(m)) return 'update time unknown';
  return m < 1 ? 'updated just now' : `updated ${m} min ago`;
}

const STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

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

export function TransitMap({ center, stops = [], activeId, onSelect, shape, vehicles = [], network, onRoute, zoom = 14.5, className, label = 'Transit map' }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;
  const popup = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: el.current, style: STYLE_URL, center: [center.lon, center.lat], zoom, attributionControl: { compact: true } });
    } catch {
      setFailed(true);
      return;
    }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const timer = window.setTimeout(() => { if (!m.isStyleLoaded()) setFailed(true); }, 12000);
    m.on('load', () => { window.clearTimeout(timer); setReady(true); });
    m.on('error', (e: unknown) => { if (!m.isStyleLoaded() && (e as { error?: { status?: number } }).error) setFailed(true); });
    return () => { window.clearTimeout(timer); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const reduce = document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) map.current?.jumpTo({ center: [center.lon, center.lat] });
    else map.current?.easeTo({ center: [center.lon, center.lat], duration: 600 });
  }, [center.lat, center.lon]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !network) return;
    const src = 'network';
    const data = {
      type: 'FeatureCollection' as const,
      features: network.filter((l) => l.coords.length > 1).map((l) => ({
        type: 'Feature' as const, properties: { id: l.id, name: l.name, color: l.color },
        geometry: { type: 'LineString' as const, coordinates: l.coords },
      })),
    };
    const existing = m.getSource(src) as maplibregl.GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }
    m.addSource(src, { type: 'geojson', data });
    m.addLayer({ id: 'network-glow', type: 'line', source: src, paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': 0.14, 'line-blur': 4 } });
    m.addLayer({ id: 'network-line', type: 'line', source: src, layout: { 'line-join': 'miter' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.9 } });
    m.addLayer({ id: 'network-hit', type: 'line', source: src, paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 } });
    try {
      m.addLayer({ id: 'network-label', type: 'symbol', source: src, layout: { 'symbol-placement': 'line', 'symbol-spacing': 280, 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Open Sans Bold'] }, paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 2.5 } });
    } catch { /* style without glyphs: lines still drawn, legend lists names */ }
    const click = (e: maplibregl.MapLayerMouseEvent) => { const id = e.features?.[0]?.properties?.id; if (id) onRouteRef.current?.(String(id)); };
    m.on('click', 'network-hit', click);
    m.on('click', 'network-label', click);
    m.on('mouseenter', 'network-hit', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'network-hit', () => { m.getCanvas().style.cursor = ''; });
  }, [network, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const id = 'route-shape';
    if (m.getLayer(id)) m.removeLayer(id);
    if (m.getLayer(`${id}-glow`)) m.removeLayer(`${id}-glow`);
    if (m.getSource(id)) m.removeSource(id);
    if (shape && shape.coords.length > 1) {
      m.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: shape.coords } } });
      m.addLayer({ id: `${id}-glow`, type: 'line', source: id, paint: { 'line-color': shape.color, 'line-width': 10, 'line-opacity': 0.18, 'line-blur': 4 } });
      m.addLayer({ id, type: 'line', source: id, paint: { 'line-color': shape.color, 'line-width': 3.5 }, layout: { 'line-join': 'miter', 'line-cap': 'butt' } });
      const b = new maplibregl.LngLatBounds();
      shape.coords.forEach((c) => b.extend([c[0], c[1]] as [number, number]));
      m.fitBounds(b, { padding: 48, duration: 0 });
    }
  }, [shape, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    stops.forEach((s) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.setAttribute('aria-label', `${s.name} stop`);
      const active = s.id === activeId;
      const c = s.color ?? MODE_COLOR[s.type] ?? '#888';
      node.style.cssText = `width:${active ? 26 : 16}px;height:${active ? 26 : 16}px;border-radius:999px;background:${c};border:${active ? 4 : 3}px solid #0c0c0d;box-shadow:0 0 0 ${active ? 2 : 1}px ${active ? '#f4f1ea' : 'rgba(255,255,255,.35)'};cursor:pointer;transition:width .2s,height .2s;`;
      node.onclick = () => onSelectRef.current?.(s.id);
      markers.current.push(new maplibregl.Marker({ element: node }).setLngLat([s.lon, s.lat]).addTo(m));
    });
    vehicles.forEach((v) => {
      const kind = vehicleKind(v.source);
      const label = `${v.routeName ? `Route ${v.routeName} vehicle` : 'Vehicle'}, ${sourceText(v.source)}, ${agoText(v.updatedAt)}`;
      const node = document.createElement(v.routeId ? 'button' : 'div');
      if (node instanceof HTMLButtonElement) node.type = 'button';
      node.setAttribute('aria-label', label);
      const c = v.color ?? '#f4f1ea';
      node.style.cssText = kind === 'community'
        ? 'width:34px;height:34px;border-radius:999px;border:2px dashed #5cc2f2;background:rgba(92,194,242,.15);cursor:pointer;padding:0;'
        : `width:14px;height:14px;transform:rotate(45deg);background:${c};border:2px solid ${kind === 'demo' ? '#f5b82e' : '#f4f1ea'};box-shadow:0 0 10px ${c};cursor:pointer;padding:0;`;
      const show = () => {
        popup.current?.remove();
        popup.current = new maplibregl.Popup({ closeButton: false, offset: 14, className: 'tt-popup' })
          .setLngLat([v.lon, v.lat])
          .setHTML(`<div style="font:600 12px Archivo,sans-serif;color:#111">${v.routeName ? `Route ${v.routeName}` : 'Vehicle'}<br><span style="font-weight:700;color:${kind === 'demo' ? '#a06d00' : kind === 'community' ? '#1b6f99' : '#1d7a47'}">${sourceText(v.source)}</span><br><span style="font-weight:500">${agoText(v.updatedAt)}</span></div>`)
          .addTo(m);
      };
      node.addEventListener('mouseenter', show);
      node.addEventListener('focus', show);
      node.addEventListener('mouseleave', () => popup.current?.remove());
      node.addEventListener('blur', () => popup.current?.remove());
      if (v.routeId) node.addEventListener('click', () => onRouteRef.current?.(v.routeId!));
      markers.current.push(new maplibregl.Marker({ element: node }).setLngLat([v.lon, v.lat]).addTo(m));
    });
  }, [stops, vehicles, activeId, ready]);

  if (failed) return <SchematicMap center={center} stops={stops} activeId={activeId} onSelect={onSelect} shape={shape} vehicles={vehicles} network={network} onRoute={onRoute} className={className} label={label} />;
  return <div ref={el} role="region" aria-label={label} className={className} data-testid="map" />;
}
