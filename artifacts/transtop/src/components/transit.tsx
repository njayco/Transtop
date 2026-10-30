import { Link } from 'wouter';
import { Bus, BusFront, TrainFront, TrainFrontTunnel, Heart, AlertTriangle, Accessibility, RefreshCw, WifiOff } from 'lucide-react';
import type { Alert, Arrival, Stop } from '@workspace/api-client-react';
import { SOURCE_LABEL, ago, arrivalText, distance, severityTone, statusTone, textOn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { honest, usePrefs } from '@/lib/prefs';
import { useFreshArrivals } from '@/lib/amtrak-arrivals';

export const MODE_COLOR: Record<string, string> = { subway: '#2fb36b', bus: '#e5a823', rail: '#a33a62', intercity: '#e0662f' };
export const MODE_NAME: Record<string, string> = { subway: 'Subway', bus: 'Bus', rail: 'Commuter Rail', intercity: 'Intercity Bus Network' };

export function ModeIcon({ type, size = 40, className }: { type: string; size?: number; className?: string }) {
  const Icon = type === 'bus' ? Bus : type === 'intercity' ? BusFront : type === 'rail' ? TrainFront : TrainFrontTunnel;
  return (
    <span role="img" aria-label={MODE_NAME[type] ?? type} className={cn('inline-flex shrink-0 items-center justify-center rounded-full text-white', className)}
      style={{ width: size, height: size, background: MODE_COLOR[type] ?? '#555' }}>
      <Icon style={{ width: size * 0.52, height: size * 0.52 }} strokeWidth={2.2} aria-hidden />
    </span>
  );
}

export function RouteBadge({ name, color, size = 'md', className }: { name: string; color: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const short = name.length <= 2;
  const dims = size === 'sm' ? 'h-6 min-w-6 text-[12px]' : size === 'lg' ? 'h-12 min-w-12 text-[22px]' : 'h-8 min-w-8 text-[15px]';
  return (
    <span aria-label={`Route ${name}`} className={cn('inline-flex shrink-0 items-center justify-center font-extrabold leading-none tracking-tight', short ? 'rounded-full' : 'rounded-md px-1.5', dims,
      name.length > 12 && 'h-auto min-h-8 max-w-[9rem] whitespace-normal break-words py-1 text-center text-sm leading-tight', className)}
      style={{ background: color, color: textOn(color) }}>{name}</span>
  );
}

const TONE: Record<string, string> = {
  ok: 'text-[hsl(var(--ok))]', warn: 'text-[hsl(var(--warn))]', bad: 'text-[hsl(var(--bad))]', neutral: 'text-muted-foreground',
};
export function StatusText({ status, className }: { status: string; className?: string }) {
  if (!status) return null;
  return <span className={cn('text-xs font-semibold', TONE[statusTone(status)], className)}>{status}</span>;
}

const SRC: Record<string, string> = {
  live: 'border-[hsl(var(--live)/.5)] text-[hsl(var(--live))]',
  community: 'border-[hsl(var(--community)/.5)] text-[hsl(var(--community))] border-dashed',
  scheduled: 'border-[hsl(var(--scheduled)/.4)] text-[hsl(var(--scheduled))]',
  unavailable: 'border-border text-muted-foreground',
};
export function SourceLabel({ source, updatedAt, className }: { source: string; updatedAt?: string | null; className?: string }) {
  if (source.toLowerCase().includes('demo')) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', SRC[source] ?? SRC.unavailable, className)}
      data-testid={`label-source-${source}`}>
      {source === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-current pulse-dot" aria-hidden />}
      {SOURCE_LABEL[source] ?? source}
      {updatedAt && <span className="font-medium normal-case tracking-normal opacity-75">· {ago(updatedAt)}</span>}
    </span>
  );
}

export function Countdown({ a, big }: { a: Arrival; big?: boolean }) {
  const text = arrivalText(a);
  const due = a.minutes <= 0 && a.source !== 'unavailable';
  return (
    <span className={cn('tabular font-bold leading-none whitespace-nowrap', big ? 'text-3xl' : 'text-xl', due ? 'text-primary' : 'text-foreground')}
      aria-label={`${a.routeName} ${text}${a.confidence ? `, ${a.confidence} confidence` : ''}`}>{text}</span>
  );
}

export function FavButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} aria-pressed={active}
      aria-label={active ? `Remove ${label} from favorites` : `Save ${label} to favorites`} data-testid="button-favorite"
      className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/5 active:scale-95', active ? 'text-accent' : 'text-muted-foreground')}>
      <Heart className={cn('h-5 w-5 transition-transform', active && 'fill-current scale-110')} />
    </button>
  );
}

export function AlertRow({ alert }: { alert: Alert }) {
  const tone = severityTone(alert.severity);
  return (
    <div className={cn('flex gap-3 rounded-xl border bg-card p-3.5', tone === 'bad' ? 'border-[hsl(var(--bad)/.45)]' : tone === 'warn' ? 'border-[hsl(var(--warn)/.4)]' : 'border-card-border')}
      role="note" data-testid={`alert-${alert.id}`}>
      <AlertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0', TONE[tone])} aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold leading-snug">
          <span className={cn('mr-2 text-[11px] font-bold uppercase tracking-wider', TONE[tone])}>{tone === 'bad' ? 'Major' : tone === 'warn' ? 'Delays' : 'Notice'}</span>
          {alert.title}
        </p>
        {alert.description && <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>}
        <p className="mt-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/80">Source: {SOURCE_LABEL[alert.source] ?? alert.source}</p>
      </div>
    </div>
  );
}

export function StopCard({ stop, active, onHover, index = 0 }: { stop: Stop; active?: boolean; onHover?: (id: string | null) => void; index?: number }) {
  const { mode, isFavStop, toggleStop } = usePrefs();
  const arrivals = honest(useFreshArrivals(stop.arrivals), mode).slice(0, 3);
  const updated = arrivals[0]?.updatedAt ?? stop.updatedAt;
  const sources = Array.from(new Set(arrivals.map((a) => a.source)));
  return (
    <Link href={`/stops/${encodeURIComponent(stop.id)}`} data-testid={`card-stop-${stop.id}`}
      onMouseEnter={() => onHover?.(stop.id)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(stop.id)}
      className={cn('rise group block rounded-2xl border bg-card p-4 transition-colors hover:border-white/25', active ? 'border-primary/70' : 'border-card-border')}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <div className="flex items-start gap-3">
        <ModeIcon type={stop.type} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold leading-tight tracking-tight">{stop.name}</h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {stop.agency} · {distance(stop.distance)} · {stop.walkingMinutes} min walk
            {stop.accessible && <Accessibility className="ml-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-label="Accessible station" />}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {stop.routes.slice(0, 10).map((r) => <RouteBadge key={r.id} name={r.name} color={r.color} size="sm" />)}
          </div>
          {stop.transitland&&<p className="mt-2 text-xs text-muted-foreground">Transitland · {stop.transitland.attribution} · source {stop.transitland.fetchedAt.slice(0,10)||'date unknown'}. Open for availability and source details.</p>}
        </div>
        <FavButton active={isFavStop(stop.id)} onClick={() => toggleStop(stop)} label={stop.name} />
      </div>
      <div className="mt-3 divide-y divide-white/5 border-t border-white/5">
        {arrivals.length === 0 && (
          <p className="pt-3 text-sm text-muted-foreground">No official predictions, community estimates or scheduled departures available right now.</p>
        )}
        {arrivals.map((a) => (
          <div key={a.id} className="flex items-center gap-3 py-2.5">
            <RouteBadge name={a.routeName} color={a.color} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{a.destination}</p>
              <p className="truncate text-xs text-muted-foreground">{a.direction} <StatusText status={a.status} className="ml-1" /></p>
            </div>
            <Countdown a={a} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {sources.map((s) => <SourceLabel key={s} source={s} />)}
        <span className="text-[11px] text-muted-foreground">Updated {ago(updated)}</span>
        {stop.alerts.length > 0 && <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--warn))]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{stop.alerts.length} alert{stop.alerts.length > 1 ? 's' : ''}</span>}
      </div>
    </Link>
  );
}

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading arrivals">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-card-border bg-card p-4">
          <div className="flex gap-3"><div className="skel h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><div className="skel h-4 w-2/3" /><div className="skel h-3 w-1/2" /></div></div>
          <div className="mt-4 space-y-3"><div className="skel h-5" /><div className="skel h-5" /></div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title = 'Could not load arrivals', detail, onRetry }: { title?: string; detail?: string; onRetry?: () => void }) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <div className="rounded-2xl border border-[hsl(var(--bad)/.35)] bg-card p-5" role="alert">
      <div className="flex items-center gap-2 font-bold">{offline ? <WifiOff className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5 text-[hsl(var(--bad))]" />}{offline ? 'You are offline' : title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{offline ? 'Arrivals need a connection. Nothing shown here will be presented as current until you reconnect.' : detail ?? 'The Transtop server did not respond. Your saved favorites still work.'}</p>
      {onRetry && <button onClick={onRetry} data-testid="button-retry" className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 text-sm font-semibold hover:bg-white/15"><RefreshCw className="h-4 w-4" />Try again</button>}
    </div>
  );
}

/** Thin right-angle transit lines, decorative. */
export function TransitLines({ className, animate = true }: { className?: string; animate?: boolean }) {
  return (
    <svg aria-hidden className={cn('pointer-events-none', animate && 'line-draw', className)} viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" fill="none" strokeWidth="2.2" strokeLinejoin="miter">
      <path d="M340 -10V170H560V-10" stroke="#f5b82e" />
      <path d="M-10 270H140V400H40V610H380" stroke="#e8467c" opacity=".85" />
      <path d="M90 -10V520H330V820" stroke="#3a8de0" opacity=".7" />
      <path d="M610 380H250V560H470V820" stroke="#e8467c" opacity=".6" />
      <path d="M-10 690H200V820" stroke="#2fb36b" opacity=".8" />
      <path d="M180 -10V230H610" stroke="#f26b2b" opacity=".55" />
      <path d="M520 820V640H610" stroke="#2fb36b" opacity=".55" />
      <path d="M40 820V730H610" stroke="#9aa3ad" opacity=".3" />
    </svg>
  );
}
