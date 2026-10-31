import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { TrainFront, Bus, Plane, Ship, TrainFrontTunnel } from 'lucide-react';
import { prefersReducedMotion, useSwipeGesture } from '@/hooks/use-swipe-gesture';
import { DESIGN_LABELS, EXTRA_THEMES, THEMES, fetchEntryLocation, isDesign, readChoice, readDetected, storeChoice, storeDetected, type EntryDesign, type EntryLocation } from '@/lib/entry-location';
import { CityEntry } from '@/components/entry/city-entry';
import { RegionalEntry, EntryPrivacy } from '@/components/entry/regional-entry';
import { SlideStep } from '@/components/entry/slide-step';
import { trackEvent } from '@/lib/analytics';

const KEY = 'transtop.entry.v2';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

type EntryCtx = { replay: () => void };
const Ctx = createContext<EntryCtx | null>(null);
export function useEntry() {
  const c = useContext(Ctx);
  if (!c) throw new Error('EntryGate missing');
  return c;
}

function readEntered() {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Mounts children only after the entry card has been swiped in this tab session. */
export function EntryGate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(readEntered);
  // Public server-rendered information stays readable without session storage,
  // JavaScript or a gesture. Only replace it once the rider enters the live app.
  useEffect(() => {
    const hasPublicContent = !!document.getElementById('public-content');
    for (const id of ['public-content', 'public-info-link']) {
      const element = document.getElementById(id);
      if (element) element.hidden = entered || !hasPublicContent;
    }
  }, [entered]);
  const [choice, setChoice] = useState<EntryDesign | null>(readChoice);
  const [location, setLocation] = useState<EntryLocation | null>(readDetected);
  const asked = useRef(false);
  useEffect(() => {
    if (entered || location || asked.current) return;
    asked.current = true;
    let live = true;
    const ac = new AbortController();
    fetchEntryLocation(BASE, fetch, undefined, ac.signal).then((l) => {
      if (!live) return;
      storeDetected(l);
      setLocation((cur) => cur ?? l); // first resolution wins; never overrides an explicit choice
    });
    return () => { live = false; asked.current = false; ac.abort(); };
  }, [entered, location]);
  const pick = useCallback((v: EntryDesign | null) => { storeChoice(v); setChoice(v); }, []);
  const enter = useCallback(() => {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    trackEvent('entry_completed');
    setEntered(true);
  }, []);
  const replay = useCallback(() => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setEntered(false);
    window.scrollTo(0, 0);
  }, []);
  let body: ReactNode;
  if (entered) body = children;
  else {
    const design = choice ?? location?.theme ?? null;
    body = <>
      <ThemePicker choice={choice} detected={location} onPick={pick} />
      {design ? <Intro key={design} variant={design} location={location} onDone={enter} />
        : <div className="min-h-[100dvh] bg-[#050506]" aria-busy="true" data-testid="screen-entry-loading" />}
    </>;
  }
  return <Ctx.Provider value={{ replay }}>{body}</Ctx.Provider>;
}

const LINES: { d: string; c: string }[] = [
  { d: 'M88 100 V530 H560 V740', c: '#7fb4d6' },
  { d: 'M215 145 V255 H22 V400 H160 V700 H430', c: '#9bc7e6' },
  { d: 'M22 270 H660', c: '#5f9fb8' },
  { d: 'M555 100 V170 H345 V940', c: '#f2c230' },
  { d: 'M180 345 V690 H520 V930', c: '#f2c230' },
  { d: 'M30 400 H140 V410 H40', c: '#ef6aa0' },
  { d: 'M245 640 V375 H590 V265 H662', c: '#ef6aa0' },
  { d: 'M245 600 H420 V615 L530 720 V930', c: '#ef6aa0' },
  { d: 'M78 290 V540 H240 V560', c: '#36c07a' },
  { d: 'M150 410 V690 L330 885', c: '#f36b2a' },
  { d: 'M80 380 H662', c: '#7da2b5' },
  { d: 'M90 510 H662', c: '#8a8a8a' },
  { d: 'M600 840 L662 900 M610 850 V930', c: '#ef6aa0' },
  { d: 'M400 590 H662', c: '#7da2b5' },
];

function Lines() {
  return (
    <svg viewBox="0 0 662 1024" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs><filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3" /></filter></defs>
      {LINES.map((l, i) => (
        <g key={i} fill="none" strokeLinejoin="round">
          <path d={l.d} stroke={l.c} strokeWidth="6" opacity=".45" filter="url(#glow)" />
          <path d={l.d} stroke={l.c} strokeWidth="2.4" opacity=".9" />
        </g>
      ))}
    </svg>
  );
}

const MODES = [
  { I: TrainFront, c: '#1f8a4c', l: 'Subway' },
  { I: Bus, c: '#d1a320', l: 'Bus' },
  { I: Plane, c: '#e8592a', l: 'Airport' },
  { I: Ship, c: '#1b6fc2', l: 'Ferry' },
  { I: TrainFrontTunnel, c: '#8e2a55', l: 'Rail' },
];

function Arrows() {
  return (
    <span className="flex items-center gap-[0.35em]" aria-hidden>
      {[0, 1, 2].map((i) => <svg key={i} viewBox="0 0 24 14" className="h-[0.7em] w-[1.1em]" style={{ animation: `entry-nudge 1.8s ${i * 0.15}s ease-in-out infinite` }}><path d="M0 7 L24 0 L16 7 L24 14Z" fill="currentColor" /></svg>)}
      <svg viewBox="0 0 40 14" className="h-[0.7em] w-[1.8em]"><path d="M0 7 L14 0 L10 6 H40 V8 H10 L14 14Z" fill="currentColor" /></svg>
    </span>
  );
}

const STYLE = `@keyframes entry-nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(-4px)}}.entry-nudge,[style*="entry-nudge"]{}.entry-nudge{animation:entry-nudge 1.8s ease-in-out infinite}.entry-title{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif}.reduce-motion .entry-nudge,.reduce-motion [style*="entry-nudge"]{animation:none!important}@media (prefers-reduced-motion:reduce){.entry-nudge,[style*="entry-nudge"]{animation:none!important}}@media (max-height:500px) and (orientation:landscape){[data-entry-variant] h1{font-size:clamp(2.4rem,9vh,4rem)!important}[data-entry-variant] ul[aria-label^="Modes"] li{width:clamp(2.6rem,11vh,3.6rem)!important}}`;

function ThemePicker({ choice, detected, onPick }: { choice: EntryDesign | null; detected: EntryLocation | null; onPick: (v: EntryDesign | null) => void }) {
  const auto = detected ? (detected.theme === 'default' ? (detected.city ?? 'farebox') : DESIGN_LABELS[detected.theme]) : 'detecting';
  return (
    <label className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[calc(4.75rem+env(safe-area-inset-top))] z-50 flex items-center gap-2 rounded-full border border-white/20 bg-[#0b0d14]/80 py-1 pl-3 pr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f4f1ea]/80 backdrop-blur md:top-[calc(3.5rem+env(safe-area-inset-top))]">
      <span className="hidden min-[400px]:inline">City</span>
      <select value={choice ?? 'auto'} onChange={(e) => onPick(isDesign(e.target.value) ? e.target.value : null)} data-testid="select-entry-theme"
        aria-label="Entry design city" className="max-w-[8.5rem] min-[480px]:max-w-[13rem] cursor-pointer rounded-full bg-[#1a1e2a] px-3 py-1.5 text-xs font-semibold normal-case tracking-normal text-[#f4f1ea] outline-none focus-visible:ring-2 focus-visible:ring-[#3fc1f2]">
        <option value="auto">Automatic ({auto})</option>
        <optgroup label="United States">{THEMES.map((t) => <option key={t} value={t}>{DESIGN_LABELS[t]}</option>)}</optgroup>
        <optgroup label="More designs">{EXTRA_THEMES.map((t) => <option key={t} value={t}>{DESIGN_LABELS[t]}</option>)}</optgroup>
      </select>
    </label>
  );
}

export function Intro({ onDone, variant = 'new-york', location = null }: { onDone: () => void; variant?: EntryDesign; location?: EntryLocation | null }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const done = useCallback(() => doneRef.current(), []);
  const rm = prefersReducedMotion();
  const wrap = (child: ReactNode) => (
    <div role="main" aria-label="Transtop entry" data-testid="screen-entry" data-entry-variant={variant}
      className="relative flex min-h-[100dvh] select-none flex-col overflow-hidden bg-[#050506] text-[#f4f1ea]"
      style={{ transition: rm ? 'none' : 'opacity 600ms ease, transform 600ms ease', opacity: leaving && !rm ? 0 : 1, transform: leaving && !rm ? 'scale(1.02)' : 'none' }}>
      <style>{STYLE}</style>
      {child}
    </div>
  );
  if (variant === 'london' || variant === 'paris' || variant === 'tokyo') return wrap(<RegionalEntry region={variant} onDone={() => { setLeaving(true); done(); }} />);
  if (variant !== 'new-york') return wrap(<CityEntry theme={variant} location={location} onDone={() => { setLeaving(true); done(); }} />);
  return wrap(<UsEntry onLeave={() => setLeaving(true)} onDone={done} />);
}

function UsEntry({ onDone, onLeave }: { onDone: () => void; onLeave: () => void }) {
  const g = useSwipeGesture(onDone);
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  useEffect(() => { if (g.leaving) leaveRef.current(); }, [g.leaving]);
  const p = g.p, pct = g.pct, leaving = g.leaving;
  const rm = prefersReducedMotion();
  return (
    <>
      <Lines />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-[8vw] pt-[17dvh] md:px-12 md:pt-[14dvh]">
        <h1 className="font-['Helvetica_Neue',Helvetica,Arial,sans-serif] text-[clamp(4rem,19vw,11rem)] font-bold leading-[0.9] tracking-[-0.05em] [text-shadow:0_2px_24px_rgba(0,0,0,.6)]">Transtop</h1>
        <p className="mt-[2.4dvh] text-[clamp(1.4rem,4.4vw,2.4rem)] font-semibold tracking-tight">(Transit Stop)</p>
        <ul className="mt-[7dvh] grid w-fit grid-cols-3 gap-x-[4.5vw] gap-y-[3dvh] md:flex md:gap-6" aria-label="Modes: subway, bus, airport, ferry, rail">
          {MODES.map(({ I, c, l }) => (
            <li key={l} className="flex aspect-square w-[clamp(4.5rem,15.5vw,6.5rem)] items-center justify-center rounded-full" style={{ background: c }}>
              <I className="h-[52%] w-[52%]" strokeWidth={2.2} color="#fff" aria-hidden />
              <span className="sr-only">{l}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 mt-[5dvh]">
        <p id="entry-help" className="sr-only">Swipe the MetroCard right to left along the track to enter. Keyboard: focus the card, press Left Arrow to slide it, Right Arrow to slide back, Home to reset. Entry at 100 percent by keyboard, or release after at least 85 percent when dragging.</p>
        <div ref={g.track} className="relative mx-auto flex h-[clamp(3rem,12.2vw,6rem)] w-full max-w-6xl items-center border-b-[10px] border-[#8f8f8f] bg-[#9a9a9a] md:rounded-sm" data-testid="track-swipe">
          <div className="pointer-events-none flex items-center gap-[6vw] pl-[5vw] text-[clamp(1.3rem,4.4vw,2.2rem)] font-semibold text-white md:gap-12 md:pl-10" style={{ opacity: 1 - p * 1.4 }}>
            <Arrows /><span>Slide Here</span>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-[#f2c230]/25" style={{ width: `${pct}%` }} aria-hidden />
          <div ref={g.card} role="slider" tabIndex={0} aria-label="MetroCard, swipe left to enter Transtop" aria-describedby="entry-help"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} percent swiped${pct >= 100 ? ', entering' : ''}`}
            {...g.handlers}
            data-testid="slider-metrocard"
            className="absolute bottom-1 right-2 w-[clamp(6rem,25vw,15rem)] cursor-grab touch-none outline-none focus-visible:ring-4 focus-visible:ring-[#f2c230] focus-visible:ring-offset-2 focus-visible:ring-offset-black active:cursor-grabbing"
            style={{ transform: `translateX(${-p * g.travel}px)`, transition: g.dragging || rm ? 'none' : 'transform 380ms cubic-bezier(.2,.9,.25,1.15)' }}>
            <img src={`${BASE}/entry/metrocard.png`} alt="" draggable={false} className="h-auto w-full rounded-md shadow-[0_10px_30px_rgba(0,0,0,.6)]" />
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-6xl px-[5vw] text-xs font-semibold uppercase tracking-[0.16em] text-[#f4f1ea]/60 md:px-10" aria-live="polite" data-testid="text-swipe-progress">
          {leaving ? 'Card accepted' : pct > 0 ? `${pct}% — keep going` : 'Swipe the card left to enter · keyboard: Left Arrow'}
        </p>
        <SlideStep onAdvance={g.advance} leaving={leaving} />
      </div>

      <footer className="relative z-10 mx-auto mt-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-3 px-[4vw] pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-8 md:px-10">
        <img src={`${BASE}/entry/footer.png`} alt="New York City Transit, Long Island Rail Road, Long Island Bus, Metro-North Railroad" className="h-[clamp(3.25rem,10vw,4.5rem)] w-auto" />
        <EntryPrivacy />
      </footer>
    </>
  );
}
