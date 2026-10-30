import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { getGetTimetableQueryKey, useGetTimetable, type GetTimetableParams } from '@workspace/api-client-react';
import { ErrorState } from '@/components/transit';
import { clock } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { newYorkDate,newYorkTime } from '@/lib/transit-time';

export function apiErrorText(err: unknown, fallback: string) {
  const d = (err as { data?: { error?: unknown; message?: unknown } } | null)?.data;
  if (d && typeof d.error === 'string') return d.error;
  if (d && typeof d.message === 'string') return d.message;
  return err instanceof Error && err.message ? err.message : fallback;
}

export function todayISO() { return newYorkDate(); }
export function nowHM() { return newYorkTime(); }

const LIMIT = 25;

/** Published (scheduled) timetable for a stop or route. Not realtime. */
export function TimetablePanel({ stopId, routeId, direction, color, title = 'Published timetable', stopOptions }: { stopOptions?: { id: string; name: string }[]; stopId?: string; routeId?: string; direction?: string; color?: string; title?: string }) {
  const { mode } = usePrefs();
  const [date, setDate] = useState(todayISO);
  const [from, setFrom] = useState(nowHM);
  const [offset, setOffset] = useState(0);
  const [pick, setPick] = useState('');
  useEffect(()=>setPick(''),[routeId,direction]);
  useEffect(()=>setOffset(0),[stopId,routeId,direction,mode,pick]);
  const effStop = stopOptions && pick ? pick : stopId;
  const params: GetTimetableParams = { mode, date, from, offset, limit: LIMIT, ...(effStop ? { stopId: effStop } : {}), ...(routeId ? { routeId } : {}), ...(direction ? { direction } : {}) };
  const q = useGetTimetable(params, { query: { queryKey: getGetTimetableQueryKey(params), enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(from), retry: 1 } });
  const rows = q.data?.departures ?? [];
  const total = q.data?.total ?? 0;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setOffset(0); };

  return (
    <section className="overflow-hidden rounded-2xl border border-card-border bg-card" data-testid="section-timetable">
      <header className="space-y-3 border-b border-white/5 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Scheduled · not realtime</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm">
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">Service date</span>
            <input type="date" value={date} onChange={(e) => reset(setDate)(e.target.value)} className="bg-transparent focus:outline-none" data-testid="input-timetable-date" />
          </label>
          <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">From time</span>
            <input type="time" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className="bg-transparent focus:outline-none" data-testid="input-timetable-from" />
          </label>
          {stopOptions && stopOptions.length > 0 && (
            <label className="inline-flex h-11 max-w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm">
              <span className="shrink-0 text-muted-foreground">Departure timepoint</span>
              <select value={pick} onChange={(e) => { setPick(e.target.value); setOffset(0); }} className="min-w-0 bg-transparent focus:outline-none" data-testid="select-timetable-timepoint">
                <option value="">Origin of each run</option>
                {stopOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
          <button onClick={() => { setDate(todayISO()); setFrom(nowHM()); setOffset(0); }} className="h-11 rounded-full border border-border px-4 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-timetable-now">Now</button>
        </div>
      </header>
      <div aria-live="polite">
        {q.isLoading && <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skel h-10" />)}</div>}
        {q.isError && <div className="p-4"><ErrorState title="Timetable unavailable" detail={apiErrorText(q.error, 'The schedule service did not respond.')} onRetry={() => q.refetch()} /></div>}
        {q.data?.message && <p className="border-b border-white/5 px-4 py-2 text-sm text-muted-foreground" role="status" data-testid="text-timetable-message">{q.data.message}</p>}
        {q.data && rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No published departures after {from} on {q.data.date || date}. Try an earlier time or another date.</p>}
        {rows.length > 0 && (
          <ol>
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0" data-testid={`row-timetable-${d.id}`}>
                <span className="w-24 shrink-0 font-mono text-base font-bold tabular-nums">{clock(d.time,d.timezone)}{d.timezone?<span className="block text-[10px] text-muted-foreground">{new Date(d.time).toLocaleDateString('en-US',{timeZone:d.timezone})} · {d.timezone}</span>:newYorkDate(new Date(d.time))!==date&&<span className="block text-[10px] text-muted-foreground">{newYorkDate(new Date(d.time))}</span>}</span>
                <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-extrabold text-black" style={{ background: color ?? '#d9d4c7' }}>{d.routeName}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">to {d.destination}</p>
                  {d.runId&&<Link href={`/trains/${encodeURIComponent(d.runId)}`} className="text-sm font-bold underline">Train {d.trainNumber} · all stops</Link>}
                  <p className="truncate text-xs text-muted-foreground">{routeId ? d.stopName : d.direction}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      {total > LIMIT && <Pager offset={offset} limit={LIMIT} total={total} onChange={setOffset} label="departures" />}
    </section>
  );
}

export function Pager({ offset, limit, total, onChange, label }: { offset: number; limit: number; total: number; onChange: (o: number) => void; label: string }) {
  const end = Math.min(total, offset + limit);
  return (
    <nav className="flex items-center justify-between gap-2 border-t border-white/5 px-4 py-2 text-sm" aria-label={`${label} pages`}>
      <span className="text-muted-foreground" data-testid={`text-page-${label}`}>{total ? offset + 1 : 0}–{end} of {total.toLocaleString()} {label}</span>
      <div className="flex gap-1">
        <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label="Previous page" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30" data-testid={`button-prev-${label}`}><ChevronLeft className="h-4 w-4" /></button>
        <button disabled={end >= total} onClick={() => onChange(offset + limit)} aria-label="Next page" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30" data-testid={`button-next-${label}`}><ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
}
