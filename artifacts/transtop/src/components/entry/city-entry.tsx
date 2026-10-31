import { type ReactNode } from 'react';
import { Bus, CableCar, Plane, Ship, TramFront, TrainFront, TrainFrontTunnel, MapPin } from 'lucide-react';
import { prefersReducedMotion, useSwipeGesture } from '@/hooks/use-swipe-gesture';
import type { CityTheme, EntryLocation } from '@/lib/entry-location';
import { SlideStep } from './slide-step';
import { EntryPrivacy } from './regional-entry';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

type Icon = typeof Bus;
type Mode = { l: string; d: string; c: string; I: Icon };
type Card = { brand: string; tag: string; bg: string; fg: string };
type Theme = { name: string; accent: string; modes: Mode[]; card: Card; networks: string[] };

const R = '#e8322f', B = '#2f7de1', G = '#22b35e', P = '#8a3fd1', Y = '#f2c230', O = '#f06a1f', T = '#14a7a0', K = '#e8559a';

const CITY: Record<CityTheme, Theme> = {
  chicago: { name: 'Chicago', accent: '#36a9f2', card: { brand: 'Chicago', tag: 'Ventra-style card', bg: 'linear-gradient(135deg,#1c8ff0,#0d4fae)', fg: '#fff' },
    modes: [{ l: 'CTA Rail', d: 'L trains', c: R, I: TrainFront }, { l: 'CTA Bus', d: 'Bus service', c: B, I: Bus }, { l: 'Metra', d: 'Commuter rail', c: G, I: TrainFrontTunnel }, { l: 'Pace', d: 'Suburban bus', c: P, I: Bus }, { l: 'Water Taxi', d: 'River and lakefront', c: Y, I: Ship }, { l: 'Airports', d: 'ORD and MDW', c: O, I: Plane }],
    networks: ['CTA', 'Metra', 'Pace', 'South Shore Line'] },
  'los-angeles': { name: 'Los Angeles', accent: '#f08a3c', card: { brand: 'Los Angeles', tag: 'TAP-style card', bg: 'linear-gradient(135deg,#1c9ad6,#0b5b99)', fg: '#fff' },
    modes: [{ l: 'Metro Rail', d: 'A, B, D, E, K lines', c: R, I: TrainFront }, { l: 'Metro Bus', d: 'Countywide', c: O, I: Bus }, { l: 'Metrolink', d: 'Regional rail', c: B, I: TrainFrontTunnel }, { l: 'Big Blue Bus', d: 'Santa Monica', c: T, I: Bus }, { l: 'LAX', d: 'FlyAway and shuttles', c: P, I: Plane }],
    networks: ['LA Metro', 'Metrolink', 'Big Blue Bus', 'Foothill Transit'] },
  'san-francisco': { name: 'San Francisco', accent: '#f0603a', card: { brand: 'Bay Area', tag: 'Clipper-style card', bg: 'linear-gradient(135deg,#1e7fd1,#0a3d7a)', fg: '#fff' },
    modes: [{ l: 'BART', d: 'Regional rapid transit', c: B, I: TrainFrontTunnel }, { l: 'Muni', d: 'Metro and bus', c: R, I: TramFront }, { l: 'Cable Car', d: 'Powell and California', c: Y, I: CableCar }, { l: 'Caltrain', d: 'Peninsula rail', c: G, I: TrainFront }, { l: 'Ferry', d: 'Bay crossings', c: T, I: Ship }, { l: 'Airports', d: 'SFO and OAK', c: O, I: Plane }],
    networks: ['SF Muni', 'BART', 'Caltrain', 'Golden Gate Transit', 'SF Bay Ferry'] },
  philadelphia: { name: 'Philadelphia', accent: '#3a8ef0', card: { brand: 'Philadelphia', tag: 'SEPTA Key-style card', bg: 'linear-gradient(135deg,#2560c8,#13306e)', fg: '#fff' },
    modes: [{ l: 'Metro', d: 'L and B lines', c: B, I: TrainFrontTunnel }, { l: 'SEPTA Bus', d: 'City and suburban', c: G, I: Bus }, { l: 'Trolley', d: 'T and G lines', c: Y, I: TramFront }, { l: 'Regional Rail', d: 'Suburban lines', c: P, I: TrainFront }, { l: 'PATCO', d: 'To South Jersey', c: R, I: TrainFront }, { l: 'Airport', d: 'PHL Airport Line', c: O, I: Plane }],
    networks: ['SEPTA', 'PATCO', 'NJ TRANSIT River LINE'] },
  dallas: { name: 'Dallas', accent: '#22b35e', card: { brand: 'Dallas', tag: 'GoPass-style card', bg: 'linear-gradient(135deg,#1d6fe0,#0b3a8a)', fg: '#fff' },
    modes: [{ l: 'DART Rail', d: 'Light rail', c: R, I: TramFront }, { l: 'DART Bus', d: 'Bus service', c: B, I: Bus }, { l: 'TRE', d: 'Trinity Railway Express', c: G, I: TrainFront }, { l: 'Streetcar', d: 'Oak Cliff', c: Y, I: TramFront }, { l: 'Airports', d: 'DFW and DAL', c: O, I: Plane }],
    networks: ['DART', 'Trinity Metro', 'TRE', 'DCTA'] },
  miami: { name: 'Miami', accent: '#ff4fa8', card: { brand: 'Miami', tag: 'EASY Card-style card', bg: 'linear-gradient(135deg,#ff6fa8,#ff9a3c)', fg: '#1a0b20' },
    modes: [{ l: 'Metrorail', d: 'Orange and Green', c: O, I: TrainFront }, { l: 'Metromover', d: 'Downtown loops', c: T, I: TramFront }, { l: 'Metrobus', d: 'Countywide', c: B, I: Bus }, { l: 'Tri-Rail', d: 'South Florida rail', c: G, I: TrainFrontTunnel }, { l: 'Brightline', d: 'Intercity rail', c: Y, I: TrainFrontTunnel }, { l: 'Airports', d: 'MIA and FLL', c: K, I: Plane }],
    networks: ['Miami-Dade Transit', 'Tri-Rail', 'Brightline', 'Broward County Transit'] },
  atlanta: { name: 'Atlanta', accent: '#f2a52a', card: { brand: 'Atlanta', tag: 'Breeze-style card', bg: 'linear-gradient(135deg,#2b9bf0,#1554a8)', fg: '#fff' },
    modes: [{ l: 'MARTA Rail', d: 'Red, Gold, Blue, Green', c: O, I: TrainFront }, { l: 'MARTA Bus', d: 'Bus service', c: B, I: Bus }, { l: 'Streetcar', d: 'Downtown loop', c: G, I: TramFront }, { l: 'Xpress', d: 'Regional commuter', c: P, I: Bus }, { l: 'Airport', d: 'ATL', c: R, I: Plane }],
    networks: ['MARTA', 'Atlanta Streetcar', 'Xpress', 'CobbLinc'] },
  detroit: { name: 'Detroit', accent: '#27c08a', card: { brand: 'Detroit', tag: 'Dart-style pass', bg: 'linear-gradient(135deg,#1e88d8,#0c3f7a)', fg: '#fff' },
    modes: [{ l: 'DDOT', d: 'City bus', c: G, I: Bus }, { l: 'SMART', d: 'Suburban bus', c: R, I: Bus }, { l: 'QLINE', d: 'Woodward streetcar', c: B, I: TramFront }, { l: 'People Mover', d: 'Downtown loop', c: P, I: TrainFront }, { l: 'Airport', d: 'DTW', c: O, I: Plane }],
    networks: ['DDOT', 'SMART', 'QLINE', 'Detroit People Mover'] },
  cincinnati: { name: 'Cincinnati', accent: '#f04a3c', card: { brand: 'Cincinnati', tag: 'Metro-style card', bg: 'linear-gradient(135deg,#1a73d6,#0b3a7a)', fg: '#fff' },
    modes: [{ l: 'Metro', d: 'Bus and MetroNow', c: R, I: Bus }, { l: 'Connector', d: 'Streetcar', c: G, I: TramFront }, { l: 'TANK', d: 'Northern Kentucky', c: B, I: Bus }, { l: 'Amtrak', d: 'Union Terminal', c: P, I: TrainFront }, { l: 'Airport', d: 'CVG links', c: O, I: Plane }],
    networks: ['Cincinnati Metro', 'Connector', 'TANK'] },
  'new-jersey': { name: 'New Jersey', accent: '#f26a2a', card: { brand: 'New Jersey', tag: 'Transit card', bg: 'linear-gradient(135deg,#1f5fd1,#122f6e)', fg: '#fff' },
    modes: [{ l: 'NJ TRANSIT Rail', d: 'Commuter rail', c: B, I: TrainFront }, { l: 'NJ TRANSIT Bus', d: 'Statewide', c: O, I: Bus }, { l: 'Light Rail', d: 'HBLR, Newark, River', c: P, I: TramFront }, { l: 'PATH', d: 'To Manhattan', c: R, I: TrainFrontTunnel }, { l: 'Ferry', d: 'Hudson crossings', c: T, I: Ship }, { l: 'Airport', d: 'EWR and regional', c: Y, I: Plane }],
    networks: ['NJ TRANSIT', 'PATH', 'PATCO', 'NY Waterway'] },
  connecticut: { name: 'Connecticut', accent: '#2fa6d9', card: { brand: 'Connecticut', tag: 'Transit card', bg: 'linear-gradient(135deg,#1d4f9e,#0d2550)', fg: '#f6efe0' },
    modes: [{ l: 'CTtransit', d: 'Local and express bus', c: B, I: Bus }, { l: 'CTrail', d: 'Hartford Line, Shore Line East', c: R, I: TrainFront }, { l: 'Metro-North', d: 'New Haven Line', c: G, I: TrainFrontTunnel }, { l: 'CTfastrak', d: 'Bus rapid transit', c: Y, I: Bus }, { l: 'Ferry', d: 'Long Island Sound', c: T, I: Ship }, { l: 'Airport', d: 'BDL', c: O, I: Plane }],
    networks: ['CTtransit', 'CTrail', 'Metro-North', 'CTfastrak'] },
};

const DEFAULT_MODES: Mode[] = [{ l: 'Subway', d: '', c: G, I: TrainFrontTunnel }, { l: 'Rail', d: '', c: Y, I: TrainFront }, { l: 'Bus', d: '', c: O, I: Bus }, { l: 'Tram', d: '', c: R, I: TramFront }, { l: 'Ferry', d: '', c: B, I: Ship }, { l: 'Airports', d: '', c: P, I: Plane }];

const LINES = [
  ['M-20 120 H180 Q210 120 210 150 V420 Q210 450 240 450 H620', R], ['M520 -20 V160 Q520 190 490 190 H330 Q300 190 300 220 V700', B],
  ['M-20 300 H90 Q120 300 120 330 V760', G], ['M620 260 H420 Q390 260 390 290 V560 Q390 590 360 590 H-20', Y],
  ['M140 -20 V60 Q140 90 170 90 H620', P], ['M-20 520 H260 Q290 520 290 550 V1020', O], ['M460 1020 V700 Q460 670 490 670 H620', T],
  ['M60 640 L200 780 H620', K], ['M580 360 V900', B], ['M-20 860 H360', G],
] as const;

function NeonMap({ dim }: { dim?: boolean }) {
  return (
    <svg viewBox="0 0 600 1000" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity: dim ? 0.7 : 1 }} aria-hidden>
      <defs><filter id="ct-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5" /></filter></defs>
      {LINES.map(([d, c], i) => (
        <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={d} stroke={c} strokeWidth="10" opacity=".4" filter="url(#ct-glow)" />
          <path d={d} stroke={c} strokeWidth="3.5" opacity=".95" />
        </g>
      ))}
      {[[210, 300], [300, 450], [390, 400], [120, 520], [290, 520], [460, 670], [520, 90], [200, 780]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="7" fill="#0a0a10" stroke="#f4f1ea" strokeWidth="3" />
      ))}
    </svg>
  );
}

/** Original Connecticut silhouette: Hartford towers and gold-domed Capitol over Long Island Sound. */
function CtSkyline() {
  return (
    <svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs><linearGradient id="ct-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1430" stopOpacity="0" /><stop offset="1" stopColor="#1b2b5a" /></linearGradient></defs>
      <rect width="1200" height="300" fill="url(#ct-sky)" />
      <g fill="#26345f" stroke="#4f78c8" strokeWidth="1.5">
        <path d="M0 300 V250 H60 V210 H110 V260 H170 V190 H230 V300Z" />
        <path d="M300 300 V150 H340 V110 H350 V60 L362 30 L374 60 V110 H384 V150 H420 V300Z" />
        <path d="M440 300 V180 H520 V300Z M540 300 V120 H610 V300Z M630 300 V200 H700 V300Z" />
        <path d="M760 300 V210 H800 V180 Q840 120 880 180 V210 H920 V300Z" />
        <path d="M940 300 V160 H1000 V300Z M1020 300 V230 H1200 V300Z" />
      </g>
      <path d="M800 180 Q840 120 880 180Z" fill="#e7b64a" />
      <rect x="836" y="104" width="8" height="22" fill="#e7b64a" />
      <g fill="#f2d37a" opacity=".85">
        {Array.from({ length: 60 }, (_, i) => <rect key={i} x={310 + ((i * 53) % 700)} y={160 + ((i * 37) % 120)} width="5" height="7" />)}
      </g>
      <rect y="300" width="1200" height="100" fill="#07102a" />
      <g opacity=".7">
        {[[360, B], [575, G], [840, '#e7b64a'], [970, R], [120, T]].map(([x, c], i) => <rect key={i} x={Number(x) - 6} y={306} width="12" height="80" fill={String(c)} opacity=".45" />)}
      </g>
    </svg>
  );
}

function Chevrons() {
  return (
    <span className="flex items-center gap-[0.25em]" aria-hidden>
      {[0, 1, 2, 3].map((i) => <svg key={i} viewBox="0 0 12 20" className="entry-nudge h-[0.8em] w-[0.5em]" style={{ animationDelay: `${i * 0.12}s` }}><path d="M10 2 L2 10 L10 18" stroke="currentColor" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
    </span>
  );
}

function FareCard({ card }: { card: Card }) {
  return (
    <div className="relative aspect-[1.586] w-full overflow-hidden rounded-xl shadow-[0_14px_34px_rgba(0,0,0,.65)] ring-1 ring-white/30" style={{ background: card.bg, color: card.fg }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(255,255,255,.35),transparent_45%)]" />
      <div className="absolute left-[8%] top-[10%] h-[18%] w-[16%] rounded-[4px] bg-gradient-to-br from-[#f3d98a] to-[#b98d2e] opacity-90" />
      <p className="absolute right-[7%] top-[9%] text-[clamp(0.55rem,1.6vw,0.75rem)] font-bold uppercase tracking-[0.18em] opacity-80">Transtop</p>
      <p className="absolute bottom-[26%] left-[8%] text-[clamp(1rem,4vw,1.6rem)] font-extrabold leading-none tracking-tight">{card.brand}</p>
      <p className="absolute bottom-[10%] left-[8%] text-[clamp(0.5rem,1.4vw,0.68rem)] font-semibold uppercase tracking-[0.14em] opacity-80">{card.tag}</p>
    </div>
  );
}

/** Illustrated US one-dollar note for the welcome interaction, never a payment. */
function EntryBill() {
  return (
    <div className="relative aspect-[2.35] w-full overflow-hidden rounded-[3px] border border-[#3d5a3c] bg-[linear-gradient(180deg,#e4e9d6,#c9d4b4)] text-[#28432a] shadow-[0_10px_26px_rgba(0,0,0,.6)]">
      <div className="absolute inset-[5%] rounded-[2px] border-2 border-[#456a46]/70" />
      <span className="absolute left-[8%] top-[9%] font-serif text-[clamp(0.8rem,2.6vw,1.2rem)] font-bold leading-none">1</span>
      <span className="absolute right-[8%] top-[9%] font-serif text-[clamp(0.8rem,2.6vw,1.2rem)] font-bold leading-none">1</span>
      <span className="absolute bottom-[9%] left-[8%] font-serif text-[clamp(0.8rem,2.6vw,1.2rem)] font-bold leading-none">1</span>
      <span className="absolute bottom-[9%] right-[8%] font-serif text-[clamp(0.8rem,2.6vw,1.2rem)] font-bold leading-none">1</span>
      <div className="absolute left-1/2 top-1/2 flex h-[62%] aspect-[0.8] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[50%] border-2 border-[#456a46] bg-[#d7dfc4]">
        <svg viewBox="0 0 48 60" className="h-full w-full" aria-hidden>
          <path d="M8 58V51L16 45L20 41V34C15 31 14 25 16 20C12 17 15 7 24 7C33 7 37 16 33 21C35 27 31 32 28 34V41L33 46L41 52V58Z" fill="#77866c" stroke="#28432a" strokeWidth="1.3"/>
          <path d="M15 23C10 22 11 13 15 10M33 23C39 22 37 12 32 10M17 12Q24 5 32 13M19 25H22M27 25H30M25 26L23 31H26M22 35Q25 37 28 34M20 42L24 49L28 42M24 49V58M16 46L11 56M32 46L37 56" fill="none" stroke="#28432a" strokeWidth="1.1"/>
        </svg>
      </div>
      <p className="absolute inset-x-0 top-[13%] text-center font-serif text-[clamp(0.32rem,1vw,0.48rem)] font-bold uppercase tracking-[0.12em]">United States of America</p>
      <p className="absolute inset-x-0 bottom-[12%] text-center font-serif text-[clamp(0.38rem,1.2vw,0.58rem)] font-bold uppercase tracking-[0.2em]">One Dollar</p>
      <span className="absolute right-[24%] top-1/2 h-[30%] aspect-square -translate-y-1/2 rounded-full border-2 border-[#3f7a54] opacity-70" />
    </div>
  );
}

function Farebox({ accent, lit }: { accent: string; lit: boolean }) {
  return (
    <svg viewBox="0 0 160 230" className="h-full w-full drop-shadow-[0_12px_24px_rgba(0,0,0,.7)]" aria-hidden>
      <defs><linearGradient id="fb-steel" x1="0" x2="1"><stop offset="0" stopColor="#5d6270" /><stop offset=".45" stopColor="#c9ccd4" /><stop offset="1" stopColor="#3b3f4a" /></linearGradient></defs>
      <rect x="6" y="10" width="148" height="150" rx="14" fill="url(#fb-steel)" stroke="#1b1d22" strokeWidth="3" />
      <rect x="24" y="30" width="62" height="74" rx="8" fill="#0e1424" stroke={accent} strokeWidth="3" />
      <g transform="translate(37 46)" stroke="#f4f1ea" strokeWidth="4" fill="none" strokeLinejoin="round"><rect x="0" y="0" width="36" height="34" rx="6" /><path d="M0 18 H36 M8 34 V42 M28 34 V42" /></g>
      <rect x="112" y="40" width="34" height="92" rx="6" fill="#0b0f18" stroke={accent} strokeWidth="3" style={{ opacity: lit ? 1 : 0.8 }} />
      <rect x="124" y="50" width="10" height="72" rx="3" fill={accent} style={{ opacity: lit ? 1 : 0.55, transition: 'opacity 300ms' }} />
      <rect x="24" y="118" width="62" height="10" rx="5" fill="#1b1d22" />
    </svg>
  );
}

function FareTrack({ onDone, mode, accent, card, cityName }: { onDone: () => void; mode: 'bill' | 'card'; accent: string; card: Card; cityName: string }) {
  const g = useSwipeGesture(onDone);
  const rm = prefersReducedMotion();
  const bill = mode === 'bill';
  const name = bill ? 'Illustrated US one-dollar bill' : `${card.tag}`;
  const verb = bill ? 'into the farebox' : 'along the reader';
  return (
    <div className="relative z-10">
      <p id="entry-help" className="sr-only">{`Slide the ${name} right to left ${verb} to enter Transtop. Nothing is charged. Keyboard: Left Arrow to slide, Right Arrow to slide back, Home to reset. Entry at 100 percent by keyboard, or release after at least 85 percent when dragging.`}</p>
      <div className="relative mx-auto w-full max-w-6xl md:px-10">
        <div ref={g.track} data-testid="track-swipe"
          className="relative flex h-[clamp(4.2rem,17vw,6.5rem)] items-center overflow-visible border-y border-white/15 bg-[linear-gradient(180deg,#2d3140,#151821)] md:rounded-xl md:border"
          style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,.12), 0 0 40px ${accent}22` }}>
          {bill && <div className="pointer-events-none absolute -top-[55%] left-1 z-20 h-[200%] w-[clamp(4.8rem,19vw,8.5rem)]"><Farebox accent={accent} lit={g.p > 0.6} /></div>}
          <div className={`pointer-events-none flex items-center gap-4 text-[clamp(1.05rem,4.4vw,1.9rem)] font-semibold text-[#f4f1ea] ${bill ? 'pl-[clamp(5.6rem,22vw,10rem)]' : 'pl-[5vw] md:pl-8'}`} style={{ opacity: Math.max(0, 1 - g.p * 1.6), color: accent }}>
            <Chevrons /><span className="text-[#f4f1ea]">{bill ? 'Slide to start' : 'Slide to explore'}</span>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-full origin-right md:rounded-xl" aria-hidden
            style={{ transform: `scaleX(${g.p})`, background: `linear-gradient(270deg, ${accent}55, ${accent}08)`, transition: g.dragging || rm ? 'none' : 'transform 380ms ease' }} />
          <div ref={g.card} role="slider" tabIndex={0} aria-label={`${name} for ${cityName}, swipe left to enter Transtop`} aria-describedby="entry-help"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.pct} aria-valuetext={`${g.pct} percent${g.leaving ? ', entering' : ''}`}
            {...g.handlers} data-testid={bill ? 'slider-entry-bill' : 'slider-entry-card'}
            className={`absolute right-2 top-1/2 z-10 cursor-grab touch-none rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:cursor-grabbing ${bill ? 'w-[clamp(7rem,30vw,15rem)]' : 'w-[clamp(7.5rem,32vw,14rem)]'}`}
            style={{ ['--tw-ring-color' as string]: accent, opacity: bill && g.leaving && !rm ? 0 : 1,
              transform: `translate(${-g.p * g.travel - (bill && g.leaving && !rm ? 40 : 0)}px, -50%) rotate(${bill ? 0 : g.dragging && !rm ? -1.5 : -4}deg)`,
              transition: g.dragging || rm ? 'none' : 'transform 380ms cubic-bezier(.2,.9,.25,1.15), opacity 450ms ease 150ms' }}>
            {bill ? <EntryBill /> : <FareCard card={card} />}
          </div>
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-6xl px-[5vw] text-xs font-semibold uppercase tracking-[0.16em] text-[#f4f1ea]/70 md:px-10" aria-live="polite" data-testid="text-swipe-progress">
        {g.leaving ? (bill ? 'Accepted. Welcome aboard' : 'Entry confirmed') : g.pct > 0 ? `${g.pct}% · keep going left` : `Slide the ${bill ? 'note into the farebox' : 'card left'} · keyboard: Left Arrow · nothing is charged`}
      </p>
      <SlideStep onAdvance={g.advance} leaving={g.leaving} />
    </div>
  );
}

function Badge({ m, i }: { m: Mode; i: number }) {
  return (
    <li className="flex aspect-square w-[clamp(3.6rem,15vw,6rem)] items-center justify-center rounded-full ring-[3px] ring-black/50"
      style={{ background: m.c, boxShadow: `0 0 0 2px ${m.c}55, 0 0 28px ${m.c}88`, transform: `translateY(${i % 3 === 1 ? '22%' : '0'})` }}>
      <m.I className="h-[50%] w-[50%]" color="#fff" strokeWidth={2.1} aria-hidden /><span className="sr-only">{m.l}</span>
    </li>
  );
}

export function CityEntry({ theme, location, onDone }: { theme: CityTheme | 'default'; location: EntryLocation | null; onDone: () => void }) {
  const isDefault = theme === 'default';
  const t: Theme = isDefault
    ? { name: location?.city ?? 'Your city', accent: '#3fc1f2', modes: DEFAULT_MODES, card: CITY.chicago.card, networks: [] }
    : CITY[theme];
  const operator = isDefault ? (location?.operator ?? 'Local transit') : null;
  const skyline: ReactNode = theme === 'connecticut'
    ? <CtSkyline />
    : <img src={`${BASE}/entry/skylines/${theme}.webp`} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-cover object-[50%_70%]" />;
  return (
    <>
      <NeonMap dim={!isDefault} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_25%_20%,rgba(5,5,8,.85),transparent_55%)]" aria-hidden />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 gap-[3dvh] px-[6vw] pt-[max(8dvh,calc(env(safe-area-inset-top)+3.5rem))] md:grid-cols-[1fr_auto] md:gap-x-16 md:px-10 md:pt-[10dvh]">
        <div>
          <h1 aria-label="Transtop" className="entry-title text-[clamp(3.4rem,17vw,9.5rem)] font-extrabold leading-[0.88] tracking-[-0.05em] [text-shadow:0_4px_30px_rgba(0,0,0,.8)]">
            Transt<span className="relative">o<span className="absolute left-1/2 top-[56%] h-[0.2em] w-[0.2em] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: t.modes[0].c }} aria-hidden /></span>p
          </h1>
          <p className="mt-2 text-[clamp(1.1rem,4.4vw,2rem)] font-semibold tracking-tight">(Transit Stop)</p>
          {isDefault ? (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border-2 px-4 py-1.5 text-[clamp(0.95rem,3.8vw,1.35rem)] font-bold uppercase tracking-[0.06em]" style={{ borderColor: t.accent, boxShadow: `0 0 24px ${t.accent}55` }} data-testid="text-entry-city">
              <MapPin className="h-[1em] w-[1em]" color="#ef4a5a" aria-hidden />{t.name}<span className="font-semibold normal-case tracking-normal text-[#f4f1ea]/70">· {operator}</span>
            </p>
          ) : (
            <p className="mt-3 text-[clamp(1.2rem,5.2vw,2.2rem)] font-extrabold uppercase tracking-[0.22em]" style={{ color: t.accent, textShadow: `0 0 22px ${t.accent}88` }} data-testid="text-entry-city">{t.name}</p>
          )}
          <ul className="mt-[3.5dvh] grid max-w-xl grid-cols-2 gap-x-6 gap-y-2.5 md:grid-cols-3" aria-label="Regional services" data-testid="list-entry-modes">
            {t.modes.map((m) => (
              <li key={m.l} className="border-l-[3px] pl-2.5 leading-tight" style={{ borderColor: m.c }}>
                <span className="block text-[clamp(0.85rem,3.4vw,1.05rem)] font-bold">{m.l}</span>
                {m.d && <span className="block text-[11px] text-[#f4f1ea]/70">{m.d}</span>}
              </li>
            ))}
          </ul>
        </div>
        <ul className="grid w-fit grid-cols-3 gap-x-[4vw] gap-y-[1.5dvh] self-center justify-self-center pb-[2dvh] md:gap-x-6 md:self-start md:pt-6" aria-hidden>
          {t.modes.slice(0, 6).map((m, i) => <Badge key={m.l} m={m} i={i} />)}
        </ul>
      </div>

      <div className="pointer-events-none relative z-0 -mb-[clamp(2rem,8vw,3.5rem)] h-[clamp(9rem,30dvh,19rem)] w-full overflow-hidden [mask-image:linear-gradient(180deg,transparent,#000_28%,#000_72%,transparent)]" aria-hidden data-testid="img-entry-skyline">
        {skyline}
      </div>

      <FareTrack onDone={onDone} mode={isDefault ? 'bill' : 'card'} accent={t.accent} card={t.card} cityName={t.name} />

      <footer className="relative z-10 mx-auto mt-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-[6vw] pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 md:px-10 before:absolute before:inset-0 before:-z-10 before:bg-[linear-gradient(180deg,transparent,#050506_35%)]">
        {t.networks.length > 0 ? (
          <div className="max-w-sm">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-bold" data-testid="list-entry-networks">{t.networks.map((n) => <li key={n}>{n}</li>)}</ul>
            <p className="mt-1 text-[11px] text-[#f4f1ea]/60">Regional context only. Transtop coverage varies by service.</p>
          </div>
        ) : <p className="max-w-xs text-[11px] text-[#f4f1ea]/60">City and operator are approximate from your network, or generic when unknown. The note is decorative: nothing is charged.</p>}
        <EntryPrivacy />
      </footer>
    </>
  );
}
