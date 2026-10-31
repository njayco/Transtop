type Props = {
  onAdvance: () => void;
  leaving: boolean;
  locale?: 'en' | 'fr' | 'ja';
};

/** A native button provides tap, click and keyboard activation without dragging. */
export function SlideStep({ onAdvance, leaving, locale = 'en' }: Props) {
  const copy = locale === 'fr'
    ? { label: 'Avancer la carte de 10 %', help: 'Appuyez plusieurs fois pour entrer sans glisser.' }
    : locale === 'ja'
      ? { label: 'カードを10%進める', help: '繰り返しタップすると、ドラッグせずに入れます。' }
      : { label: 'Slide to enter · 10%', help: 'Tap or click repeatedly to enter without dragging.' };
  return (
    <div className="mx-auto mt-3 max-w-6xl px-[5vw] md:px-10">
      <button type="button" onClick={onAdvance} disabled={leaving}
        data-testid="button-slide-step" aria-describedby="entry-step-help"
        className="min-h-11 rounded-lg border border-[#f4f1ea]/70 bg-black px-4 py-2 text-sm font-semibold text-[#f4f1ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-60">
        {copy.label}
      </button>
      <p id="entry-step-help" className="mt-2 text-xs text-[#f4f1ea]">{copy.help}</p>
    </div>
  );
}
