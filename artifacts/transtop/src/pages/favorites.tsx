import { Link } from 'wouter';
import { Heart, X } from 'lucide-react';
import { MobileTop } from '@/components/shell';
import { MODE_NAME, ModeIcon, RouteBadge, TransitLines } from '@/components/transit';
import { useOnline, usePrefs } from '@/lib/prefs';
import { ago } from '@/lib/format';

export default function Favorites() {
  const { favStops, favRoutes, set } = usePrefs();
  const online = useOnline();
  const empty = favStops.length === 0 && favRoutes.length === 0;
  return (
    <div className="mx-auto max-w-3xl">
      <MobileTop />
      <div className="space-y-8 p-4 md:p-8">
        <div>
          <h1 className="font-display text-4xl md:text-6xl">Favorites</h1>
          <p className="mt-1 text-muted-foreground">Saved on this device only. No account needed.</p>
          {!online && <p className="mt-2 text-sm text-[hsl(var(--warn))]" role="status">Offline. Your saved list is available; arrivals load when you reconnect.</p>}
        </div>
        {empty && (
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 text-center">
            <TransitLines className="absolute inset-0 h-full w-full opacity-25" />
            <div className="relative">
              <Heart className="mx-auto h-10 w-10 text-accent" />
              <p className="mt-3 font-display text-2xl">Nothing saved yet</p>
              <p className="mx-auto mt-1 max-w-sm text-muted-foreground">Tap the heart on any stop or route to keep it one tap away.</p>
              <Link href="/" className="mt-5 inline-flex h-12 items-center rounded-full bg-foreground px-6 font-bold text-background" data-testid="link-browse-nearby">Browse nearby</Link>
            </div>
          </div>
        )}
        {favStops.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Stops</h2>
            <ul className="space-y-2">
              {favStops.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-2xl border border-card-border bg-card pr-2">
                  <Link href={`/stops/${encodeURIComponent(s.id)}`} className="flex min-w-0 flex-1 items-center gap-3 p-4" data-testid={`link-fav-stop-${s.id}`}>
                    <ModeIcon type={s.type} size={40} />
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.agency} · saved {ago(s.savedAt)}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">{s.routes.slice(0, 8).map((r) => <RouteBadge key={r.id} name={r.name} color={r.color} size="sm" />)}</div>
                    </div>
                  </Link>
                  <button aria-label={`Remove ${s.name}`} data-testid={`button-remove-stop-${s.id}`} onClick={() => set({ favStops: favStops.filter((f) => f.id !== s.id) })} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><X className="h-5 w-5" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {favRoutes.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Routes</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {favRoutes.map((r) => (
                <li key={r.id} className="flex items-center rounded-2xl border border-card-border bg-card pr-2">
                  <Link href={`/routes/${encodeURIComponent(r.id)}`} className="flex min-w-0 flex-1 items-center gap-3 p-4" data-testid={`link-fav-route-${r.id}`}>
                    <RouteBadge name={r.name} color={r.color} size="lg" />
                    <div className="min-w-0"><p className="font-bold">{r.name} {MODE_NAME[r.type]}</p><p className="truncate text-xs text-muted-foreground">{r.agency}</p></div>
                  </Link>
                  <button aria-label={`Remove route ${r.name}`} data-testid={`button-remove-route-${r.id}`} onClick={() => set({ favRoutes: favRoutes.filter((f) => f.id !== r.id) })} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><X className="h-5 w-5" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
