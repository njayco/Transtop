import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Plus, Minus, LocateFixed } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MapLine, MapStop, MapVehicle } from './transit-map';

const MODE_COLOR: Record<string, string> = { subway: '#2fb36b', bus: '#e5a823', rail: '#a33a62' };

// Coarse, illustrative outline of Manhattan (not survey-accurate).
const MANHATTAN: [number, number][] = [
  [-74.019, 40.7], [-74.0, 40.707], [-73.976, 40.711], [-73.971, 40.727], [-73.972, 40.744], [-73.961, 40.758], [-73.943, 40.775],
  [-73.929, 40.797], [-73.934, 40.835], [-73.921, 40.866], [-73.911, 40.874], [-73.927, 40.879], [-73.947, 40.851], [-73.961, 40.823],
  [-73.99, 40.784], [-74.009, 40.755], [-74.013, 40.729], [-74.019, 40.706],
];

type Props = {
  center: { lat: number; lon: number };
  stops: MapStop[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  shape?: { coords: number[][]; color: string } | null;
  vehicles: MapVehicle[];
  network?: MapLine[];
  onRoute?: (id: string) => void;
  className?: string;
  label: string;
};

const W = 1000, H = 700;
const keyAct = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

function srcText(source: string) {
  const s = source.toLowerCase();
  return s.includes('community') ? 'Approximate community position' : 'Live agency data';
}
function ago(iso?: string) {
  if (!iso) return 'update time unknown';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return Number.isNaN(m) ? 'update time unknown' : m < 1 ? 'updated just now' : `updated ${m} min ago`;
}

export function SchematicMap({ center, stops, activeId, onSelect, shape, vehicles: allVehicles, network, onRoute, className, label }: Props) {
  const vehicles = useMemo(() => allVehicles.filter((v) => !v.source.toLowerCase().includes('demo')), [allVehicles]);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const proj = useMemo(() => {
    const pts: number[][] = [[center.lon, center.lat]];
    stops.forEach((s) => pts.push([s.lon, s.lat]));
    vehicles.forEach((v) => pts.push([v.lon, v.lat]));
    shape?.coords.forEach((c) => pts.push(c));
    // Network lines can be long; frame on stops/center, lines extend beyond and can be panned.
    if (stops.length < 2 && !shape) network?.forEach((l) => l.coords.forEach((c) => pts.push(c)));
    let minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
    let minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
    const pad = 0.004;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const cos = Math.cos((center.lat * Math.PI) / 180);
    const spanX = (maxX - minX) * cos, spanY = maxY - minY;
    const k = Math.min(W / spanX, H / spanY) * 0.9;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return (lon: number, lat: number): [number, number] => [W / 2 + (lon - cx) * cos * k, H / 2 - (lat - cy) * k];
  }, [center.lat, center.lon, stops, vehicles, shape, network]);

  const path = (coords: number[][]) => coords.map((c, i) => { const [x, y] = proj(c[0], c[1]); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  const zoom = (f: number) => setView((v) => {
    const k = Math.min(12, Math.max(0.5, v.k * f));
    const r = k / v.k;
    return { k, x: W / 2 - (W / 2 - v.x) * r, y: H / 2 - (H / 2 - v.y) * r };
  });
  const pan = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  const toSvg = (dx: number) => { const r = svgRef.current?.getBoundingClientRect(); return r ? (dx * W) / r.width : dx; };

  const onDown = (e: RPointerEvent<SVGRectElement>) => { drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y }; (e.target as Element).setPointerCapture(e.pointerId); };
  const onMove = (e: RPointerEvent<SVGRectElement>) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.x + toSvg(e.clientX - d.px), y: d.y + toSvg(e.clientY - d.py) })); };
  const onUp = () => { drag.current = null; };
  const inv = 1 / view.k;
  const showLabels = stops.length <= 14 || view.k >= 1.8;

  return (
    <div className={cn('relative overflow-hidden bg-[#0f0f11]', className)} role="region" aria-label={`${label}, schematic view`} data-testid="map-schematic"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const m: Record<string, () => void> = { '+': () => zoom(1.4), '=': () => zoom(1.4), '-': () => zoom(1 / 1.4), ArrowLeft: () => pan(60, 0), ArrowRight: () => pan(-60, 0), ArrowUp: () => pan(0, 60), ArrowDown: () => pan(0, -60) };
        if (m[e.key]) { e.preventDefault(); m[e.key](); }
      }} tabIndex={0}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full touch-none select-none"
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)}>
        <rect width={W} height={H} fill="#0b0d12" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: 'grab' }} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <path d={`${path(MANHATTAN)}Z`} fill="#18181b" stroke="#2a2a2e" strokeWidth={inv} pointerEvents="none" />
          {network?.map((l) => (
            <g key={l.shapeId ?? l.id} role="button" tabIndex={0} aria-label={`Route ${l.name} details`} onClick={() => onRoute?.(l.id)} onKeyDown={keyAct(() => onRoute?.(l.id))} className="cursor-pointer focus:outline-none">
              <path d={path(l.coords)} fill="none" stroke={l.color} strokeOpacity={0.18} strokeWidth={8 * inv} />
              <path d={path(l.coords)} fill="none" stroke={l.color} strokeWidth={2.5 * inv} strokeLinejoin="miter" />
              <path d={path(l.coords)} fill="none" stroke="transparent" strokeWidth={14 * inv} />
              {l.coords.length > 1 && (() => {
                const c = l.coords[Math.floor(l.coords.length / 2)];
                const [x, y] = proj(c[0], c[1]);
                return <g transform={`translate(${x} ${y}) scale(${inv})`}><rect x={-14} y={-10} width={28} height={20} rx={10} fill={l.color} /><text textAnchor="middle" y={4.5} fontSize={12} fontWeight={800} fill="#fff">{l.name}</text></g>;
              })()}
            </g>
          ))}
          {shape && shape.coords.length > 1 && <path d={path(shape.coords)} fill="none" stroke={shape.color} strokeWidth={3.5 * inv} pointerEvents="none" />}
          {stops.map((s) => {
            const [x, y] = proj(s.lon, s.lat);
            const a = s.id === activeId;
            return (
              <g key={s.id} transform={`translate(${x} ${y}) scale(${inv})`} role="button" tabIndex={0} aria-label={`${s.name} stop`} className="cursor-pointer focus:outline-none"
                onClick={() => onSelect?.(s.id)} onKeyDown={keyAct(() => onSelect?.(s.id))}>
                <circle r={a ? 11 : 7} fill={s.color ?? MODE_COLOR[s.type] ?? '#888'} stroke="#0c0c0d" strokeWidth={3} />
                <circle r={a ? 13 : 8.5} fill="none" stroke={a ? '#f4f1ea' : 'rgba(255,255,255,.35)'} strokeWidth={a ? 2 : 1} />
                {(showLabels || a) && <text x={13} y={4} fontSize={12} fontWeight={a ? 800 : 600} fill="#f4f1ea" stroke="#0b0d12" strokeWidth={3} paintOrder="stroke">{s.name}</text>}
              </g>
            );
          })}
          {vehicles.map((v) => {
            const [x, y] = proj(v.lon, v.lat);
            const src = srcText(v.source);
            const community = src.startsWith('Approx');
            const act = () => v.routeId && onRoute?.(v.routeId);
            return (
              <g key={v.id} transform={`translate(${x} ${y}) scale(${inv})`} role={v.routeId ? 'button' : 'img'} tabIndex={v.routeId ? 0 : undefined}
                aria-label={`${v.routeName ? `Route ${v.routeName} vehicle` : 'Vehicle'}, ${src}, ${ago(v.updatedAt)}`} onClick={act} onKeyDown={keyAct(act)} className="cursor-pointer focus:outline-none">
                <title>{`${v.routeName ? `Route ${v.routeName}` : 'Vehicle'} · ${src} · ${ago(v.updatedAt)}`}</title>
                {community
                  ? <circle r={16} fill="rgba(92,194,242,.15)" stroke="#5cc2f2" strokeDasharray="4 3" strokeWidth={2} />
                  : <rect x={-7} y={-7} width={14} height={14} transform="rotate(45)" fill={v.color ?? '#f4f1ea'} stroke="#f4f1ea" strokeWidth={2} />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-border bg-background/90 px-3 py-1.5 text-xs font-bold" role="status">
        Schematic view · basemap unavailable
        <span className="block text-[10px] font-medium text-muted-foreground">Positions from real coordinates. Shoreline is a rough illustration.</span>
      </div>
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        <button type="button" onClick={() => zoom(1.4)} aria-label="Zoom in" className="flex h-11 w-11 items-center justify-center hover:bg-white/10" data-testid="button-schematic-zoom-in"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out" className="flex h-11 w-11 items-center justify-center border-t border-border hover:bg-white/10" data-testid="button-schematic-zoom-out"><Minus className="h-4 w-4" /></button>
        <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Reset view" className="flex h-11 w-11 items-center justify-center border-t border-border hover:bg-white/10" data-testid="button-schematic-reset"><LocateFixed className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
