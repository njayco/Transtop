import { useMemo, useState } from 'react';
import { ArrowDownUp, Footprints, Navigation, TrainFront, Bus, AlertTriangle } from 'lucide-react';
import { usePlanJourney, type Journey, type JourneyInputModesItem, type JourneyResults } from '@workspace/api-client-react';
import { TransitMap, type MapStop } from '@/components/transit-map';
import { apiErrorText, nowHM, todayISO } from '@/components/timetable';
import { clock } from '@/lib/format';
import { newYorkInstant } from '@/lib/transit-time';
import { usePrefs } from '@/lib/prefs';
import { cn } from '@/lib/utils';

const MODES: { v: JourneyInputModesItem; l: string }[] = [
  { v: 'SUBWAY', l: 'Subway' }, { v: 'BUS', l: 'Bus' }, { v: 'TRAIN', l: 'Train' }, { v: 'RAIL', l: 'Rail' }, { v: 'LIGHT_RAIL', l: 'Light rail' },
];
const mins = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`; };
const isWalk = (m: string) => /walk/i.test(m);

export function JourneyPlanner() {
  const { mode } = usePrefs();
  const plan = usePlanJourney();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [timeType, setTimeType] = useState<'departure' | 'arrival'>('departure');
  const [when, setWhen] = useState<'now' | 'pick'>('now');
  const [date, setDate] = useState(todayISO);
  const [time, setTime] = useState(nowHM);
  const [modes, setModes] = useState<JourneyInputModesItem[]>([]);
  const [sent, setSent] = useState<{ origin: string; destination: string } | null>(null);
  const [result, setResult] = useState<JourneyResults | null>(null);
  const [sel, setSel] = useState(0);
  const [timeError,setTimeError] = useState('');

  if (mode === 'demo') return (
    <div className="rounded-2xl border border-dashed border-border p-6" data-testid="notice-journey-demo">
      <p className="font-display text-xl">Journey planning is off in Demo</p>
      <p className="mt-1 text-sm text-muted-foreground">Trip plans come only from Google's real transit directions and are never mixed with demo feeds. Switch to Live to plan a trip. The catalog below still works in either mode.</p>
    </div>
  );

  const valid = origin.trim().length >= 2 && destination.trim().length >= 2;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const o = origin.trim(), d = destination.trim();
    let iso:string|undefined;
    try{iso=when==='pick'?newYorkInstant(date,time):undefined;setTimeError('');}
    catch{setTimeError('Choose a valid New York date and time. That time may not exist during a daylight-saving change.');return;}
    setSent({ origin: o, destination: d });
    setResult(null); setSel(0);
    plan.mutate({ data: { origin: o, destination: d, timeType, ...(iso ? { time: iso } : {}), ...(modes.length ? { modes } : {}) } }, { onSuccess: (r) => setResult(r) });
  };
  const toggle = (m: JourneyInputModesItem) => setModes((cur) => cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);

  return (
    <div className="space-y-4">
      {timeError&&<p role="alert" className="text-sm text-[hsl(var(--warn))]">{timeError}</p>}
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-card-border bg-card p-4" aria-label="Plan a journey">
        <div className="relative space-y-2">
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={200} placeholder="From: address, station or place" aria-label="Origin" data-testid="input-journey-origin" className="h-12 w-full rounded-xl border border-input bg-background px-4 pr-14 focus:border-primary focus:outline-none" />
          <input value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={200} placeholder="To: address, station or place" aria-label="Destination" data-testid="input-journey-destination" className="h-12 w-full rounded-xl border border-input bg-background px-4 pr-14 focus:border-primary focus:outline-none" />
          <button type="button" onClick={() => { setOrigin(destination); setDestination(origin); }} aria-label="Swap origin and destination" data-testid="button-journey-swap" className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/15"><ArrowDownUp className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={timeType} onChange={(e) => setTimeType(e.target.value as 'departure' | 'arrival')} aria-label="Time type" data-testid="select-journey-timetype" className="h-11 rounded-xl border border-input bg-background px-3">
            <option value="departure">Depart</option><option value="arrival">Arrive by</option>
          </select>
          <select value={when} onChange={(e) => setWhen(e.target.value as 'now' | 'pick')} aria-label="When" data-testid="select-journey-when" className="h-11 rounded-xl border border-input bg-background px-3">
            <option value="now">Now</option><option value="pick">At a time</option>
          </select>
          {when === 'pick' && <>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" data-testid="input-journey-date" className="h-11 rounded-xl border border-input bg-background px-3" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" data-testid="input-journey-time" className="h-11 rounded-xl border border-input bg-background px-3" />
          </>}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Preferred transit">
          {MODES.map((m) => (
            <button type="button" key={m.v} aria-pressed={modes.includes(m.v)} onClick={() => toggle(m.v)} data-testid={`toggle-journey-mode-${m.v}`}
              className={cn('h-9 rounded-full border px-3 text-xs font-bold', modes.includes(m.v) ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground')}>{m.l}</button>
          ))}
          <span className="self-center text-xs text-muted-foreground">{modes.length ? '' : 'Any transit'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!valid || plan.isPending} data-testid="button-journey-plan" className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 font-bold text-primary-foreground disabled:opacity-50">
            <Navigation className="h-4 w-4" />{plan.isPending ? 'Planning...' : 'Plan with Google'}
          </button>
          <p className="flex-1 text-xs text-muted-foreground">Submitting sends the From and To text to Google Routes. Results are not saved on this device.</p>
        </div>
      </form>

      {sent && (plan.isPending || plan.isError || result) && (
        <p className="text-xs text-muted-foreground" role="status" data-testid="text-journey-disclosure">Sent to Google: "{sent.origin}" to "{sent.destination}".</p>
      )}
      {plan.isPending && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skel h-20" />)}</div>}
      {plan.isError && <JourneyNotice text={apiErrorText(plan.error, 'Google journey planning failed.')} />}
      {result && <JourneyResultsView result={result} sel={sel} onSelect={setSel} />}
    </div>
  );
}

function JourneyNotice({ text, configured = true }: { text: string; configured?: boolean }) {
  const hint = !configured || /credential|key|not.?config/i.test(text) ? 'An administrator needs to add a Google Maps Platform key with the Routes API enabled. Catalog search and timetables keep working.'
    : /quota|rate|429|exceed/i.test(text) ? 'Google usage limits were reached. Try again in a few minutes, or browse the catalog below.'
    : 'Check the addresses and try again. Catalog search and timetables still work.';
  return (
    <div className="flex gap-3 rounded-2xl border border-[hsl(var(--warn)/.5)] bg-card p-4" role="alert" data-testid="notice-journey-error">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--warn))]" />
      <div className="text-sm"><p className="font-bold">{text}</p><p className="mt-1 text-muted-foreground">{hint}</p></div>
    </div>
  );
}

function JourneyResultsView({ result, sel, onSelect }: { result: JourneyResults; sel: number; onSelect: (i: number) => void }) {
  const j: Journey | undefined = result.journeys[sel];
  const shape = useMemo(() => (j && j.shape.length > 1 ? { coords: j.shape, color: '#f5b82e' } : null), [j]);
  const stops = useMemo<MapStop[]>(() => {
    const out: MapStop[] = [];
    j?.steps.forEach((s, i) => {
      if (isWalk(s.mode)) return;
      const t = /bus/i.test(s.mode) ? 'bus' : /subway|metro/i.test(s.mode) ? 'subway' : 'rail';
      if (s.start) out.push({ id: `j${i}a`, name: s.departureStop ?? 'Board', lat: s.start.lat, lon: s.start.lon, type: t });
      if (s.end) out.push({ id: `j${i}b`, name: s.arrivalStop ?? 'Alight', lat: s.end.lat, lon: s.end.lon, type: t });
    });
    return out;
  }, [j]);
  const center = stops[0] ?? (j?.shape[0] ? { lat: j.shape[0][1], lon: j.shape[0][0] } : { lat: 40.758, lon: -73.9855 });

  if (!result.configured) return <JourneyNotice text={result.message || 'Google journey planning is not configured.'} configured={false} />;
  if (result.journeys.length === 0) return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center" data-testid="empty-journeys">
      <p className="font-display text-xl">No transit trips found</p>
      <p className="mt-1 text-sm text-muted-foreground">{result.message || 'Try more specific addresses, another time, or fewer transit preferences.'}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      {result.message && <p className="text-sm text-muted-foreground" role="status">{result.message}</p>}
      <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist" aria-label="Journey alternatives">
        {result.journeys.map((x, i) => {
          const transfers = Math.max(0, x.steps.filter((s) => !isWalk(s.mode)).length - 1);
          return (
            <button key={x.id} role="tab" aria-selected={sel === i} onClick={() => onSelect(i)} data-testid={`tab-journey-${i}`}
              className={cn('shrink-0 rounded-2xl border p-3 text-left', sel === i ? 'border-primary bg-card' : 'border-border text-muted-foreground')}>
              <p className="font-bold">{mins(x.durationSeconds)}</p>
              <p className="text-xs">{transfers === 0 ? 'No transfers' : `${transfers} transfer${transfers > 1 ? 's' : ''}`} · {(x.distanceMeters / 1609.34).toFixed(1)} mi</p>
            </button>
          );
        })}
      </div>
      {j && (
        <div className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
          <ol className="space-y-2" aria-label="Journey steps">
            {j.steps.map((s, i) => {
              const walk = isWalk(s.mode);
              const Icon = walk ? Footprints : /bus/i.test(s.mode) ? Bus : TrainFront;
              return (
                <li key={i} className={cn('flex gap-3 rounded-2xl border p-3', walk ? 'border-dashed border-border' : 'border-card-border bg-card')} data-testid={`row-journey-step-${i}`}>
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 text-sm">
                    {s.line && <p className="font-bold">{s.line}</p>}
                    {s.agencies?.length ? <p className="text-xs text-muted-foreground">{s.agencies.map((a,i)=><span key={`${a.name}-${i}`}>{i>0?', ':''}{a.url&&/^https?:\/\//i.test(a.url)?<a href={a.url} target="_blank" rel="noreferrer" className="underline">{a.name}</a>:a.name}</span>)}</p> : s.agency && <p className="text-xs text-muted-foreground">{s.agency}</p>}
                    <p className={s.line ? 'text-muted-foreground' : 'font-semibold'}>{s.instruction}</p>
                    {(s.departureStop || s.arrivalStop) && <p className="mt-1 text-xs">{s.departureStop}{s.departureTime ? ` ${clock(s.departureTime)}` : ''} to {s.arrivalStop}{s.arrivalTime ? ` ${clock(s.arrivalTime)}` : ''}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{mins(s.durationSeconds)}</span>
                </li>
              );
            })}
          </ol>
          <TransitMap googleOnly center={center} stops={stops} shape={shape} className="h-[360px] w-full overflow-hidden rounded-2xl border border-border" label="Map of selected journey" />
        </div>
      )}
      <p className="text-xs text-muted-foreground" data-testid="text-journey-provider">Directions by {result.provider || 'Google'}. Times are planned by Google and may differ from Transtop's agency sources.</p>
    </div>
  );
}
