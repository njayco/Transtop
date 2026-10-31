export type EntryVariant = 'us' | 'london' | 'paris' | 'tokyo';
export const REGION_KEY = 'transtop.entry.region';
export const COUNTRY_TIMEOUT_MS = 900;

export function variantForCountry(c: unknown): EntryVariant {
  switch (c) {
    case 'GB': return 'london';
    case 'FR': return 'paris';
    case 'JP': return 'tokyo';
    default: return 'us';
  }
}

export function isVariant(v: unknown): v is EntryVariant {
  return v === 'us' || v === 'london' || v === 'paris' || v === 'tokyo';
}

export function readStoredVariant(): EntryVariant | null {
  try { const v = sessionStorage.getItem(REGION_KEY); return isVariant(v) ? v : null; } catch { return null; }
}
export function storeVariant(v: EntryVariant) {
  try { sessionStorage.setItem(REGION_KEY, v); } catch { /* ignore */ }
}

/** One bounded, abortable, no-store lookup. Never rejects; resolves 'us' on any failure or after timeoutMs,
 *  even if fetch/json ignore the abort signal. Pass an external signal to cancel (resolves 'us'). */
export function fetchEntryVariant(base: string, fetchImpl: typeof fetch = fetch, timeoutMs = COUNTRY_TIMEOUT_MS, outer?: AbortSignal): Promise<EntryVariant> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onOuter: (() => void) | undefined;
  const bail = new Promise<EntryVariant>((resolve) => {
    const stop = () => { ac.abort(); resolve('us'); };
    timer = setTimeout(stop, timeoutMs);
    if (outer) { if (outer.aborted) stop(); else { onOuter = stop; outer.addEventListener('abort', stop, { once: true }); } }
  });
  const work = (async (): Promise<EntryVariant> => {
    try {
      const r = await fetchImpl(`${base}/api/entry/country`, { cache: 'no-store', signal: ac.signal, credentials: 'same-origin' });
      if (!r.ok) return 'us';
      const j = await r.json();
      return variantForCountry(j && typeof j === 'object' ? (j as { country?: unknown }).country : null);
    } catch { return 'us'; }
  })();
  return Promise.race([work, bail]).finally(() => {
    clearTimeout(timer);
    if (outer && onOuter) outer.removeEventListener('abort', onOuter);
    ac.abort();
  });
}
