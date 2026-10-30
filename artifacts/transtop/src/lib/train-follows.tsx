import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getTrain, type TrainDetail } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { applyObservation, createFollow, FOLLOW_KEY, MAX_FOLLOWS, readFollows, removeFollow, type Follow } from './train-follow';

interface Notice { id: string; text: string; at: string; number: string; date: string }
interface Context {
  follows: Follow[];
  error: string;
  follow: (t: TrainDetail, station: string) => void;
  unfollow: (id: string) => void;
  browserAlerts: (id: string, enabled: boolean) => Promise<void>;
}
const FollowsContext = createContext<Context | null>(null);
export function useTrainFollows() {
  const context = useContext(FollowsContext);
  if (!context) throw new Error('Train follows provider is missing');
  return context;
}
export function TrainFollowsProvider({ children }: { children: ReactNode }) {
  const [follows, setFollows] = useState<Follow[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState('');
  function load() { return readFollows(localStorage.getItem(FOLLOW_KEY), Date.now()); }
  function save(next: Follow[]) {
    localStorage.setItem(FOLLOW_KEY, JSON.stringify(next));
    setFollows(next);
  }
  function reportStorageError() { setError('Train following could not access device storage. Preferences cannot be saved and alerts are paused. Enable site storage and reload.'); }
  // Mutations and polling commits share a cross-tab lock where supported.
  async function locked(work: () => void) {
    if (navigator.locks) await navigator.locks.request(FOLLOW_KEY, work);
    else work();
  }
  useEffect(() => {
    let stopped = false, busy = false;
    async function poll() {
      if (busy || stopped) return;
      busy = true;
      try {
        const initial = load();
        // Persist pruning even during an outage; never extend an expired follow.
        await locked(() => { if (!stopped) save(load()); });
        for (const f of initial) {
          if (stopped) break;
          let train: TrainDetail;
          try { train = await getTrain(f.id, { signal: AbortSignal.timeout(15_000) }); }
          catch { continue; } // Missing runs and outages are not cancellation evidence.
          await locked(() => {
            if (stopped) return;
            const result = applyObservation(load(), f.id, train, Date.now());
            save(result.follows);
            if (!result.notice || !result.current) return;
            const text = result.notice.text;
            setNotices(n => [...n, { id: f.id, number: f.number, date: f.date, text, at: train.updatedAt! }].slice(-20));
            if (result.current.browser && 'Notification' in window && Notification.permission === 'granted') {
              try {
                const alert = new Notification(`Train ${f.number} · ${f.date}`, {
                  body: `${text} Unofficial report; verify with Amtrak.`,
                  tag: `${f.id}:${result.notice.key}`,
                });
                alert.onclick = () => { window.focus(); alert.close(); };
              } catch { setError('Browser alerts are unavailable here. In-app alerts remain enabled.'); }
            }
          });
        }
      } catch { if (!stopped) reportStorageError(); }
      finally { busy = false; }
    }
    const sync = () => {
      try {
        const current = load(); setFollows(current);
        setNotices(n => n.filter(v => current.some(f => f.id === v.id)));
      } catch { reportStorageError(); }
    };
    sync(); void poll();
    const timer = setInterval(() => { sync(); void poll(); }, 60_000);
    window.addEventListener('storage', sync);
    window.addEventListener('transtop:local-data-cleared', sync);
    window.addEventListener('focus', poll);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('storage', sync); window.removeEventListener('transtop:local-data-cleared', sync); window.removeEventListener('focus', poll); };
  }, []);
  function mutate(work: (all: Follow[]) => Follow[]) {
    void locked(() => {
      try { save(work(load())); }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not save train follows.'); }
    }).catch(reportStorageError);
  }
  const value: Context = {
    follows, error,
    follow(t, station) {
      const f = createFollow(t, station, Date.now());
      if (!f) { setError('Only an unexpired, uniquely matched dated run with a boarding departure can be followed.'); return; }
      mutate(all => {
        if (all.some(c => c.id === f.id)) return all;
        if (all.length >= MAX_FOLLOWS) throw new Error(`You can follow up to ${MAX_FOLLOWS} trains. Unfollow one first.`);
        return [...all, f];
      });
    },
    unfollow(id) {
      mutate(all => removeFollow(all, id));
      setNotices(n => n.filter(v => v.id !== id));
    },
    async browserAlerts(id, enabled) {
      if (enabled) {
        if (!('Notification' in window)) { setError('This browser does not support browser alerts. In-app alerts remain available.'); return; }
        let consent: NotificationPermission;
        try { consent = await Notification.requestPermission(); }
        catch { setError('Browser permission could not be requested. In-app alerts remain available.'); return; }
        if (consent !== 'granted') { setError('Browser permission was not granted. In-app alerts remain available; no browser alerts will be sent.'); return; }
      }
      // Do not recreate a follow removed while the permission prompt was open.
      mutate(all => all.map(f => f.id === id ? { ...f, browser: enabled } : f));
    },
  };
  return <FollowsContext.Provider value={value}>
    {children}
    {notices.length > 0 && <section className="fixed bottom-20 right-3 z-50 max-h-[45vh] w-[min(380px,calc(100vw-24px))] space-y-2 overflow-auto rounded-xl border border-border bg-card p-3 shadow-xl" aria-label="Followed train changes">
      <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Followed train changes</h2><button className="min-h-11 px-2 text-sm underline" onClick={() => setNotices([])}>Dismiss all</button></div>
      <div role="status" className="space-y-3">{notices.map((n, i) => <div key={`${n.id}:${n.at}:${i}`} className="text-sm">
        <Link className="font-bold underline" href={`/trains/${encodeURIComponent(n.id)}`}>Train {n.number} · {n.date}</Link>
        <p>{n.text}</p><p className="text-xs text-muted-foreground">Unofficial · source observed {new Date(n.at).toLocaleString()}</p>
      </div>)}</div>
    </section>}
  </FollowsContext.Provider>;
}
