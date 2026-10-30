import { useEffect, useRef } from 'react';
import { ChevronsLeft } from 'lucide-react';
import { ModeIcon, TransitLines } from './transit';

export function Intro({ onDone }: { onDone: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    btn.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') doneRef.current(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome to Transtop" className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
      <TransitLines className="absolute inset-0 h-full w-full opacity-70" />
      <div className="relative flex flex-1 flex-col justify-center px-8">
        <h1 className="rise font-display text-7xl md:text-9xl">Transtop</h1>
        <p className="rise mt-2 text-xl text-muted-foreground" style={{ animationDelay: '120ms' }}>(Transit Stop)</p>
        <div className="rise mt-10 flex gap-4" style={{ animationDelay: '240ms' }}>
          {['subway', 'bus', 'rail'].map((t) => <ModeIcon key={t} type={t} size={72} />)}
        </div>
      </div>
      <div className="relative mb-10 flex h-20 items-center overflow-hidden bg-white/10">
        <span className="flex items-center gap-2 pl-6 text-lg font-bold text-muted-foreground"><ChevronsLeft className="h-6 w-6" />Tap in</span>
        <div className="card-slide absolute right-4 flex h-14 w-48 items-center justify-center rounded-lg bg-primary font-display text-xl text-primary-foreground shadow-2xl">Transtop</div>
      </div>
      <div className="relative px-8 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <button ref={btn} onClick={onDone} data-testid="button-get-started" className="h-14 w-full rounded-2xl bg-foreground text-lg font-extrabold text-background md:w-auto md:px-12">Get started</button>
      </div>
    </div>
  );
}
