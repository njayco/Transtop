import { useEffect, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getGetTrainQueryKey, useGetTrain, type TrainCall, type TrainDetail } from '@workspace/api-client-react';
import { ErrorState, SkeletonCards, StatusText, TransitLines } from '@/components/transit';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TrainFollowCard } from '@/components/train-follow';
import { usePageMetadata } from '@/lib/use-page-metadata';

const AMTRAK = '#e0662f';

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function estimatesValid(t: TrainDetail, now: number) {
  const at=Date.parse(t.updatedAt||''),expires=Date.parse(t.expiresAt||'');
  return t.source.includes('Amtraker')&&Number.isFinite(at)&&Number.isFinite(expires)&&
    expires>=now&&now-at<=300_000&&at<=now+30_000;
}

function fmt(iso: string | null, tz: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (!tz) {
    const s = d.toLocaleString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return { time: s, zone: 'UTC (station time zone unknown)' };
  }
  try {
    const time = d.toLocaleString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const zone = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? tz;
    return { time, zone: `${zone} · ${tz}` };
  } catch {
    return { time: d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC', zone: `UTC (unrecognized zone ${tz})` };
  }
}

function TimeCell({ kind, iso, tz }: { kind: 'Scheduled' | 'Estimated' | 'Actual'; iso: string | null; tz: string | null }) {
  const f = fmt(iso, tz);
  if (!f) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className={cn('w-20 shrink-0 text-[11px] font-bold uppercase tracking-wider',
        kind === 'Actual' ? 'text-foreground' : kind === 'Estimated' ? 'text-[hsl(var(--community))]' : 'text-muted-foreground')}>{kind}</span>
      <span className="tabular font-semibold">{f.time}</span>
      <span className="text-xs text-muted-foreground">{f.zone}</span>
    </div>
  );
}

function CallRow({ c, i, matched, live }: { c: TrainCall; i: number; matched: boolean; live: boolean }) {
  const eA = live ? c.estimatedArrival : null;
  const eD = live ? c.estimatedDeparture : null;
  const hasArr = c.scheduledArrival || eA || c.actualArrival;
  const hasDep = c.scheduledDeparture || eD || c.actualDeparture;
  const name = <><span className="truncate">{c.name}</span><span className="ml-2 text-xs font-bold tracking-wider text-muted-foreground">{c.code}</span></>;
  return (
    <li className="rise relative flex gap-4 py-3" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} data-testid={`row-call-${c.code}`}>
      <span className="relative z-10 ml-[6px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[3px] bg-background text-[11px] font-bold tabular" style={{ borderColor: AMTRAK }}>{c.sequence}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 font-semibold">
          {matched ? <Link href={`/stops/${encodeURIComponent(`amtrak:${c.code}`)}`} className="inline-flex min-w-0 items-center underline-offset-2 hover:underline" data-testid={`link-call-stop-${c.code}`}>{name}</Link> : <span className="inline-flex min-w-0 items-center">{name}</span>}
          {c.status && <StatusText status={c.status} />}
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {hasArr && <div className="space-y-1"><p className="text-xs font-bold text-muted-foreground">Arrival</p><TimeCell kind="Scheduled" iso={c.scheduledArrival} tz={c.timezone} /><TimeCell kind="Estimated" iso={eA} tz={c.timezone} /><TimeCell kind="Actual" iso={c.actualArrival} tz={c.timezone} /></div>}
          {hasDep && <div className="space-y-1"><p className="text-xs font-bold text-muted-foreground">Departure</p><TimeCell kind="Scheduled" iso={c.scheduledDeparture} tz={c.timezone} /><TimeCell kind="Estimated" iso={eD} tz={c.timezone} /><TimeCell kind="Actual" iso={c.actualDeparture} tz={c.timezone} /></div>}
          {!hasArr && !hasDep && <p className="text-sm text-muted-foreground">No times available for this station.</p>}
        </div>
        {!c.timezone && <p className="mt-1 text-xs text-muted-foreground">Station time zone not reported; times shown in UTC.</p>}
      </div>
    </li>
  );
}

export default function TrainPage() {
  const [, params] = useRoute('/trains/:id');
  const trainId = decodeURIComponent(params?.id ?? '');
  const q = useGetTrain(trainId, { query: { queryKey: getGetTrainQueryKey(trainId), refetchInterval: 30_000, retry: 1 } });
  const t = q.data;
  usePageMetadata(`/trains/${encodeURIComponent(trainId)}`, t);
  const now = useNow();
  const live = t ? estimatesValid(t, now) : false;
  const observed = !!t && t.source.includes('Amtraker');
  const stale = observed && !live;
  const notFound = q.isError && (q.error as { status?: number } | null)?.status === 404;

  const calls = t ? [...t.calls].sort((a, b) => a.sequence - b.sequence) : [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="relative overflow-hidden border-b border-border">
        <TransitLines className="absolute inset-0 h-full w-full opacity-30" />
        <div className="relative space-y-4 p-4 md:p-8">
          <button onClick={() => history.back()} className="inline-flex h-11 items-center gap-2 pr-3 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-back"><ArrowLeft className="h-5 w-5" />Back</button>
          {q.isLoading && <div className="space-y-3"><div className="skel h-10 w-2/3" /><div className="skel h-6 w-1/3" /></div>}
          {t && (
            <div className="rise">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Amtrak train · Service date {t.serviceDate}</p>
              <h1 className="mt-1 font-display text-4xl leading-[0.95] md:text-6xl" data-testid="text-train-name">
                <span className="tabular" style={{ color: AMTRAK }}>{t.trainNumber}</span> {t.routeName}
              </h1>
              <p className="mt-2 text-muted-foreground">to {t.destination}{t.state ? ` · ${t.state}` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                <span className={cn('rounded-full border px-3 py-1', t.matched ? 'border-border' : 'border-dashed border-[hsl(var(--community))] text-[hsl(var(--community))]')} data-testid="text-train-matched">{t.matched ? 'Matched to published schedule' : 'Unresolved: not matched to a scheduled trip'}</span>
                <span className="rounded-full border border-border px-3 py-1" data-testid="text-train-source">
                  {live ? `Observed train report, updated ${ago(t.updatedAt)}` : stale ? 'Tracking stale or unavailable; estimates hidden' : 'Schedule only'}
                </span>
              </div>
              {t.routeId && <Link href={`/routes/${encodeURIComponent(t.routeId)}`} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold underline underline-offset-2" data-testid="link-train-route">View {t.routeName} route</Link>}
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-6 p-4 md:grid-cols-[1fr_320px] md:p-8">
        <div className="space-y-4">
          {q.isLoading && <SkeletonCards n={3} />}
          {notFound && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center" data-testid="state-train-not-found">
              <p className="font-display text-xl">Train not found</p>
              <p className="mt-1 text-sm text-muted-foreground">This train and service date are not in the published schedule or current observations.</p>
            </div>
          )}
          {q.isError && !notFound && <ErrorState title="Could not load this train" onRetry={() => q.refetch()} />}
          {t?.message && <p className="rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground" data-testid="text-train-message">{t.message}</p>}
          {stale && <p className="rounded-xl border border-[hsl(var(--community))]/40 px-3 py-2 text-sm" data-testid="text-train-stale">Observed estimates have expired and are no longer shown. Scheduled and recorded actual times remain.</p>}
          {t && calls.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <p className="font-display text-xl">No station calls to show</p>
              <p className="mt-1 text-sm text-muted-foreground">Neither the published schedule nor observed data lists stations for this train.</p>
            </div>
          )}
          {calls.length > 0 && (
            <section className="rounded-2xl border border-card-border bg-card px-3 py-2">
              <h2 className="px-1 py-2 text-xl font-bold tracking-tight">Station calls</h2>
              <ol className="relative" aria-label="Stations in order">
                <span className="absolute bottom-6 left-[19px] top-6 w-1" style={{ background: AMTRAK }} aria-hidden />
                {calls.map((c, i) => <CallRow key={`${c.code}-${c.sequence}`} c={c} i={i} matched={t!.matched} live={live} />)}
              </ol>
            </section>
          )}
          {t && <p className="text-xs text-muted-foreground">Refreshes every 30 seconds while open. Estimates are checked against their expiry every 15 seconds.</p>}
        </div>
        <aside className="space-y-4">
          {t && <TrainFollowCard key={trainId} train={t} />}
          {t && (
            <div className="rounded-2xl border border-card-border bg-card p-4 text-sm" data-testid="card-train-credit">
              <p className="font-bold">Data sources</p>
              {observed ? (
                <p className="mt-2 text-muted-foreground">Observed train data from{' '}
                  <a href="https://amtraker.com" target="_blank" rel="noreferrer" className="font-semibold text-foreground underline underline-offset-2" data-testid="link-amtraker">Amtraker<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden /><span className="sr-only">(opens in new tab)</span></a>, licensed under{' '}
                  <a href="https://opendatacommons.org/licenses/by/1-0/" target="_blank" rel="noreferrer" className="font-semibold text-foreground underline underline-offset-2" data-testid="link-odc-by">ODC-By 1.0<span className="sr-only">(opens in new tab)</span></a>. Not affiliated with Amtrak.
                </p>
              ) : null}
              <p className="mt-2 text-muted-foreground">{observed ? 'Scheduled station times are supplied in the Amtraker observation; a match verifies them against published GTFS.' : 'All times from Amtrak published GTFS.'}</p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                <li><span className="font-bold text-foreground">Scheduled</span>: published timetable</li>
                <li><span className="font-bold text-[hsl(var(--community))]">Estimated</span>: observed projection, hidden once expired</li>
                <li><span className="font-bold text-foreground">Actual</span>: recorded arrival or departure</li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
