import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { MapPin, Search, Heart, Radio, Settings, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOnline } from '@/lib/prefs';
import { useActiveRide } from '@/lib/ride';

const NAV = [
  { href: '/', label: 'Nearby', icon: MapPin },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/favorites', label: 'Favorites', icon: Heart },
  { href: '/ride', label: 'Ride', icon: Radio },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn('inline-flex items-center gap-2', className)} data-testid="link-home" aria-label="Transtop home">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden><circle cx="16" cy="16" r="15" fill="#f4f1ea" /><path d="M9 10h14v3.4h-5.3V24h-3.4V13.4H9z" fill="#0c0c0d" /></svg>
      <span className="font-display text-[22px] leading-none">Transtop</span>
    </Link>
  );
}

export function LiveIndicator({ compact }: { compact?: boolean }) {
  return (
    <span data-testid="indicator-live" title="Real transit data. Individual estimates are labeled by source."
      className={cn('inline-flex shrink-0 items-center rounded-full border border-border bg-[hsl(var(--live))] px-3 text-xs font-bold uppercase tracking-wider text-black', compact ? 'h-8' : 'h-9')}>
      Live<span className="sr-only"> data · agency, scheduled and community sources</span>
    </span>
  );
}

function StatusBar() {
  const online = useOnline();
  return (
    <>
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-[hsl(var(--bad))] px-4 py-1.5 text-center text-xs font-bold text-white" role="status" data-testid="status-offline">
          <WifiOff className="h-3.5 w-3.5" />Offline — arrivals shown earlier are not current
        </div>
      )}
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const ride = useActiveRide();
  const isActive = (href: string) => (href === '/' ? loc === '/' : loc.startsWith(href));
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:p-2 focus:text-primary-foreground">Skip to content</a>
      <div className="sticky top-0 z-40"><StatusBar /></div>
      <header className="hidden items-center gap-6 border-b border-border px-6 py-3 md:flex">
        <Wordmark />
        <nav aria-label="Main" className="flex gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} data-testid={`link-nav-${n.label.toLowerCase()}`}
              className={cn('inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors', isActive(n.href) ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              <n.icon className="h-4 w-4" />{n.label}
              {n.href === '/ride' && ride && <span className="h-2 w-2 rounded-full bg-[hsl(var(--live))] pulse-dot" aria-label="Sharing active" />}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LiveIndicator />
          <Link href="/settings" aria-label="Settings" data-testid="link-settings" className={cn('inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10', isActive('/settings') && 'bg-white/10')}><Settings className="h-5 w-5" /></Link>
        </div>
      </header>
      <main id="main" className="flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4">
          {NAV.map((n) => {
            const a = isActive(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={a ? 'page' : undefined} data-testid={`link-tab-${n.label.toLowerCase()}`}
                className={cn('relative flex h-[68px] flex-col items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-wider transition-colors', a ? 'text-foreground' : 'text-muted-foreground')}>
                <span className={cn('absolute top-0 h-[3px] w-10 bg-primary transition-transform', a ? 'scale-x-100' : 'scale-x-0')} aria-hidden />
                <span className="relative"><n.icon className="h-6 w-6" strokeWidth={a ? 2.4 : 1.8} />
                  {n.href === '/ride' && ride && <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-[hsl(var(--live))]" aria-label="Sharing active" />}
                </span>
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function MobileTop({ title, right }: { title?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 pt-4 md:hidden">
      {title ?? <Wordmark />}
      <div className="ml-auto flex items-center gap-2">
        {right}
        <LiveIndicator compact />
        <Link href="/settings" aria-label="Settings" data-testid="link-settings-mobile" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"><Settings className="h-5 w-5" /></Link>
      </div>
    </div>
  );
}
