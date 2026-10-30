import type { TrainDetail } from '@workspace/api-client-react';

export const FOLLOW_KEY = 'transtop.train-follows.v1';
export const MAX_FOLLOWS = 10;
export interface Follow {
  id: string;
  date: string;
  number: string;
  station: string;
  stationName: string;
  signature: string;
  expires: number;
  browser: boolean;
  observedAt: number;
  estimate: number | null;
  canceled: boolean;
  seen: string[];
}
export interface ChangeNotice { key: string; text: string }
const instant = (s: string | null | undefined) => Date.parse(s || '');
export function runId(t: TrainDetail) {
  return t.matched && t.tripId?.startsWith('amtrak:') && /^\d{8}$/.test(t.serviceDate)
    ? `amtrak:trip:${t.tripId.slice(7)}:${t.serviceDate}` : null;
}
// Deliberately stop following if a reused trip ID now describes different station times.
export function scheduleSignature(t: TrainDetail) {
  return JSON.stringify(t.calls.map(c => [c.code, c.sequence, instant(c.scheduledDeparture || c.scheduledArrival)]));
}
function sameSchedule(signature: string, t: TrainDetail) {
  let saved: unknown;
  try { saved = JSON.parse(signature); } catch { return false; }
  // Match the upstream association's one-minute tolerance and dep-or-arrival rule.
  // GTFS can repeat the origin departure as an arrival; Amtraker can omit it.
  return Array.isArray(saved) && saved.length === t.calls.length && saved.every((row, i) =>
    Array.isArray(row) && row[0] === t.calls[i].code && row[1] === t.calls[i].sequence &&
    typeof row[2] === 'number' && Math.abs(row[2] - instant(t.calls[i].scheduledDeparture || t.calls[i].scheduledArrival)) <= 60_000);
}
export function freshReport(t: TrainDetail, now: number) {
  const at = instant(t.updatedAt), expiry = instant(t.expiresAt);
  return t.source === 'Amtraker · upstream Amtrak observation (unofficial)' &&
    Number.isFinite(at) && Number.isFinite(expiry) && expiry > now &&
    at <= now + 30_000 && now - at <= 300_000;
}
export function createFollow(t: TrainDetail, station: string, now: number): Follow | null {
  const id = runId(t), call = t.calls.find(c => c.code === station && !!c.scheduledDeparture);
  const end = Math.max(...t.calls.flatMap(c => [instant(c.scheduledArrival), instant(c.scheduledDeparture)]).filter(Number.isFinite));
  if (!id || !call || call === t.calls.at(-1) || call.actualDeparture || call.status === 'Skipped' ||
      !Number.isFinite(end) || end + 86_400_000 <= now) return null;
  const fresh = freshReport(t, now);
  const estimate = fresh && t.state === 'Active' ? instant(call.estimatedDeparture) : NaN;
  return {
    id, date: t.serviceDate, number: t.trainNumber, station, stationName: call.name,
    signature: scheduleSignature(t), expires: Math.min(end + 86_400_000, now + 8 * 86_400_000),
    browser: false, observedAt: fresh ? instant(t.updatedAt) : 0,
    estimate: Number.isFinite(estimate) ? estimate : null,
    canceled: fresh && /^(Canceled|Cancelled)$/.test(t.state), seen: [],
  };
}
export function evaluateFollow(f: Follow, t: TrainDetail, now: number): { follow: Follow; notice?: ChangeNotice } {
  if (f.expires <= now || runId(t) !== f.id || t.serviceDate !== f.date ||
      t.trainNumber !== f.number || !sameSchedule(f.signature, t) ||
      !freshReport(t, now) || instant(t.updatedAt) <= f.observedAt) return { follow: f };
  const next = { ...f, observedAt: instant(t.updatedAt) };
  let notice: ChangeNotice | undefined;
  if (/^(Canceled|Cancelled)$/.test(t.state)) {
    if (!f.canceled) notice = { key: 'canceled', text: 'Amtraker explicitly reports this train canceled.' };
    next.canceled = true;
  } else if (t.state === 'Active' && !f.canceled) {
    const call = t.calls.find(c => c.code === f.station);
    const estimate = call && !call.actualDeparture && call.status !== 'Skipped' ? instant(call.estimatedDeparture) : NaN;
    if (Number.isFinite(estimate)) {
      if (f.estimate !== null && Math.abs(estimate - f.estimate) >= 300_000) {
        const delta = Math.round((estimate - f.estimate) / 60_000);
        notice = { key: `departure:${estimate}`, text: `Amtraker reports the departure estimate at ${f.stationName} moved ${Math.abs(delta)} minutes ${delta > 0 ? 'later' : 'earlier'}.` };
      }
      // Keep the last notified anchor, so several small changes can reach five minutes.
      if (f.estimate === null || notice) next.estimate = estimate;
    }
  }
  if (!notice || f.seen.includes(notice.key)) return { follow: next };
  next.seen = [...f.seen, notice.key].slice(-64);
  return { follow: next, notice };
}
export function removeFollow(follows: Follow[], id: string) {
  return follows.filter(f => f.id !== id);
}
/** Apply against the latest saved preferences, never the request's old copy. */
export function applyObservation(follows: Follow[], id: string, train: TrainDetail, now: number) {
  const current = follows.find(f => f.id === id && f.expires > now);
  if (!current) return { follows };
  const result = evaluateFollow(current, train, now);
  return { follows: follows.map(f => f.id === id ? result.follow : f), notice: result.notice, current };
}
export function readFollows(raw: string | null, now: number): Follow[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Invalid saved train follows');
  return data.filter((f): f is Follow => !!f && typeof f === 'object' &&
    typeof f.id === 'string' && /^amtrak:trip:[^:]+:\d{8}$/.test(f.id) &&
    typeof f.date === 'string' && f.id.endsWith(`:${f.date}`) &&
    typeof f.number === 'string' && typeof f.station === 'string' && typeof f.stationName === 'string' &&
    typeof f.signature === 'string' && f.signature.length <= 50_000 &&
    typeof f.browser === 'boolean' && Number.isFinite(f.expires) && f.expires > now && f.expires <= now + 8 * 86_400_000 &&
    Number.isFinite(f.observedAt) && (f.estimate === null || Number.isFinite(f.estimate)) &&
    typeof f.canceled === 'boolean' && Array.isArray(f.seen) && f.seen.length <= 64 && f.seen.every((s: unknown) => typeof s === 'string')
  ).slice(0, MAX_FOLLOWS);
}
