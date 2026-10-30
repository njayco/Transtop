import { Link } from 'wouter';
import { ExternalLink, Trash2, Play, Radio } from 'lucide-react';
import { useGetSources, type FeedSource } from '@workspace/api-client-react';
import { MobileTop, LiveIndicator } from '@/components/shell';
import { ErrorState, SourceLabel } from '@/components/transit';
import { IntercityProviderList } from '@/components/intercity-providers';
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
  if (/expired|future/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: s };
  if (/scheduled only/.test(v)) return { c: 'text-[hsl(var(--ok))]', l: 'Scheduled only' };
  if (/configured.*verify/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Access not verified' };
  if (/unsupport/.test(v)) return { c: 'text-muted-foreground', l: 'Unsupported' };
  if (/credential/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Awaiting credentials' };
  if (/unavailable/.test(v)) return { c: 'text-[hsl(var(--bad))]', l: 'Unavailable' };
  if (/(work|ok|active|healthy|live)/.test(v)) return { c: 'text-[hsl(var(--ok))]', l: 'Working' };
  if (/(stale|degrad|delay)/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Stale' };
  if (/(credential|await|not.?config)/.test(v)) return { c: 'text-[hsl(var(--warn))]', l: 'Integration not configured' };
  if (/(unsupport|planned)/.test(v)) return { c: 'text-muted-foreground', l: 'Planned coverage' };
  if (/demo/.test(v)) return { c: 'text-muted-foreground', l: 'Unavailable' };
  return { c: 'text-[hsl(var(--bad))]', l: s };
}

function ymd(s: string) { return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s; }

const EXPECTED = [
  { k: 'NYC Subway / Staten Island Railway', id: 'mta-subway' },
  { k: 'MTA buses (all boroughs, express)', id: 'mta-bus' },
  { k: 'LIRR', id: 'mta-lirr' },
  { k: 'Metro-North', id: 'mta-mnr' },
  { k: 'NICE Bus (Nassau)', id: 'nice' },
  { k: 'Suffolk County Transit', id: 'suffolk' },
  { k: 'Huntington HART', id: 'hart' },
  { k: 'City of Long Beach', id: 'long-beach' },
  { k: 'Glen Cove Loop Bus', id: 'glen-cove' },
  { k: 'Hudson Rail Link', id: 'hudson-link' },
  { k: 'JFK AirTrain', id: 'airtrain-jfk' },
  { k: 'CTtransit / CTfastrak buses', id: 'cttransit' },
  { k: 'CTrail Hartford Line', id: 'ctrail-hartford' },
  { k: 'CTrail Shore Line East', id: 'ctrail-sle' },
  { k: 'Private commuter operators', id: 'private-commuter' },
  { k: 'Google journey planning', id: 'google-routes' },
];
function Checklist({ sources }: { sources: FeedSource[] }) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-4" data-testid="section-coverage-checklist">
      <p className="font-bold">Coverage checklist</p>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {EXPECTED.map((e) => {
          const m = sources.filter((s) => e.id === s.id);
          const st = m.length ? statusStyle(m[0].status) : { c: 'text-muted-foreground', l: 'Gap: not covered' };
          const ok = st.l === 'Working' || st.l === 'Scheduled only';
          return (
            <li key={e.k} className="flex items-center gap-2 text-sm" data-testid={`row-coverage-${e.k}`}>
              <span className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-black', ok ? 'border-[hsl(var(--ok))] bg-[hsl(var(--ok))] text-black' : 'border-border')}>{ok ? '\u2713' : ''}</span>
              <span className="flex-1">{e.k}</span><span className={cn('text-xs font-bold', st.c)}>{st.l}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Gaps mean Transtop has no feed for that operator; its routes will not appear in search, timetables or maps.</p>
    </div>
  );
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
            <div className="flex items-center justify-between gap-3"><p className="font-semibold">Transit data</p><LiveIndicator /></div>
            <p className="text-sm text-muted-foreground">Transtop uses real agency, community and scheduled data only. Live does not mean every result is a real-time prediction: check each estimate’s source label. Missing or failed feeds are shown as unavailable, without replacement times.</p>
          </div>
        </Section>

        <Section title="How estimates are labeled">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ['live', 'Fresh predictions from an official agency feed. Always preferred.'],
              ['community', 'Derived from several recent opt-in riders on the same trip. Shown as a range with a heuristic confidence label.'],
              ['scheduled', 'From the published timetable. Not adjusted for real-time conditions.'],
            ].map(([s, d]) => <div key={s} className="rounded-2xl border border-card-border bg-card p-4"><SourceLabel source={s} /><p className="mt-2 text-sm text-muted-foreground">{d}</p></div>)}
          </div>
        </Section>

        <Section title="Agency coverage and feed status">
          {sources.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skel h-20" />)}</div>}
          {sources.isError && <ErrorState title="Feed status unavailable" onRetry={() => sources.refetch()} />}
          {sources.data && <Checklist sources={sources.data} />}
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
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div><dt className="text-muted-foreground">Type</dt><dd className="font-semibold">{f.type ?? 'Not reported'}</dd></div>
                    <div><dt className="text-muted-foreground">GTFS routes</dt><dd className="font-semibold" data-testid={`text-source-routes-${f.id}`}>{f.routeCount != null ? f.routeCount.toLocaleString() : 'None imported'}</dd></div>
                    <div><dt className="text-muted-foreground">GTFS stop records</dt><dd className="font-semibold">{f.stopCount != null ? f.stopCount.toLocaleString() : 'None imported'}</dd></div>
                    <div><dt className="text-muted-foreground">Service window</dt><dd className="font-semibold">{f.serviceStart && f.serviceEnd ? `${ymd(f.serviceStart)} to ${ymd(f.serviceEnd)}` : 'Unknown'}</dd></div>
                  </dl>
                  {f.lastError && <p className="mt-2 rounded-lg border border-[hsl(var(--bad)/.4)] px-3 py-2 text-xs text-[hsl(var(--bad))]" data-testid={`text-source-error-${f.id}`}>Last error: {f.lastError}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Last updated {ago(f.updatedAt)}</span>
                    {f.importedAt && <span>Schedule imported {ago(f.importedAt)}</span>}
                    {f.sourceUrl && f.sourceUrl !== f.url && <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">Feed file <ExternalLink className="h-3 w-3" /></a>}
                    {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">Source and terms <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Transtop is an independent app and is not affiliated with or endorsed by the MTA, LIRR, Metro-North, NICE Bus or any agency. Transit data is provided by the agencies listed under their terms. Interactive basemaps are provided by Google Maps; route lines, stops and arrival information come from Transtop’s separately labeled transit sources.</p>
        </Section>

        <Section title="Intercity Bus Network providers">
          <IntercityProviderList />
        </Section>

        <Section title="Location and sharing">
          <div className="space-y-3 rounded-2xl border border-card-border bg-card p-4 text-sm">
            <p><b>Nearby location</b> is requested only when you tap Use my location. It is used once to sort stops and is not stored. You can revoke it in your browser settings.</p>
            <p><b>Address search</b>: station and neighborhood names are matched by Transtop. Numbered street addresses are sent to the US Census geocoder to find coordinates.</p>
            <p><b>Google Maps</b>: opening a map sends your map viewport and ordinary connection information to Google. Submitting a journey sends both location texts and your travel time/preferences to Google through Transtop; journey results are not permanently stored. When you choose Use my location, the map can center on that location. Individual rider contributions are never sent as public map markers. <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="underline">Google Privacy Policy</a> · <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer" className="underline">Google Maps Terms</a></p>
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
