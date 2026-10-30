import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Route, Stop } from '@workspace/api-client-react';

export type DataMode = 'live';
export type FavStop = { id: string; name: string; type: Stop['type']; agency: string; routes: Pick<Route, 'id' | 'name' | 'color'>[]; savedAt: string };
export type FavRoute = { id: string; name: string; color: string; type: Route['type']; agency: string; savedAt: string };
export type Prefs = { mode: DataMode; reduceMotion: boolean; largeText: boolean; favStops: FavStop[]; favRoutes: FavRoute[] };

const KEY = 'transtop.prefs.v1';
const DEFAULTS: Prefs = { mode: 'live', reduceMotion: false, largeText: false, favStops: [], favRoutes: [] };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const { introSeen: _legacy, ...rest } = JSON.parse(raw);
    void _legacy;
    return { ...DEFAULTS, ...rest, mode: 'live' };
  } catch {
    return DEFAULTS;
  }
}

type Ctx = Prefs & {
  set: (patch: Partial<Prefs>) => void;
  toggleStop: (s: Stop) => void;
  toggleRoute: (r: Route) => void;
  isFavStop: (id: string) => boolean;
  isFavRoute: (id: string) => boolean;
  clearAll: () => void;
};
const PrefsContext = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage full or blocked */ }
    document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion);
    document.documentElement.classList.toggle('large-text', prefs.largeText);
  }, [prefs]);

  const set = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch, mode: 'live' })), []);
  const toggleStop = useCallback((s: Stop) => setPrefs((p) => p.favStops.some((f) => f.id === s.id)
    ? { ...p, favStops: p.favStops.filter((f) => f.id !== s.id) }
    : { ...p, favStops: [{ id: s.id, name: s.name, type: s.type, agency: s.agency, routes: s.routes.map((r) => ({ id: r.id, name: r.name, color: r.color })), savedAt: new Date().toISOString() }, ...p.favStops] }), []);
  const toggleRoute = useCallback((r: Route) => setPrefs((p) => p.favRoutes.some((f) => f.id === r.id)
    ? { ...p, favRoutes: p.favRoutes.filter((f) => f.id !== r.id) }
    : { ...p, favRoutes: [{ id: r.id, name: r.name, color: r.color, type: r.type, agency: r.agency, savedAt: new Date().toISOString() }, ...p.favRoutes] }), []);
  const clearAll = useCallback(() => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('transtop.')).forEach((k) => localStorage.removeItem(k));
      Object.keys(sessionStorage).filter((k) => k.startsWith('transtop.')).forEach((k) => sessionStorage.removeItem(k));
    } catch { /* ignore */ }
    window.dispatchEvent(new Event('transtop:local-data-cleared'));
    setPrefs(DEFAULTS);
  }, []);

  const value = useMemo<Ctx>(() => ({
    ...prefs, set, toggleStop, toggleRoute, clearAll,
    isFavStop: (id) => prefs.favStops.some((f) => f.id === id),
    isFavRoute: (id) => prefs.favRoutes.some((f) => f.id === id),
  }), [prefs, set, toggleStop, toggleRoute, clearAll]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const c = useContext(PrefsContext);
  if (!c) throw new Error('PrefsProvider missing');
  return c;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** Never show demo-sourced results, including decorated vehicle source names. */
export function honest<T extends { source: string }>(items: T[], _mode?: DataMode): T[] {
  return items.filter((a) => !a.source.toLowerCase().includes('demo'));
}

export const TIMES_SQUARE = { lat: 40.758, lon: -73.9855, label: 'Times Square' };
