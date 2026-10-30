import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from 'react';
import { TrainFront, Bus, Plane, Ship, TrainFrontTunnel } from 'lucide-react';

const KEY = 'transtop.entry.v2';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const UNLOCK = 0.85;
const STEP = 10;

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

/** Mounts children only after the MetroCard has been swiped in this tab session. */
export function EntryGate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(readEntered);
  const enter = useCallback(() => {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    setEntered(true);
  }, []);
  const replay = useCallback(() => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setEntered(false);
    window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ replay }}>{entered ? children : <Intro onDone={enter} />}</Ctx.Provider>;
}

function reducedMotion() {
  return document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

export function Intro({ onDone }: { onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startP: number } | null>(null);
  const [p, setP] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const maxTravel = () => {
    const t = track.current, c = card.current;
    return t && c ? Math.max(1, t.clientWidth - c.offsetWidth - 16) : 1;
  };

  const finish = useCallback(() => {
    setP(1);
    setLeaving(true);
    window.setTimeout(() => doneRef.current(), reducedMotion() ? 0 : 650);
  }, []);

  useEffect(() => { card.current?.focus({ preventScroll: true }); }, []);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (leaving || !e.isPrimary || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startP: p };
    setDragging(true);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = drag.current.startX - e.clientX;
    setP(Math.min(1, Math.max(0, drag.current.startP + dx / maxTravel())));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (p >= UNLOCK) finish(); else setP(0);
  };
  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (leaving) return;
    const pct = Math.round(p * 100);
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.min(100, pct + STEP);
    else if (e.key === 'ArrowRight') next = Math.max(0, pct - STEP);
    else if (e.key === 'Home') next = 0;
    if (next === null) return;
    e.preventDefault();
    if (next >= 100) finish(); else setP(next / 100);
  };

  const pct = Math.round(p * 100);
  const rm = typeof window !== 'undefined' && reducedMotion();
  return (
    <div role="main" aria-label="Transtop entry" data-testid="screen-entry"
      className="relative flex min-h-[100dvh] select-none flex-col overflow-hidden bg-[#050506] text-[#f4f1ea]"
      style={{ transition: rm ? 'none' : 'opacity 600ms ease, transform 600ms ease', opacity: leaving && !rm ? 0 : 1, transform: leaving && !rm ? 'scale(1.02)' : 'none' }}>
      <style>{`@keyframes entry-nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(-4px)}}.reduce-motion [style*="entry-nudge"]{animation:none!important}@media (prefers-reduced-motion:reduce){[style*="entry-nudge"]{animation:none!important}}`}</style>
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
        <p id="entry-help" className="sr-only">Swipe the MetroCard left along the track to enter. Keyboard: focus the card, press Left Arrow to slide it, Right Arrow to slide back, Home to reset. Entry happens at 100 percent.</p>
        <div ref={track} className="relative mx-auto flex h-[clamp(3rem,12.2vw,6rem)] w-full max-w-6xl items-center border-b-[10px] border-[#8f8f8f] bg-[#9a9a9a] md:rounded-sm" data-testid="track-swipe">
          <div className="pointer-events-none flex items-center gap-[6vw] pl-[5vw] text-[clamp(1.3rem,4.4vw,2.2rem)] font-semibold text-white md:gap-12 md:pl-10" style={{ opacity: 1 - p * 1.4 }}>
            <Arrows /><span>Slide Here</span>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-[#f2c230]/25" style={{ width: `${pct}%` }} aria-hidden />
          <div ref={card} role="slider" tabIndex={0} aria-label="MetroCard, swipe left to enter Transtop" aria-describedby="entry-help"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} percent swiped${pct >= 100 ? ', entering' : ''}`}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            onPointerCancel={() => { drag.current = null; setDragging(false); setP(0); }} onKeyDown={onKey}
            data-testid="slider-metrocard"
            className="absolute bottom-1 right-2 w-[clamp(6rem,25vw,15rem)] cursor-grab touch-none outline-none focus-visible:ring-4 focus-visible:ring-[#f2c230] focus-visible:ring-offset-2 focus-visible:ring-offset-black active:cursor-grabbing"
            style={{ transform: `translateX(${-p * maxTravel()}px)`, transition: dragging || rm ? 'none' : 'transform 380ms cubic-bezier(.2,.9,.25,1.15)' }}>
            <img src={`${BASE}/entry/metrocard.png`} alt="" draggable={false} className="h-auto w-full rounded-md shadow-[0_10px_30px_rgba(0,0,0,.6)]" />
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-6xl px-[5vw] text-xs font-semibold uppercase tracking-[0.16em] text-[#f4f1ea]/60 md:px-10" aria-live="polite" data-testid="text-swipe-progress">
          {leaving ? 'Card accepted' : pct > 0 ? `${pct}% — keep going` : 'Swipe the card left to enter · keyboard: Left Arrow'}
        </p>
      </div>

      <footer className="relative z-10 mx-auto mt-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-3 px-[4vw] pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-8 md:px-10">
        <img src={`${BASE}/entry/footer.png`} alt="New York City Transit, Long Island Rail Road, Long Island Bus, Metro-North Railroad" className="h-[clamp(3.25rem,10vw,4.5rem)] w-auto" />
        <p className="max-w-[16rem] text-[10px] leading-snug text-[#f4f1ea]/45" data-testid="text-unaffiliated">Transtop is independent and not affiliated with or endorsed by the MTA or any agency.</p>
      </footer>
    </div>
  );
}
