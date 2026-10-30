import { Link } from 'wouter';
import { ExternalLink, Trash2, Play, Radio } from 'lucide-react';
import { useGetSources } from '@workspace/api-client-react';
import { MobileTop, ModeSwitch } from '@/components/shell';
import { ErrorState, SourceLabel } from '@/components/transit';
import { useEntry } from '@/components/intro';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { usePrefs } from '@/lib/prefs';
import { stopRide, useActiveRide } from '@/lib/ride';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

function statusStyle(s: string) {
  const v = s.toLowerCase();
  if (/partial/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Partial' };
  if (/unsupport/.test(v)) return { c: 'text-muted-foreground', l: 'Unsupported' };
  if (/credential/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Awaiting credentials' };
  if (/unavailable/.test(v)) return { c: 'text-[hsl(var(--bad))]', l: 'Unavailable' };
  if (/(work|ok|active|healthy|live)/.test(v)) return { c: 'text-[hsl(var(--ok))]', l: 'Working' };
  if (/(stale|degrad|delay)/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Stale' };
  if (/(credential|await|not.?config)/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Integration not configured' };
  if (/(unsupport|planned)/.test(v)) return { c: 'text-muted-foreground', l: 'Planned coverage' };
  if (/(demo)/.test(v)) return { c: 'text-primary', l: 'Demo' };
  return { c: 'text-[hsl(var(--bad))]', l: s };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>{children}</section>;
}

export default function Settings() {
  const prefs = usePrefs();
  const sources = useGetSources();
  const ride = useActiveRide();
  const { toast } = useToast();
  const { replay } = useEntry();

  return (
    <div className="mx-auto max-w-3xl">
      <MobileTop />
      <div className="space-y-10 p-4 md:p-8">
        <h1 className="font-display text-4xl md:text-6xl">Settings</h1>

        <Section title="Data mode">
          <div className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
            <div className="flex items-center justify-between gap-3"><p className="font-semibold">Show arrivals from</p><ModeSwitch /></div>
            <p className="text-sm text-muted-foreground">Demo uses realistic sample data and is always labeled. Live only shows real agency, community or scheduled data. If a live feed is not configured, Transtop says so; it never fills the gap with demo times.</p>
          </div>
        </Section>

        <Section title="How estimates are labeled">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ['live', 'Fresh predictions from an official agency feed. Always preferred.'],
              ['community', 'Derived from several recent opt-in riders on the same trip. Shown as a range with a heuristic confidence label.'],
              ['scheduled', 'From the published timetable. Not adjusted for real-time conditions.'],
              ['demo', 'Sample data for review only. Not real service.'],
            ].map(([s, d]) => <div key={s} className="rounded-2xl border border-card-border bg-card p-4"><SourceLabel source={s} /><p className="mt-2 text-sm text-muted-foreground">{d}</p></div>)}
          </div>
        </Section>

        <Section title="Agency coverage and feed status">
          {sources.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skel h-20" />)}</div>}
          {sources.isError && <ErrorState title="Feed status unavailable" onRetry={() => sources.refetch()} />}
          <ul className="space-y-2">
            {(sources.data ?? []).map((f) => {
              const st = statusStyle(f.status);
              return (
                <li key={f.id} className="rounded-2xl border border-card-border bg-card p-4" data-testid={`row-source-${f.id}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-bold">{f.agency}</p>
                    <p className={cn('text-sm font-bold', st.c)}>{st.l}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Last updated {ago(f.updatedAt)}</span>
                    {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">Source and terms <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Transtop is an independent app and is not affiliated with or endorsed by the MTA, LIRR, Metro-North, NICE Bus or any agency. Transit data is provided by the agencies listed under their terms. Map data from OpenStreetMap contributors; basemap by the configured provider.</p>
        </Section>

        <Section title="Location and sharing">
          <div className="space-y-3 rounded-2xl border border-card-border bg-card p-4 text-sm">
            <p><b>Nearby location</b> is requested only when you tap Use my location. It is used once to sort stops and is not stored. You can revoke it in your browser settings.</p>
            <p><b>Address search</b>: station and neighborhood names are matched by Transtop. Numbered street addresses are sent to the US Census geocoder to find coordinates.</p>
            <p><b>Ride sharing</b> is a separate, per-ride choice. Raw samples are deleted within 24 hours and only aggregated, reduced-precision positions are published.</p>
            {ride ? (
              <button onClick={async () => { await stopRide('user'); toast({ title: 'Sharing stopped' }); }} className="flex h-12 items-center gap-2 rounded-full bg-[hsl(var(--bad))] px-5 font-bold text-white" data-testid="button-settings-stop-sharing"><Radio className="h-4 w-4" />Stop sharing now</button>
            ) : <p className="text-muted-foreground">No ride is sharing right now. <Link href="/ride" className="underline">Open Ride</Link></p>}
          </div>
        </Section>

        <Section title="Accessibility">
          <div className="divide-y divide-white/5 rounded-2xl border border-card-border bg-card">
            <label className="flex min-h-[60px] items-center justify-between gap-3 px-4">
              <span><span className="block font-semibold">Reduce motion</span><span className="text-sm text-muted-foreground">Also follows your system setting.</span></span>
              <Switch checked={prefs.reduceMotion} onCheckedChange={(v) => prefs.set({ reduceMotion: v })} data-testid="switch-reduce-motion" />
            </label>
            <label className="flex min-h-[60px] items-center justify-between gap-3 px-4">
              <span className="font-semibold">Larger text</span>
              <Switch checked={prefs.largeText} onCheckedChange={(v) => prefs.set({ largeText: v })} data-testid="switch-large-text" />
            </label>
            <button onClick={replay} className="flex min-h-[60px] w-full items-center gap-2 px-4 text-left font-semibold" data-testid="button-play-intro"><Play className="h-4 w-4" />Replay the MetroCard entry</button>
          </div>
        </Section>

        <Section title="Your data">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="flex h-12 items-center gap-2 rounded-full border border-[hsl(var(--bad)/.5)] px-5 font-bold text-[hsl(var(--bad))]" data-testid="button-clear-data"><Trash2 className="h-4 w-4" />Clear local data</button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-border bg-card">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear everything on this device?</AlertDialogTitle>
                <AlertDialogDescription>Removes favorites, preferences and any ride session. An active ride is stopped first.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid="button-confirm-clear" className="bg-[hsl(var(--bad))] text-white hover:bg-[hsl(var(--bad))]"
                  onClick={async () => { await stopRide('user'); prefs.clearAll(); toast({ title: 'Local data cleared' }); }}>Clear</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Section>
      </div>
    </div>
  );
}
