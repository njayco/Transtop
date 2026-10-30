import { useEffect, useMemo, useState } from 'react';
import { useSearch } from 'wouter';
import { Radio, ShieldCheck, Square, Check, Search, AlertTriangle } from 'lucide-react';
import { getGetRouteQueryKey, getGetStopQueryKey, getGetStopsQueryKey, useGetRoute, useGetStop, useGetStops, useStartRide, type ReportInputKind } from '@workspace/api-client-react';
import { MobileTop } from '@/components/shell';
import { ModeIcon, RouteBadge, SourceLabel, TransitLines } from '@/components/transit';
import { usePrefs } from '@/lib/prefs';
import { beginRide, pendingEndCount, report, retryPendingEnds, stopRide, useActiveRide, useShareState } from '@/lib/ride';
import { ago, clock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export default function RidePage() {
  const ride = useActiveRide();
  return (
    <div className="mx-auto max-w-2xl">
      <MobileTop />
      <div className="p-4 md:p-8">{ride ? <ActiveRide /> : <RideSetup />}</div>
    </div>
  );
}

function RideSetup() {
  const { mode } = usePrefs();
  const { toast } = useToast();
  const sp = new URLSearchParams(useSearch());
  const [stopId, setStopId] = useState<string | null>(sp.get('stop'));
  const [routeId, setRouteId] = useState<string | null>(sp.get('route'));
  const [direction, setDirection] = useState<string | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [q, setQ] = useState('');
  const [started, setStarted] = useState(false);
  const [pending, setPending] = useState(pendingEndCount());

  const sParams = { q, mode };
  const search = useGetStops(sParams, { query: { queryKey: getGetStopsQueryKey(sParams), enabled: q.trim().length >= 2 && !stopId } });
  const stopParams = { mode };
  const stop = useGetStop(stopId ?? '', stopParams, { query: { queryKey: getGetStopQueryKey(stopId ?? '', stopParams), enabled: !!stopId } });
  const rParams = { mode };
  const route = useGetRoute(routeId ?? '', rParams, { query: { queryKey: getGetRouteQueryKey(routeId ?? '', rParams), enabled: !!routeId } });
  const routeObj = stop.data?.routes.find((r) => r.id === routeId) ?? route.data?.route;
  const trips = useMemo(() => (stop.data?.arrivals ?? []).filter((a) => a.routeId === routeId && a.direction === direction && a.tripId && a.source !== (mode === 'live' ? 'demo' : '')), [stop.data, routeId, direction, mode]);
  const start = useStartRide();
  useEffect(() => { setDirection(null); setTripId(null); }, [routeId]);

  const canStart = !!(stop.data && routeObj && direction && consent && 'geolocation' in navigator);
  const go = () => {
    if (!canStart || !stop.data || !routeObj || !direction) return;
    start.mutate({ data: { agency: routeObj.id.split(':')[0], routeId: routeObj.id, direction, stopId: stop.data.id, ...(tripId ? { tripId } : {}), consent: true, mode } }, {
      onSuccess: (r) => {
        setStarted(true);
        beginRide({ id: r.id, token: r.token, expiresAt: r.expiresAt, mode, routeId: routeObj.id, routeName: routeObj.name, routeColor: routeObj.color, direction, stopId: stop.data!.id, stopName: stop.data!.name, agency: routeObj.agency, startedAt: new Date().toISOString() });
      },
      onError: () => toast({ title: 'Could not start sharing', description: 'Nothing was shared. Check your connection and try again.' }),
    });
  };

  const step = (n: number, title: string, done: boolean) => (
    <div className="flex items-center gap-3">
      <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold', done ? 'bg-[hsl(var(--live))] text-black' : 'border border-border text-muted-foreground')}>{done ? <Check className="h-4 w-4" /> : n}</span>
      <h2 className="text-lg font-bold">{title}</h2>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-6">
        <TransitLines className="absolute inset-0 h-full w-full opacity-25" />
        <div className="relative">
          <Radio className="h-8 w-8 text-[hsl(var(--community))]" />
          <h1 className="mt-3 font-display text-4xl">I'm on board</h1>
          <p className="mt-2 max-w-md text-muted-foreground">Optional. While this page is open, your phone can anonymously help estimate arrivals for riders waiting down the line.</p>
          {mode === 'demo' && <p className="mt-3"><SourceLabel source="demo" /> <span className="ml-1 text-xs text-muted-foreground">Contributions in Demo mode are marked demo and never mix with live data.</span></p>}
        </div>
      </div>
      {pending > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--warn)/.4)] bg-card p-4 text-sm" role="status">
          <AlertTriangle className="h-5 w-5 text-[hsl(var(--warn))]" />
          <p className="flex-1">Sharing stopped on this device. The server has not confirmed it yet; Transtop will retry.</p>
          <button onClick={async () => setPending(await retryPendingEnds())} className="h-10 rounded-full bg-white/10 px-4 font-semibold" data-testid="button-retry-end">Retry</button>
        </div>
      )}

      <section className="space-y-3">
        {step(1, 'Boarding stop', !!stop.data)}
        {stop.data ? (
          <div className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-3">
            <ModeIcon type={stop.data.type} size={36} />
            <div className="flex-1"><p className="font-bold">{stop.data.name}</p><p className="text-xs text-muted-foreground">{stop.data.agency}</p></div>
            <button onClick={() => { setStopId(null); setRouteId(null); }} className="h-10 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-change-stop">Change</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your boarding stop" aria-label="Search boarding stop" data-testid="input-ride-stop"
                className="h-14 w-full rounded-2xl border border-input bg-card pl-12 pr-4 focus:border-primary focus:outline-none" />
            </div>
            {stopId && stop.isLoading && <div className="skel h-14" />}
            {(search.data?.stops ?? []).slice(0, 6).map((s) => (
              <button key={s.id} onClick={() => setStopId(s.id)} className="flex w-full items-center gap-3 rounded-2xl border border-card-border bg-card p-3 text-left hover:border-white/25" data-testid={`button-pick-stop-${s.id}`}>
                <ModeIcon type={s.type} size={32} /><span className="flex-1 font-semibold">{s.name}</span><span className="flex gap-1">{s.routes.slice(0, 5).map((r) => <RouteBadge key={r.id} name={r.name} color={r.color} size="sm" />)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {stop.data && (
        <section className="rise space-y-3">
          {step(2, 'Route', !!routeObj)}
          <div className="flex flex-wrap gap-2">
            {stop.data.routes.map((r) => (
              <button key={r.id} onClick={() => setRouteId(r.id)} aria-pressed={routeId === r.id} data-testid={`button-pick-route-${r.id}`}
                className={cn('flex h-14 items-center gap-2 rounded-2xl border px-3 transition-colors', routeId === r.id ? 'border-foreground bg-white/10' : 'border-card-border bg-card')}>
                <RouteBadge name={r.name} color={r.color} /><span className="text-sm text-muted-foreground">{r.agency}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {routeObj && (
        <section className="rise space-y-3">
          {step(3, 'Direction', !!direction)}
                    <div className="flex flex-wrap gap-2">
            {(routeObj.type === 'rail' ? ['Outbound', 'Inbound'] : ['Uptown', 'Downtown']).map((d) => (
              <button key={d} onClick={() => { setDirection(d); setTripId(null); }} aria-pressed={direction === d} data-testid={`button-pick-direction-${d}`}
                className={cn('h-12 rounded-full border px-5 font-semibold', direction === d ? 'border-foreground bg-foreground text-background' : 'border-border')}>{d}</button>
            ))}
          </div>
          {direction && trips.length === 0 && <p className="text-sm text-muted-foreground">No specific trip can be identified right now. You can still share; Transtop only publishes an estimate once a trip is reliably matched.</p>}
          {direction && trips.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Which train or bus are you on? Optional, skip if unsure.</p>
              {trips.slice(0, 3).map((t) => (
                <button key={t.id} onClick={() => setTripId(tripId === t.tripId ? null : t.tripId!)} aria-pressed={tripId === t.tripId} data-testid={`button-pick-trip-${t.id}`}
                  className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left', tripId === t.tripId ? 'border-foreground bg-white/10' : 'border-card-border bg-card')}>
                  <RouteBadge name={t.routeName} color={t.color} size="sm" /><span className="flex-1 text-sm">to {t.destination}</span><span className="tabular text-sm">{clock(t.scheduledAt)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {direction && (
        <section className="rise space-y-3">
          {step(4, 'Your consent', consent)}
          <div className="space-y-3 rounded-2xl border border-[hsl(var(--community)/.4)] bg-card p-5 text-sm">
            <div className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-[hsl(var(--community))]" />
              <ul className="space-y-2 text-muted-foreground">
                <li><b className="text-foreground">What:</b> your phone's location, accuracy and time, only while this page is open in the foreground.</li>
                <li><b className="text-foreground">Why:</b> to estimate where this {routeObj?.type === 'bus' ? 'bus' : 'train'} is, combined with other riders before anything is published, at reduced precision.</li>
                <li><b className="text-foreground">Who sees it:</b> no one. You are never shown on a map. The session is pseudonymous and raw samples are deleted within 24 hours.</li>
                <li><b className="text-foreground">When it ends:</b> when you tap Stop sharing, close this tab, or the session expires. Browsers may pause location in the background; Transtop does not track you in the background.</li>
              </ul>
            </div>
            <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl bg-white/5 p-3 font-semibold">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--community))]" data-testid="checkbox-consent" />
              I agree to share my location for this ride only.
            </label>
            <p className="text-xs text-muted-foreground">This is separate from the Nearby location option. Your browser will ask for permission next.</p>
          </div>
          <button onClick={go} disabled={!canStart || start.isPending || started} data-testid="button-start-sharing"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--community))] text-lg font-extrabold text-black transition-opacity disabled:opacity-40">
            <Radio className="h-5 w-5" />{start.isPending ? 'Starting...' : 'Start sharing'}
          </button>
          {!('geolocation' in navigator) && <p className="text-sm text-[hsl(var(--bad))]">This browser does not support location, so Ride mode is unavailable.</p>}
        </section>
      )}
    </div>
  );
}

const REPORTS: { kind: ReportInputKind; label: string }[] = [
  { kind: 'arrived', label: 'Arrived' }, { kind: 'departed', label: 'Departed' }, { kind: 'delayed', label: 'Delayed' },
];
const CROWD: { kind: ReportInputKind; label: string }[] = [
  { kind: 'low', label: 'Low' }, { kind: 'medium', label: 'Medium' }, { kind: 'high', label: 'High' },
];

function ActiveRide() {
  const ride = useActiveRide()!;
  const share = useShareState();
  const { toast } = useToast();
  const [sent, setSent] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 15_000); return () => window.clearInterval(t); }, []);
  const rParams = { mode: ride.mode, direction: ride.direction };
  const route = useGetRoute(ride.routeId, rParams, { query: { queryKey: getGetRouteQueryKey(ride.routeId, rParams) } });
  const stops = route.data?.stops ?? [];
  const idx = stops.findIndex((s) => s.id === ride.stopId);
  const upcoming = idx >= 0 ? stops.slice(idx + 1) : [];
  const minsLeft = Math.max(0, Math.round((new Date(ride.expiresAt).getTime() - Date.now()) / 60000));

  const stop = async () => {
    const r = await stopRide('user');
    toast({ title: 'Sharing stopped', description: r === 'revoked' ? 'Your ride session was revoked.' : 'Stopped on this device. Server confirmation will retry when you are back online.' });
  };
  const send = (k: ReportInputKind, label: string) => {
    report(k).then(() => { setSent(label); window.setTimeout(() => setSent(null), 2500); })
      .catch(() => toast({ title: 'Report not sent', description: 'Check your connection.' }));
  };

  return (
    <div className="space-y-5">
      <div className="sticky top-8 z-30 overflow-hidden rounded-3xl border-2 border-[hsl(var(--community))] bg-card p-5" role="status" data-testid="status-sharing">
        <div className="flex items-center gap-3">
          <span className="relative flex h-4 w-4"><span className="absolute inset-0 rounded-full bg-[hsl(var(--community))] pulse-dot" /></span>
          <p className="flex-1 font-extrabold uppercase tracking-wider text-[hsl(var(--community))]">{share.stale ? 'Sharing paused' : share.samples > 0 ? 'Sharing location' : 'Sharing on, nothing stored yet'}</p>
          {ride.mode === 'demo' && <SourceLabel source="demo" />}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {share.stale ? 'No recent updates. Keep this page open and in front to keep contributing.' : share.lastSentAt ? `Last update stored ${ago(share.lastSentAt)} · ${share.samples} stored` : 'Waiting for your first location fix...'}
          {' '}Ends automatically in {minsLeft} min.
        </p>
        {share.error && <p className="mt-2 text-sm text-[hsl(var(--warn))]">{share.error}</p>}
        <button onClick={stop} data-testid="button-stop-sharing" className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--bad))] text-lg font-extrabold text-white active:scale-[.99]">
          <Square className="h-5 w-5 fill-current" />Stop sharing
        </button>
      </div>

      <div className="flex items-center gap-4">
        <RouteBadge name={ride.routeName} color={ride.routeColor} size="lg" />
        <div><p className="font-display text-2xl">{ride.direction}</p><p className="text-sm text-muted-foreground">Boarded at {ride.stopName}</p></div>
      </div>

      <section className="rounded-2xl border border-card-border bg-card p-4">
        <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Next stops</h2>
        {route.isLoading && <div className="skel mt-3 h-10" />}
        {!route.isLoading && upcoming.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Trip position is not reliable enough to list remaining stops.</p>}
        <ol className="mt-2">
          {upcoming.slice(0, 6).map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: ride.routeColor, background: i === 0 ? ride.routeColor : 'transparent' }} />
              <span className={i === 0 ? 'font-bold' : 'text-muted-foreground'}>{s.name}</span>
            </li>
          ))}
        </ol>
        {upcoming.length > 6 && <p className="text-xs text-muted-foreground">+{upcoming.length - 6} more stops</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Report</h2>
        <div className="grid grid-cols-3 gap-2">
          {REPORTS.map((r) => <button key={r.kind} onClick={() => send(r.kind, r.label)} data-testid={`button-report-${r.kind}`} className="h-14 rounded-2xl border border-card-border bg-card font-bold hover:border-white/30 active:scale-95">{r.label}</button>)}
        </div>
        <p className="text-sm text-muted-foreground">How crowded is it?</p>
        <div className="grid grid-cols-3 gap-2">
          {CROWD.map((r) => <button key={r.kind} onClick={() => send(r.kind, `Crowding ${r.label}`)} data-testid={`button-report-${r.kind}`} className="h-14 rounded-2xl border border-card-border bg-card font-bold hover:border-white/30 active:scale-95">{r.label}</button>)}
        </div>
        <p className="min-h-5 text-sm text-[hsl(var(--live))]" aria-live="polite">{sent ? `Thanks. "${sent}" reported.` : ''}</p>
      </section>
    </div>
  );
}
