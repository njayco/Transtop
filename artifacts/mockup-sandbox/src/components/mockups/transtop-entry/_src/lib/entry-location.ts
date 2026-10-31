/** Approximate entry-poster location: theme IDs, bounded lookup and tab-session storage.
 *  Detected (transient) defaults are kept separate from an explicit rider choice. */
export const CITY_THEMES = ['new-jersey', 'connecticut', 'san-francisco', 'philadelphia', 'dallas', 'miami', 'atlanta', 'detroit', 'cincinnati', 'chicago', 'los-angeles'] as const;
export const THEMES = ['default', 'new-york', ...CITY_THEMES] as const;
export const EXTRA_THEMES = ['london', 'paris', 'tokyo'] as const;
export type CityTheme = typeof CITY_THEMES[number];
export type EntryTheme = typeof THEMES[number];
export type EntryDesign = EntryTheme | typeof EXTRA_THEMES[number];

export type EntryLocation = {
  country: string | null; city: string | null; region: string | null;
  theme: EntryTheme; operator: string | null;
  accuracy: 'approximate' | 'unknown';
  matchedBy: 'city' | 'region' | 'country' | 'default';
};

export const CHOICE_KEY = 'transtop.entry.theme';
export const DETECTED_KEY = 'transtop.entry.detected';
export const LOCATION_TIMEOUT_MS = 1200;

export const UNKNOWN_LOCATION: EntryLocation = { country: null, city: null, region: null, theme: 'default', operator: null, accuracy: 'unknown', matchedBy: 'default' };

const own = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);
export const isTheme = (v: unknown): v is EntryTheme => own(THEMES, v);
export const isDesign = (v: unknown): v is EntryDesign => own(THEMES, v) || own(EXTRA_THEMES, v);

const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** Validates an untrusted response body. Anything malformed becomes the honest unknown default. */
export function parseLocation(j: unknown): EntryLocation {
  if (!j || typeof j !== 'object') return UNKNOWN_LOCATION;
  const o = j as Record<string, unknown>;
  const theme = isTheme(o.theme) ? o.theme : 'default';
  const matchedBy = o.matchedBy === 'city' || o.matchedBy === 'region' || o.matchedBy === 'country' ? o.matchedBy : 'default';
  return {
    country: str(o.country, 4), city: str(o.city), region: str(o.region), operator: str(o.operator),
    theme, accuracy: o.accuracy === 'approximate' ? 'approximate' : 'unknown', matchedBy,
  };
}

export function readChoice(): EntryDesign | null {
  try { const v = sessionStorage.getItem(CHOICE_KEY); return isDesign(v) ? v : null; } catch { return null; }
}
export function storeChoice(v: EntryDesign | null) {
  try { if (v) sessionStorage.setItem(CHOICE_KEY, v); else sessionStorage.removeItem(CHOICE_KEY); } catch { /* ignore */ }
}
export function readDetected(): EntryLocation | null {
  try { const v = sessionStorage.getItem(DETECTED_KEY); return v ? parseLocation(JSON.parse(v)) : null; } catch { return null; }
}
export function storeDetected(l: EntryLocation) {
  try { sessionStorage.setItem(DETECTED_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

/** One bounded, abortable, no-store lookup. Never rejects; resolves UNKNOWN_LOCATION on failure/timeout/abort. */
export function fetchEntryLocation(base: string, fetchImpl: typeof fetch = fetch, timeoutMs = LOCATION_TIMEOUT_MS, outer?: AbortSignal): Promise<EntryLocation> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onOuter: (() => void) | undefined;
  const bail = new Promise<EntryLocation>((resolve) => {
    const stop = () => { ac.abort(); resolve(UNKNOWN_LOCATION); };
    timer = setTimeout(stop, timeoutMs);
    if (outer) { if (outer.aborted) stop(); else { onOuter = stop; outer.addEventListener('abort', stop, { once: true }); } }
  });
  const work = (async () => {
    try {
      const r = await fetchImpl(`${base}/api/entry/location`, { cache: 'no-store', signal: ac.signal, credentials: 'same-origin' });
      if (!r.ok) return UNKNOWN_LOCATION;
      return parseLocation(await r.json());
    } catch { return UNKNOWN_LOCATION; }
  })();
  return Promise.race([work, bail]).finally(() => {
    clearTimeout(timer);
    if (outer && onOuter) outer.removeEventListener('abort', onOuter);
    ac.abort();
  });
}

export const DESIGN_LABELS: Record<EntryDesign, string> = {
  default: 'Farebox (any city)', 'new-york': 'New York', 'new-jersey': 'New Jersey', connecticut: 'Connecticut',
  'san-francisco': 'San Francisco Bay Area', philadelphia: 'Philadelphia', dallas: 'Dallas', miami: 'Miami',
  atlanta: 'Atlanta', detroit: 'Detroit', cincinnati: 'Cincinnati', chicago: 'Chicago', 'los-angeles': 'Los Angeles',
  london: 'London', paris: 'Paris', tokyo: 'Tokyo',
};
