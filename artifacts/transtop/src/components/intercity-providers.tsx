import { ExternalLink } from 'lucide-react';
import { getGetIntercityProvidersQueryKey, useGetIntercityProviders } from '@workspace/api-client-react';
import { ErrorState } from '@/components/transit';
import { INTERCITY_LABEL, providerStatus } from '@/components/intercity';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';

export function IntercityProviderList() {
  const q = useGetIntercityProviders({ query: { queryKey: getGetIntercityProvidersQueryKey(), staleTime: 300_000 } });
  const list = [...(q.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-2" data-testid="section-intercity-providers">
      <p className="text-sm text-muted-foreground">{INTERCITY_LABEL}: {list.length || 'all'} providers. Times imported indicates available provider timetables. Coverage is incomplete; providers without imported times remain linked for carrier confirmation.</p>
      {q.isLoading && [0, 1, 2].map((i) => <div key={i} className="skel h-20" />)}
      {q.isError && <ErrorState title="Intercity provider list unavailable" onRetry={() => q.refetch()} />}
      <ul className="space-y-2">
        {list.map((p) => { const st = providerStatus(p.status); return (
          <li key={p.id} className="rounded-2xl border border-card-border bg-card p-4" data-testid={`row-intercity-provider-${p.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold">{p.name}</p>
              <p className={cn('inline-flex items-center gap-1.5 text-sm font-bold', st.c)}><span className={cn('h-2 w-2 rounded-full', st.dot)} />{st.l}</p>
            </div>
            {p.aliases.length > 0 && <p className="text-xs text-muted-foreground">Also known as {p.aliases.join(', ')}</p>}
            <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
            <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Boarding location verification</dt><dd className="font-semibold">{p.terminalService || 'Not reported'}</dd></div>
              <div><dt className="text-muted-foreground">Permission and access</dt><dd className="font-semibold">{p.access || 'Not reported'}</dd></div>
            </dl>
            {p.lastError && <p className="mt-2 rounded-lg border border-[hsl(var(--bad)/.4)] px-3 py-2 text-xs text-[hsl(var(--bad))]">Last error: {p.lastError}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Checked {ago(p.checkedAt)}</span>
              {p.updatedAt && <span>Updated {ago(p.updatedAt)}</span>}
              {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">Source <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </li>
        ); })}
      </ul>
    </div>
  );
}
