import { type ReactNode } from 'react';
import { prefersReducedMotion, useSwipeGesture } from '@/hooks/use-swipe-gesture';

export function Chevrons({ arrow = false }: { arrow?: boolean }) {
  if (arrow) return <svg viewBox="0 0 48 20" className="h-[0.9em] w-[2.2em]" aria-hidden><path d="M48 10 H4 M12 2 L4 10 L12 18" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return (
    <span className="flex items-center gap-[0.3em]" aria-hidden>
      {[0, 1, 2, 3].map((i) => <svg key={i} viewBox="0 0 12 20" className="entry-nudge h-[0.75em] w-[0.5em]" style={{ animationDelay: `${i * 0.12}s` }}><path d="M10 2 L2 10 L10 18" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
    </span>
  );
}

type Props = {
  onDone: () => void;
  label: ReactNode;
  cardName: string;
  accent: string;
  help: string;
  card: ReactNode;
  bar?: string;
  locale?: 'en' | 'fr' | 'ja';
};

/** Shared right-to-left swipe track used by the regional posters. */
export function SwipeTrack({ onDone, label, cardName, accent, help, card, bar = '#4a4a4f', locale = 'en' }: Props) {
  const g = useSwipeGesture(onDone);
  const rm = prefersReducedMotion();
  const copy = locale === 'fr' ? {
    label: `${cardName} : glissez vers la gauche pour entrer dans Transtop`,
    value: `${g.pct} pour cent${g.leaving ? ', entrée' : ''}`,
    progress: g.leaving ? 'Entrée confirmée' : g.pct > 0 ? `${g.pct} % · continuez vers la gauche` : 'Glissez la carte vers la gauche · clavier : flèche gauche',
  } : locale === 'ja' ? {
    label: `${cardName}。左にスライドしてTranstopへ`,
    value: `${g.pct}パーセント${g.leaving ? '、入ります' : ''}`,
    progress: g.leaving ? '入ります' : g.pct > 0 ? `${g.pct}% · 左へスライド` : 'カードを左へスライド · キーボード：左矢印',
  } : {
    label: `${cardName}, swipe left to enter Transtop`,
    value: `${g.pct} percent swiped${g.leaving ? ', entering' : ''}`,
    progress: g.leaving ? 'Entry confirmed' : g.pct > 0 ? `${g.pct}% · keep going left` : 'Swipe the card left to enter · keyboard: Left Arrow',
  };
  return (
    <div className="relative z-10" lang={locale}>
      <p id="entry-help" className="sr-only">{help}</p>
      <div ref={g.track} data-testid="track-swipe"
        className="relative mx-auto flex h-[clamp(3.6rem,15vw,6.5rem)] w-full max-w-6xl items-center border-y border-white/10 md:rounded-md"
        style={{ background: `linear-gradient(180deg, ${bar}, #2c2c30)` }}>
        <div className="pointer-events-none flex items-center gap-[5vw] pl-[5vw] text-[clamp(1.05rem,4.4vw,2rem)] font-semibold text-[#f4f1ea] md:gap-10 md:pl-10" style={{ opacity: Math.max(0, 1 - g.p * 1.5) }}>
          {label}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 origin-right" aria-hidden
          style={{ width: '100%', transform: `scaleX(${g.p})`, background: `linear-gradient(270deg, ${accent}55, ${accent}11)`, transition: g.dragging || rm ? 'none' : 'transform 380ms ease' }} />
        <div ref={g.card} role="slider" tabIndex={0} aria-label={copy.label} aria-describedby="entry-help"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.pct} aria-valuetext={copy.value}
          {...g.handlers} data-testid="slider-entry-card"
          className="absolute right-2 top-1/2 w-[clamp(7rem,30vw,15rem)] cursor-grab touch-none rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:cursor-grabbing"
          style={{ ['--tw-ring-color' as string]: accent, transform: `translate(${-g.p * g.travel}px, -50%) rotate(${!rm && g.dragging ? -1.5 : -3}deg)`, transition: g.dragging || rm ? 'none' : 'transform 380ms cubic-bezier(.2,.9,.25,1.15)' }}>
          {card}
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-6xl px-[5vw] text-xs font-semibold uppercase tracking-[0.16em] text-[#f4f1ea]/65 md:px-10" aria-live="polite" data-testid="text-swipe-progress">
        {copy.progress}
      </p>
    </div>
  );
}
