import { type ReactNode } from 'react';
import { Bus, Plane, Ship, TramFront, TrainFront, TrainFrontTunnel } from 'lucide-react';
import { SwipeTrack, Chevrons } from './swipe-track';
import { LondonCard, ParisCard, TokyoCard } from './cards';

type Line = { d: string; c: string };
type Region = 'london' | 'paris' | 'tokyo';

function RouteMap({ lines, stations, landmark }: { lines: Line[]; stations: [number, number][]; landmark?: ReactNode }) {
  return (
    <svg viewBox="0 0 600 1000" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs><filter id="rg-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4" /></filter></defs>
      {landmark}
      {lines.map((l, i) => (
        <g key={i} fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d={l.d} stroke={l.c} strokeWidth="9" opacity=".35" filter="url(#rg-glow)" />
          <path d={l.d} stroke={l.c} strokeWidth="4" opacity=".92" />
        </g>
      ))}
      {stations.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="7" fill="#f4f1ea" stroke="#0b0b0d" strokeWidth="3.5" />)}
    </svg>
  );
}

const LONDON: Line[] = [
  { d: 'M70 0 V260 Q70 320 130 320 H260 Q290 320 290 360 V1000', c: '#e32b2b' },
  { d: 'M0 155 H70 M105 0 V100 H200 V180', c: '#2a63d6' },
  { d: 'M0 290 H40 Q70 290 90 320 L120 360 H600', c: '#2aa4e8' },
  { d: 'M460 0 V90 H600 M460 90 V300 Q460 320 440 320 H300 V360', c: '#f2cc1b' },
  { d: 'M600 160 L520 240 V560 L490 600 V1000', c: '#ef6aa0' },
  { d: 'M0 480 H140 Q160 480 160 500 V620 H360 L420 700 H600', c: '#f07a21' },
  { d: 'M0 370 Q40 370 70 420 L100 520 H260 Q300 520 330 550 H600', c: '#25b35a' },
  { d: 'M70 320 V580 Q70 620 110 620 H160', c: '#f2cc1b' },
  { d: 'M600 470 L520 470 L420 560 H360', c: '#16a59a' },
  { d: 'M380 760 L470 830 H600 M330 840 L420 920 H600', c: '#f2cc1b' },
];
const PARIS: Line[] = [
  { d: 'M60 0 V560 Q60 620 120 640 L260 690 H600', c: '#f2cc1b' },
  { d: 'M100 0 Q100 80 160 120 L260 220 V420', c: '#ef4fa0' },
  { d: 'M0 100 H120 Q160 100 200 80 H330 Q380 80 400 130', c: '#2a63d6' },
  { d: 'M600 50 H470 L400 130 V290 L340 350', c: '#f07a21' },
  { d: 'M0 240 Q60 240 120 290 L200 330 H420 L520 410 H600', c: '#e04fd0' },
  { d: 'M0 410 H200 L280 360', c: '#2aa4e8' },
  { d: 'M390 0 V280 L460 330 M460 330 V560 L520 590 H600', c: '#25b35a' },
  { d: 'M0 570 H120 L200 630 H340 L440 680 V1000', c: '#e32b2b' },
  { d: 'M125 520 H600', c: '#f2cc1b' },
  { d: 'M300 800 L400 860 H600 M260 870 H600', c: '#2aa4e8' },
];
const TOKYO: Line[] = [
  { d: 'M0 210 H160 V260 H420 L480 300', c: '#e32b2b' },
  { d: 'M0 300 H110 Q130 300 130 330 V360', c: '#25b35a' },
  { d: 'M230 260 V220 Q230 200 260 200 H310 L330 210 V420 H370 V560', c: '#f2cc1b' },
  { d: 'M460 0 V160 L410 210 L490 260 V700', c: '#e32b2b' },
  { d: 'M160 260 V370 L200 400 H270 V490 L380 620', c: '#ef6aa0' },
  { d: 'M270 340 H600', c: '#2aa4e8' },
  { d: 'M140 410 H320 L360 450 H600', c: '#2a63d6' },
  { d: 'M250 480 H540 L600 520', c: '#f07a21' },
  { d: 'M420 470 V620 L490 680 H600', c: '#9a9aa2' },
  { d: 'M100 600 L170 640 H360 V780', c: '#25b35a' },
];

function Roundel({ fg = '#fff' }: { fg?: string }) {
  return <svg viewBox="0 0 40 40" className="h-[60%] w-[60%]" aria-hidden><circle cx="20" cy="20" r="11" fill="none" stroke={fg} strokeWidth="5" /><rect x="3" y="17" width="34" height="6" fill={fg} /></svg>;
}
function NationalRail() {
  return <svg viewBox="0 0 40 40" className="h-[56%] w-[56%]" aria-hidden><path d="M4 14 H36 M4 26 H36 M12 6 L28 14 L12 26 L28 34" stroke="#fff" strokeWidth="4" fill="none" strokeLinejoin="round" /></svg>;
}
const ic = 'h-[52%] w-[52%]';
type Badge = { k: string; bg: string; l: string; node: ReactNode };
const BADGES: Record<Region, Badge[]> = {
  london: [
    { k: 'underground', bg: '#d8262b', l: 'Underground', node: <Roundel /> },
    { k: 'bus', bg: '#d8262b', l: 'Bus', node: <Bus className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'airport', bg: '#f07a21', l: 'Airport', node: <Plane className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'river', bg: '#1f63c9', l: 'River boat', node: <Ship className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'rail', bg: '#7b2fa3', l: 'National Rail', node: <NationalRail /> },
  ],
  paris: [
    { k: 'metro', bg: '#1f4fc9', l: 'Métro', node: <span className="flex h-[66%] w-[66%] items-center justify-center rounded-full border-[3px] border-white text-[1.5em] font-black text-white">M</span> },
    { k: 'bus', bg: '#2a9d4a', l: 'Bus', node: <Bus className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'airport', bg: '#f07a21', l: 'Aéroports', node: <Plane className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'tram', bg: '#7b2fa3', l: 'Tramway', node: <TramFront className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'rer', bg: '#d8262b', l: 'RER', node: <span className="flex h-[64%] w-[64%] items-center justify-center rounded-full border-[3px] border-white text-[0.95em] font-black text-white">RER</span> },
  ],
  tokyo: [
    { k: 'subway', bg: '#1f8a4c', l: 'Subway 地下鉄', node: <TrainFront className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'bus', bg: '#e8a516', l: 'Bus バス', node: <Bus className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'airport', bg: '#e8452a', l: 'Airport 空港', node: <Plane className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'shinkansen', bg: '#1f63c9', l: 'Shinkansen 新幹線', node: <TrainFrontTunnel className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'rail', bg: '#6b2f8f', l: 'Railway 鉄道', node: <TramFront className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
    { k: 'ferry', bg: '#e8559a', l: 'Ferry フェリー', node: <Ship className={ic} strokeWidth={2.2} color="#fff" aria-hidden /> },
  ],
};

function Badges({ region }: { region: Region }) {
  const list = BADGES[region];
  return (
    <ul className="grid w-fit grid-cols-3 gap-x-[4vw] gap-y-[2.4dvh] md:flex md:gap-6" aria-label={`Modes: ${list.map((b) => b.l).join(', ')}`} data-testid="list-entry-modes">
      {list.map((b) => (
        <li key={b.k} className="flex aspect-square w-[clamp(3.6rem,15vw,6.25rem)] items-center justify-center rounded-full text-[clamp(0.85rem,3.4vw,1.4rem)] shadow-[0_6px_20px_rgba(0,0,0,.45)] ring-2 ring-black/40" style={{ background: b.bg }}>
          {b.node}<span className="sr-only">{b.l}</span>
        </li>
      ))}
    </ul>
  );
}

const Eiffel = (
  <g opacity=".22" stroke="#c9c3d6" strokeWidth="2" fill="none">
    <path d="M500 40 V80 M500 80 L470 300 L440 420 M500 80 L530 300 L560 420 M478 230 H522 M462 300 H538 M450 360 Q500 320 550 360" />
    <path d="M488 140 L512 200 M512 140 L488 200 M476 240 L524 300 M524 240 L476 300" />
  </g>
);
const Fuji = (
  <g>
    <circle cx="490" cy="150" r="30" fill="#e8452a" />
    <path d="M380 220 L470 150 L510 150 L600 220Z" fill="#cfd3dc" opacity=".55" />
    <path d="M450 166 L470 150 H510 L530 166 L515 162 L500 172 L485 162Z" fill="#f4f1ea" />
    <path d="M600 112 Q565 145 535 180 M572 140 L548 115 M560 154 L590 177" stroke="#926176" strokeWidth="2" fill="none" />
    {[[540, 110], [565, 140], [585, 100], [535, 180], [590, 170]].map(([x, y], i) => (
      <g key={i} transform={`translate(${x} ${y})`} fill="#f2a8c8" opacity=".9">
        {[0, 72, 144, 216, 288].map(angle => <ellipse key={angle} cx="0" cy="-4" rx="3" ry="4.5" transform={`rotate(${angle})`} />)}
        <circle r="1.8" fill="#f4d6b2" />
      </g>
    ))}
    <g fill="#3a3a40" opacity=".85">
      <path d="M0 1000 V740 H30 V700 H55 V760 H90 V720 H120 V560 L128 520 L136 560 V720 H170 V690 H210 V745 H250 V705 H290 V760 H600 V1000Z" />
      <path d="M330 760 Q400 700 470 760" stroke="#5a5a62" strokeWidth="3" fill="none" />
    </g>
  </g>
);
const Thames = <path d="M0 720 Q120 680 220 740 T420 760 T600 700" stroke="#16313f" strokeWidth="38" fill="none" opacity=".7" />;

const CONTENT = {
  london: {
    map: <RouteMap lines={LONDON} landmark={Thames} stations={[[70, 155], [70, 320], [290, 360], [460, 90], [460, 320], [520, 470], [160, 620], [360, 620], [100, 520], [520, 560]]} />,
    label: <><Chevrons /><span>Slide Here</span></>, card: <LondonCard />, cardName: 'Oyster-inspired entry card', accent: '#2aa4e8',
    footerMark: <svg viewBox="0 0 60 40" className="h-14 w-20" aria-hidden><circle cx="30" cy="20" r="15" fill="none" stroke="#f4f1ea" strokeWidth="6" /><rect x="2" y="16" width="56" height="8" fill="#f4f1ea" /></svg>,
    footer: ['London Underground', 'London Buses', 'London Overground', 'DLR', 'Elizabeth line', 'National Rail'],
  },
  paris: {
    map: <RouteMap lines={PARIS} stations={[[60, 105], [60, 260], [200, 330], [390, 130], [400, 290], [460, 330], [520, 410], [125, 520], [200, 630], [340, 690], [440, 680]]} />,
    label: <><Chevrons /><span lang="fr">Glissez ici</span></>, card: <ParisCard />, cardName: 'Carte d’entrée inspirée du Navigo', accent: '#3d8de0',
    footerMark: <svg viewBox="0 0 60 60" className="h-14 w-14" aria-hidden><circle cx="30" cy="30" r="24" fill="none" stroke="#f4f1ea" strokeWidth="5" /><path d="M10 26 Q28 18 34 30 Q38 42 30 50" stroke="#f4f1ea" strokeWidth="5" fill="none" /></svg>,
    footer: ['Paris Métro', 'RER', 'Tramway', 'Bus', 'Transilien', 'Aéroports'],
  },
  tokyo: {
    map: <RouteMap lines={TOKYO} stations={[[160, 260], [330, 210], [410, 210], [270, 340], [330, 420], [490, 360], [270, 450], [490, 520], [380, 620], [490, 680]]} />,
    label: <><Chevrons arrow /><span className="flex flex-col leading-tight"><span lang="ja">次の目的地へ</span><span className="text-[0.62em] font-medium opacity-80">Slide to Explore</span></span></>,
    card: <TokyoCard />, cardName: 'Suica風の入場カード', accent: '#3fb24a',
    footerMark: null,
    footer: ['JR lines', 'Tokyo Metro', 'Toei Subway', 'Tokyu', 'Keio', 'and more'],
  },
} as const;

export function RegionalEntry({ region, onDone }: { region: Region; onDone: () => void }) {
  const c = CONTENT[region];
  const tokyo = region === 'tokyo';
  return (
    <>
      {c.map}
      {/* Landmarks have their own responsive frames: route-map cropping must not
          remove the mountain/blossoms or tower on wide and narrow screens. */}
      {region === 'paris' && <svg viewBox="430 30 140 410" className="pointer-events-none absolute right-[5vw] top-[7dvh] w-[clamp(5rem,16vw,14rem)]" aria-hidden>{Eiffel}</svg>}
      {tokyo && <>
        <svg viewBox="350 60 250 170" className="pointer-events-none absolute right-[1vw] top-[clamp(7.5rem,17dvh,12rem)] w-[clamp(8rem,26vw,23rem)] md:right-[5vw]" aria-hidden>{Fuji}</svg>
        <svg viewBox="0 500 600 280" preserveAspectRatio="none" className="pointer-events-none absolute bottom-[8rem] left-0 h-[clamp(5rem,18dvh,12rem)] w-full opacity-70" aria-hidden>{Fuji}</svg>
      </>}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_25%,rgba(5,5,7,.75),transparent_60%)]" aria-hidden />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-[7vw] pt-[max(9dvh,calc(env(safe-area-inset-top)+1.5rem))] md:px-12 md:pt-[11dvh]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 aria-label="Transtop" className="entry-title text-[clamp(3.2rem,17vw,10rem)] font-extrabold leading-[0.9] tracking-[-0.045em] [text-shadow:0_2px_24px_rgba(0,0,0,.7)]">
              {tokyo ? <>Transt<span className="relative">o<span className="absolute left-1/2 top-1/2 h-[0.2em] w-[0.2em] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e8452a]" aria-hidden /></span>p</> : 'Transtop'}
            </h1>
            {tokyo && <p lang="ja" className="mt-[1.4dvh] border-t border-[#f4f1ea]/60 pt-2 text-[clamp(1.2rem,4.6vw,2.2rem)] font-bold">トランストップ</p>}
            <p className="mt-[1.2dvh] text-[clamp(1.15rem,4.4vw,2.2rem)] font-semibold tracking-tight">(Transit Stop)</p>
          </div>
          {tokyo && <div className="hidden border-l border-[#f4f1ea]/50 pl-3 text-center min-[360px]:block"><p lang="ja" className="text-[clamp(1.6rem,6vw,3rem)] font-bold leading-none [writing-mode:vertical-rl]">東京</p><p className="mt-2 text-[9px] font-semibold tracking-[0.2em]">TOKYO<br />JAPAN</p></div>}
        </div>
        <div className="mt-[5dvh] pb-[3dvh]">
          <Badges region={region} />
          {tokyo && <ul aria-label="Tokyo artwork mode legend" className="mt-4 grid max-w-2xl grid-cols-3 gap-x-4 gap-y-2 text-[11px] leading-snug sm:grid-cols-6">
            {BADGES.tokyo.map(b => <li key={b.k} className="border-l-2 pl-2" style={{ borderColor: b.bg }}>{b.l}</li>)}
          </ul>}
        </div>
      </div>

      <SwipeTrack onDone={onDone} label={c.label} card={c.card} cardName={c.cardName} accent={c.accent}
        locale={region === 'paris' ? 'fr' : tokyo ? 'ja' : 'en'}
        help={region === 'paris'
          ? 'Glissez la carte de droite à gauche pour entrer. Clavier : flèche gauche pour avancer, flèche droite pour reculer, Home pour réinitialiser. Entrée à 100 % au clavier ou après un glissement d’au moins 85 %.'
          : tokyo
          ? 'カードを右から左にスライドしてください。キーボード：左矢印で進む、右矢印で戻る、Homeでリセット。キーボードは100%、ドラッグは85%以上で入ります。'
          : `Swipe the ${c.cardName} right to left to enter. Keyboard: Left Arrow to slide, Right Arrow to slide back, Home to reset. Entry at 100 percent by keyboard, or release after at least 85 percent when dragging.`} />

      <footer className="relative z-10 mx-auto mt-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-[6vw] pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 md:px-10">
        <div className="flex items-center gap-4">
          {c.footerMark}
          <ul className={tokyo ? 'flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold' : 'border-l border-[#f4f1ea]/50 pl-4 text-[13px] leading-[1.3]'} data-testid="list-entry-networks">
            {c.footer.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
        <EntryPrivacy />
      </footer>
    </>
  );
}

export function EntryPrivacy() {
  return (
    <div className="max-w-[23rem] space-y-1 text-[11px] leading-snug text-[#f4f1ea]/75" data-testid="text-unaffiliated">
      <p>Transtop is independent, not affiliated with any agency or card issuer. Artwork is decorative, not a ticket, payment or coverage promise.</p>
      <p>Approximate IP country picks the style locally on our server. VPNs can select the wrong country. No GPS permission is requested; Transtop does not store or log your IP for this lookup.</p>
      <p><a href="https://db-ip.com" className="underline focus-visible:outline focus-visible:outline-2">IP Geolocation by DB-IP</a> · <a href="https://creativecommons.org/licenses/by/4.0/" className="underline">CC BY 4.0</a></p>
    </div>
  );
}
