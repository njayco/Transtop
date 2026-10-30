import { useSyncExternalStore } from 'react';
import { endRide, submitReport, submitSample, type ReportInputKind } from '@workspace/api-client-react';

export type ActiveRide = {
  id: string; token: string; expiresAt: string; mode: 'demo' | 'live';
  routeId: string; routeName: string; routeColor: string; direction: string;
  stopId: string; stopName: string; agency: string; startedAt: string;
};
export type ShareState = { lastSentAt: string | null; samples: number; error: string | null; stale: boolean };

const KEY = 'transtop.ride';
const PENDING = 'transtop.ride.pendingEnd';
const listeners = new Set<() => void>();
let current: ActiveRide | null = read();
let share: ShareState = { lastSentAt: null, samples: 0, error: null, stale: false };
let watchId: number | null = null;
let expiryTimer: number | null = null;
let staleTimer: number | null = null;
let lastSampleAt = 0;

function read(): ActiveRide | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as ActiveRide;
    // Return legacy non-live rides for immediate revocation, even if expired.
    if (r.mode !== 'live' || new Date(r.expiresAt).getTime() > Date.now()) return r;
    sessionStorage.removeItem(KEY);
    return null;
  } catch { return null; }
}
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
const headers = (token: string) => ({ headers: { 'x-ride-token': token } });

export function useActiveRide() { return useSyncExternalStore(subscribe, () => current, () => null); }
export function useShareState() { return useSyncExternalStore(subscribe, () => share, () => share); }
export function pendingEndCount() {
  try { return (JSON.parse(sessionStorage.getItem(PENDING) || '[]') as unknown[]).length; } catch { return 0; }
}

function setShare(p: Partial<ShareState>) { share = { ...share, ...p }; emit(); }

function markStaleLater() {
  if (staleTimer) window.clearTimeout(staleTimer);
  staleTimer = window.setTimeout(() => setShare({ stale: true }), 90_000);
}

export function beginRide(r: ActiveRide) {
  if (r.mode !== 'live') { void revokeRide(r); return; }
  current = r;
  sessionStorage.setItem(KEY, JSON.stringify(r));
  share = { lastSentAt: null, samples: 0, error: null, stale: false };
  emit();
  startWatching();
}

export function startWatching() {
  const r = current;
  if (!r || r.mode !== 'live' || watchId !== null || !('geolocation' in navigator)) return;
  const ms = new Date(r.expiresAt).getTime() - Date.now();
  if (ms <= 0) { void stopRide('expired'); return; }
  expiryTimer = window.setTimeout(() => void stopRide('expired'), ms);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const active = current;
      if (!active || active.mode !== 'live' || document.visibilityState !== 'visible') return;
      if (Date.now() - lastSampleAt < 5000) return;
      lastSampleAt = Date.now();
      if (pos.coords.accuracy > 100) { setShare({ error: 'Location too imprecise right now; not sent.' }); return; }
      submitSample(active.id, {
        lat: pos.coords.latitude, lon: pos.coords.longitude,
        accuracy: Math.max(0, Math.min(100, pos.coords.accuracy)),
        timestamp: new Date(pos.timestamp).toISOString(),
      }, headers(active.token))
        .then((res) => {
          if (res?.status === 'accepted') {
            setShare({ lastSentAt: new Date().toISOString(), samples: share.samples + 1, error: null, stale: false });
            markStaleLater();
          } else {
            setShare({ error: `Update not stored (${res?.status ?? 'unknown'}). No trip is reliably matched yet, so no location was kept and no estimate is published.` });
          }
        })
        .catch(() => setShare({ error: 'Could not send the last update. Will keep trying while this page is open.' }));
    },
    (err) => setShare({ error: err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Sharing cannot continue.' : 'Location is unavailable right now.' }),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
  markStaleLater();
}

function clearLocal() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (expiryTimer) window.clearTimeout(expiryTimer);
  if (staleTimer) window.clearTimeout(staleTimer);
  expiryTimer = staleTimer = null;
  sessionStorage.removeItem(KEY);
  current = null;
  share = { lastSentAt: null, samples: 0, error: null, stale: false };
  emit();
}

/** Stops sharing immediately on this device, then revokes server-side. Network failure queues a retry. */
export async function stopRide(_reason: 'user' | 'expired' = 'user'): Promise<'revoked' | 'pending'> {
  const r = current;
  clearLocal();
  if (!r) return 'revoked';
  return revokeRide(r);
}

async function revokeRide(r: Pick<ActiveRide, 'id' | 'token'>): Promise<'revoked' | 'pending'> {
  try {
    await endRide(r.id, headers(r.token));
    return 'revoked';
  } catch {
    let list: { id: string; token: string }[] = [];
    try { list = JSON.parse(sessionStorage.getItem(PENDING) || '[]'); } catch { /* replace corrupt queue */ }
    if (!list.some((p) => p.id === r.id)) list.push({ id: r.id, token: r.token });
    sessionStorage.setItem(PENDING, JSON.stringify(list));
    emit();
    return 'pending';
  }
}

export async function retryPendingEnds() {
  let list: { id: string; token: string }[] = [];
  try { list = JSON.parse(sessionStorage.getItem(PENDING) || '[]'); } catch { /* ignore */ }
  const left: typeof list = [];
  for (const p of list) {
    try { await endRide(p.id, headers(p.token)); } catch { left.push(p); }
  }
  sessionStorage.setItem(PENDING, JSON.stringify(left));
  emit();
  return left.length;
}

export function report(kind: ReportInputKind) {
  const r = current;
  if (!r || r.mode !== 'live') return Promise.reject(new Error('No active live ride'));
  return submitReport(r.id, { kind, stopId: r.stopId }, headers(r.token));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void retryPendingEnds());
  // Clear synchronously before React can read the store; never watch or fetch
  // details for a legacy demo ride. Revocation failures use the normal retry queue.
  if (current && current.mode !== 'live') void stopRide();
  else if (current) startWatching();
}
