import { Link } from 'wouter';
import { TransitLines } from '@/components/transit';

export default function NotFound() {
  return (
    <div className="relative flex min-h-[70dvh] flex-col items-center justify-center overflow-hidden p-8 text-center">
      <TransitLines className="absolute inset-0 h-full w-full opacity-30" />
      <div className="relative">
        <p className="tabular text-sm font-bold uppercase tracking-[0.2em] text-primary">404</p>
        <h1 className="mt-2 font-display text-5xl">End of the line</h1>
        <p className="mt-2 text-muted-foreground">This page is not on any route.</p>
        <Link href="/" className="mt-6 inline-flex h-12 items-center rounded-full bg-foreground px-6 font-bold text-background" data-testid="link-404-home">Back to Nearby</Link>
      </div>
    </div>
  );
}
