import { useState } from 'react';
import { useGetMobilityFeeds, type MobilityInfo } from '@workspace/api-client-react';

export function MobilityDetails({ info }: { info?: MobilityInfo }) {
  if (!info) return null;
  return <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
    <p className="font-semibold text-foreground">Mobility Database · {info.feedId} · {info.timezone}</p>
    <p className="mt-1">{info.attribution}</p>
    <p>Source downloaded {info.downloadedAt.slice(0, 10)} · valid through {info.validThrough.slice(0, 10)}. Schedules are not live predictions.</p>
    <div className="flex flex-wrap gap-x-4">
      <a className="inline-flex min-h-11 items-center underline" href={info.url} target="_blank" rel="noreferrer">Feed and dataset details</a>
      <a className="inline-flex min-h-11 items-center underline" href={info.licenseUrl} target="_blank" rel="noreferrer">{info.license}</a>
    </div>
  </div>;
}

export function MobilityCatalog() {
  const [country, setCountry] = useState('');
  const [provider, setProvider] = useState('');
  const [kind, setKind] = useState<'gtfs' | 'gtfs_rt'>('gtfs');
  const [query, setQuery] = useState<{country?: string; provider?: string; kind: 'gtfs' | 'gtfs_rt'; offset: number} | null>(null);
  const res = useGetMobilityFeeds(query || { offset: 0 }, { query: { enabled: query !== null, retry: false, staleTime: 6 * 3600_000 } });
  return <div className="space-y-4" data-testid="mobility-catalog">
    <div>
      <h2 className="text-xl font-bold">Mobility Database · worldwide feeds</h2>
      <p className="mt-2 text-sm text-muted-foreground">Discover official GTFS schedules and realtime feed listings worldwide. Small, eligible schedule feeds near your selected location can be added in the background, then appear in Nearby, Search, maps and timetables. Listings are not a promise of live service. Unverified licenses, separate-access feeds and oversized datasets are withheld.</p>
    </div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault(); setQuery({ country: country.trim().toUpperCase() || undefined, provider: provider.trim() || undefined, kind, offset: 0 });
    }}>
      <label className="flex flex-col gap-1 text-sm">Country code
        <input className="min-h-11 w-28 rounded-lg border border-border bg-background px-3" placeholder="AU, FR, US" value={country} maxLength={2} pattern="[A-Za-z]{2}|^$" onChange={e=>setCountry(e.target.value)} />
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">Provider
        <input className="min-h-11 rounded-lg border border-border bg-background px-3" placeholder="Optional provider name" value={provider} maxLength={100} onChange={e=>setProvider(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Feed type
        <select className="min-h-11 rounded-lg border border-border bg-background px-3" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
          <option value="gtfs">Schedules</option><option value="gtfs_rt">Realtime</option>
        </select>
      </label>
      <button className="min-h-11 rounded-lg bg-primary px-4 font-bold text-primary-foreground" disabled={res.isFetching}>Find feeds</button>
    </form>
    <div aria-live="polite">
      {res.isFetching && <p className="text-sm">Checking the worldwide catalog…</p>}
      {res.isError && <p className="text-sm text-muted-foreground">The catalog is unavailable or its daily allowance has been reached. Imported transit services remain available. Try again later.</p>}
      {res.data && <>
        <p className="mb-3 text-xs text-muted-foreground">{res.data.status}</p>
        {res.data.feeds.length === 0 && <p className="text-sm">No feeds match this catalog page. Try another country or provider.</p>}
        <ul className="space-y-3">{res.data.feeds.map(f=><li key={f.id} className="rounded-xl border border-border p-3">
          <a className="inline-flex min-h-11 items-center font-bold underline" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
          <p className="text-xs text-muted-foreground">{f.id} · {f.kind === 'gtfs_rt' ? 'Realtime catalog listing' : 'GTFS schedule'} · {f.countries.join(', ')}</p>
          <p className="mt-1 text-sm">{f.imported ? 'Registered with Transtop · check imported coverage below' : f.reason}</p>
          <p className="text-xs text-muted-foreground">{f.license || 'License review required'}{f.timezone ? ` · ${f.timezone}` : ''}{f.validThrough ? ` · service through ${f.validThrough.slice(0, 10)}` : ''}</p>
        </li>)}</ul>
        <div className="mt-3 flex gap-3">
          {query && query.offset > 0 && <button className="min-h-11 rounded-lg border border-border px-4" disabled={res.isFetching} onClick={()=>setQuery({...query,offset:Math.max(0,query.offset-20)})}>Previous feeds</button>}
          {query && res.data.hasMore && <button className="min-h-11 rounded-lg border border-border px-4" disabled={res.isFetching} onClick={()=>setQuery({...query,offset:query.offset+20})}>More feeds</button>}
        </div>
      </>}
    </div>
    <p className="text-xs text-muted-foreground">Source: <a href="https://mobilitydatabase.org/" className="underline" target="_blank" rel="noreferrer">Mobility Database by MobilityData</a>. Each publisher retains its own license. Up to 8 small feeds are registered, with at most 2 new background imports per day. Browse a location again after import; coverage may take a few minutes to appear.</p>
  </div>;
}
