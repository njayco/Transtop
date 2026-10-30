import { useState } from 'react';
import { Link } from 'wouter';
import type { TrainDetail } from '@workspace/api-client-react';
import { createFollow, runId } from '@/lib/train-follow';
import { useTrainFollows } from '@/lib/train-follows';

export function FollowLimits() {
  return <p className="mt-2 text-xs text-muted-foreground">Opt-in alerts on this device while Transtop is open, including other pages. No alerts after closing the app; background tabs may be delayed. Amtraker is unofficial: coverage and delivery are not guaranteed. Verify travel with Amtrak. We check about once a minute for explicit cancellation or departure-estimate changes of at least 5 minutes at your chosen station. The first fresh estimate sets a baseline, not an alert. Follows are deleted at the displayed expiry or when you unfollow; no account or contact details are stored.</p>;
}
function FollowOptions({ id }: { id: string }) {
  const { follows, unfollow, browserAlerts } = useTrainFollows();
  const f = follows.find(v => v.id === id);
  if (!f) return null;
  return <div className="mt-2 space-y-2">
    <p className="text-xs text-muted-foreground">Expires {new Date(f.expires).toLocaleString()}</p>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={f.browser} onChange={e => void browserAlerts(id, e.target.checked)} />Also send browser alerts</label>
    <button className="min-h-11 rounded-full border border-border px-4 text-sm font-bold" onClick={() => unfollow(id)} data-testid="button-unfollow-train">Unfollow train</button>
  </div>;
}
export function TrainFollowCard({ train }: { train: TrainDetail }) {
  const { follows, follow, error } = useTrainFollows();
  const eligible = train.calls.filter(c => createFollow(train, c.code, Date.now()));
  const [selected, setSelected] = useState('');
  const station = eligible.some(c => c.code === selected) ? selected : eligible[0]?.code || '';
  const id = runId(train), following = follows.find(f => f.id === id);
  return <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-follow-train">
    <h2 className="font-bold">Follow this dated train</h2>
    {following ? <>
      <p className="mt-2 text-sm">Following train {following.number} · {following.date} · departure at {following.stationName}.</p>
      <FollowOptions id={following.id} />
    </> : <>
      {id && eligible.length > 0 ? <div className="mt-3 space-y-2">
        <label className="block text-sm" htmlFor="follow-station">Departure station</label>
        <select id="follow-station" className="min-h-11 w-full rounded-lg border border-border bg-background px-2 text-sm" value={station} onChange={e => setSelected(e.target.value)}>
          {eligible.map(c => <option key={c.sequence} value={c.code}>{c.name} ({c.code})</option>)}
        </select>
        <button className="min-h-11 rounded-full bg-foreground px-4 text-sm font-bold text-background" onClick={() => follow(train, station)} data-testid="button-follow-train">Follow train {train.trainNumber} · {train.serviceDate}</button>
      </div> : <p className="mt-2 text-sm text-muted-foreground">Following is unavailable for unresolved identities, expired runs or trains with no remaining boarding departures.</p>}
    </>}
    <FollowLimits />
    <Link href="/favorites" className="mt-2 inline-flex min-h-11 items-center text-sm underline">Manage followed trains</Link>
    {error && <p className="mt-2 text-sm text-[hsl(var(--warn))]" role="alert">{error}</p>}
  </section>;
}
export function FollowedTrains() {
  const { follows, error } = useTrainFollows();
  return <section className="rounded-2xl border border-card-border bg-card p-4">
    <h2 className="text-xl font-bold">Followed Amtrak trains</h2>
    <FollowLimits />
    {follows.length === 0 && <p className="mt-3 text-sm">No trains followed. Open a dated Amtrak train to opt in.</p>}
    <ul className="divide-y divide-border">{follows.map(f => <li key={f.id} className="py-3">
      <Link href={`/trains/${encodeURIComponent(f.id)}`} className="font-bold underline">Train {f.number} · {f.date}</Link>
      <p className="mt-1 text-sm">Departure at {f.stationName}</p><FollowOptions id={f.id} />
    </li>)}</ul>
    {error && <p className="mt-2 text-sm" role="alert">{error}</p>}
  </section>;
}
