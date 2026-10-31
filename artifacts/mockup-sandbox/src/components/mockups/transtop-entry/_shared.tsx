import { CityEntry } from './_src/entry/city-entry';
import type { CityTheme, EntryLocation } from './_src/lib/entry-location';

// Copied verbatim from artifacts/transtop/src/components/intro.tsx (Intro wrapper styles).
const STYLE = `@keyframes entry-nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(-4px)}}.entry-nudge,[style*="entry-nudge"]{}.entry-nudge{animation:entry-nudge 1.8s ease-in-out infinite}.entry-title{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif}.reduce-motion .entry-nudge,.reduce-motion [style*="entry-nudge"]{animation:none!important}@media (prefers-reduced-motion:reduce){.entry-nudge,[style*="entry-nudge"]{animation:none!important}}@media (max-height:500px) and (orientation:landscape){[data-entry-variant] h1{font-size:clamp(2.4rem,9vh,4rem)!important}[data-entry-variant] ul[aria-label^="Modes"] li{width:clamp(2.6rem,11vh,3.6rem)!important}}`;

/** PREVIEW FIXTURE: renders the copied main-app CityEntry with static props; onDone is a no-op. */
export function EntryPreview({ theme, location }: { theme: CityTheme | 'default'; location: EntryLocation | null }) {
  return (
    <div role="main" aria-label="Transtop entry" data-entry-variant={theme}
      className="relative flex min-h-[100dvh] select-none flex-col overflow-hidden bg-[#050506] text-[#f4f1ea]">
      <style>{STYLE}</style>
      <p className="absolute left-2 top-2 z-50 rounded bg-[#f2c230] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-black">Preview fixture</p>
      <CityEntry theme={theme} location={location} onDone={() => {}} />
    </div>
  );
}
