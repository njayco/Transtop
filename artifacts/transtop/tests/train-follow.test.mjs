import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollow, evaluateFollow, applyObservation, removeFollow, readFollows, runId } from '../src/lib/train-follow.ts';

const now = Date.parse('2026-10-31T14:00:00Z');
const iso = n => new Date(n).toISOString();
function train(changes = {}) {
  return {
    id: 'amtrak:observation:5:1793451600000', tripId: 'amtrak:trip5', matched: true,
    serviceDate: '20261031', trainNumber: '5', state: 'Active',
    source: 'Amtraker · upstream Amtrak observation (unofficial)',
    updatedAt: iso(now), expiresAt: iso(now + 300_000),
    calls: [
      { code: 'CHI', name: 'Chicago', sequence: 1, scheduledArrival: null, scheduledDeparture: iso(now + 600_000),
        estimatedDeparture: iso(now + 900_000), actualDeparture: null, status: 'Enroute' },
      { code: 'DEN', name: 'Denver', sequence: 2, scheduledArrival: iso(now + 36 * 3600_000),
        scheduledDeparture: null, estimatedDeparture: null, actualDeparture: null, status: 'Enroute' },
    ], ...changes,
  };
}
function changed(minutes, at = now + 60_000) {
  const t = train({ updatedAt: iso(at), expiresAt: iso(at + 300_000) });
  t.calls[0].estimatedDeparture = iso(now + (15 + minutes) * 60_000);
  return t;
}
const follow = () => createFollow(train(), 'CHI', now);

test('follow is explicit, defaults to in-app consent only and binds full service date, trip and station', () => {
  const f = follow();
  assert.equal(f.id, 'amtrak:trip:trip5:20261031');
  assert.equal(f.browser, false);
  assert.equal(f.station, 'CHI');
  assert.ok(f.expires > now);
  assert.equal(evaluateFollow(f, train(), now).notice, undefined);
  for (const t of [train({ matched: false }), train({ tripId: undefined })]) assert.equal(createFollow(t, 'CHI', now), null);
  assert.equal(createFollow(train(), 'DEN', now), null); // arrival terminal
});
test('five-minute shifts notify, small cumulative shifts use last notified anchor', () => {
  let f = follow();
  const small = evaluateFollow(f, changed(3), now + 60_000);
  assert.equal(small.notice, undefined);
  assert.equal(small.follow.estimate, f.estimate);
  const big = evaluateFollow(small.follow, changed(5, now + 120_000), now + 120_000);
  assert.match(big.notice.text, /5 minutes later/);
  const early = evaluateFollow(big.follow, changed(-5, now + 180_000), now + 180_000);
  assert.match(early.notice.text, /10 minutes earlier/);
});
test('repeated, replayed, reloaded and oscillating reports do not duplicate notices', () => {
  const result = evaluateFollow(follow(), changed(5), now + 60_000);
  const persisted = readFollows(JSON.stringify([result.follow]), now + 60_000)[0];
  assert.equal(evaluateFollow(persisted, changed(5), now + 60_000).notice, undefined);
  assert.equal(evaluateFollow(persisted, changed(5, now + 120_000), now + 120_000).notice, undefined);
  assert.equal(evaluateFollow(persisted, changed(20, now), now + 60_000).notice, undefined);
  const back = evaluateFollow(persisted, changed(0, now + 120_000), now + 120_000);
  assert.ok(back.notice);
  assert.equal(evaluateFollow(back.follow, changed(5, now + 180_000), now + 180_000).notice, undefined);
});
test('only explicit fresh cancellation triggers; disappearance, unknown or completed state never implies cancellation', () => {
  const f = follow();
  for (const state of ['Unknown', 'Completed', 'Scheduled', 'Missing', 'Delayed', 'Disruption']) {
    assert.equal(evaluateFollow(f, { ...changed(10), state }, now + 60_000).notice, undefined);
  }
  for (const state of ['Canceled', 'Cancelled']) {
    const t = { ...changed(0), state };
    const result = evaluateFollow(f, t, now + 60_000);
    assert.match(result.notice.text, /explicitly reports this train canceled/);
    assert.equal(evaluateFollow(result.follow, { ...t, updatedAt: iso(now + 120_000) }, now + 120_000).notice, undefined);
  }
  assert.equal(evaluateFollow(createFollow(train({state: 'Canceled'}), 'CHI', now),
    {...changed(0), state: 'Canceled'}, now + 60_000).notice, undefined);
});
test('stale, future-clock, expired, missing expiry and outage-withheld estimates cannot trigger', () => {
  for (const patch of [
    { updatedAt: iso(now - 300_001) }, { updatedAt: iso(now + 30_001) },
    { expiresAt: iso(now) }, { expiresAt: null }, { updatedAt: null },
    { source: 'Amtrak · published GTFS schedule' },
  ]) {
    const f = { ...follow(), observedAt: 0 };
    assert.deepEqual(evaluateFollow(f, { ...changed(20), ...patch }, now), { follow: f });
  }
  const f = follow(), t = changed(20);
  t.calls[0].estimatedDeparture = null;
  assert.equal(evaluateFollow(f, t, now + 60_000).notice, undefined);
  // A fresh source after an outage can report a real change without resetting the anchor.
  assert.ok(evaluateFollow(f, changed(10, now + 3600_000), now + 3600_000).notice);
});
test('first fresh estimate establishes a baseline, not a fabricated change', () => {
  const f = createFollow(train({ source: 'Amtrak · published GTFS schedule', updatedAt: null, expiresAt: null }), 'CHI', now);
  assert.equal(f.observedAt, 0);
  assert.equal(f.estimate, null);
  const first = evaluateFollow(f, changed(10), now + 60_000);
  assert.equal(first.notice, undefined);
  assert.ok(first.follow.estimate);
  assert.ok(evaluateFollow(first.follow, changed(15, now + 120_000), now + 120_000).notice);
  // But an explicit cancellation is sufficient evidence without an earlier live estimate.
  assert.ok(evaluateFollow(f, {...changed(0), state: 'Canceled'}, now + 60_000).notice);
});
test('recurring train numbers, unresolved matches, changed trips and changed published calls are suppressed', () => {
  const f = follow();
  for (const patch of [{ serviceDate: '20261101' }, { matched: false }, { tripId: 'amtrak:other' }, { trainNumber: '6' }]) {
    assert.equal(evaluateFollow(f, {...changed(20), ...patch}, now + 60_000).notice, undefined);
  }
  const t = changed(20); t.calls[0].scheduledDeparture = iso(now + 661_000);
  assert.equal(evaluateFollow(f, t, now + 60_000).notice, undefined);
  assert.notEqual(runId(train()), runId(train({serviceDate:'20261101'})));
});
test('schedule-only follows accept verified observations despite omitted origin arrival and match tolerance', () => {
  const scheduled = train({ source: 'Amtrak · published GTFS schedule', updatedAt:null, expiresAt:null });
  scheduled.calls[0].scheduledArrival = scheduled.calls[0].scheduledDeparture;
  const f = createFollow(scheduled, 'CHI', now);
  const t = changed(0);
  t.calls[0].scheduledDeparture = iso(now + 630_000);
  const baseline = evaluateFollow(f, t, now + 60_000);
  assert.equal(baseline.notice, undefined);
  assert.ok(baseline.follow.estimate);
  assert.ok(evaluateFollow(baseline.follow, changed(5, now + 120_000), now + 120_000).notice);
});
test('already departed or skipped stations never emit departure estimates', () => {
  for (const patch of [{ actualDeparture: iso(now) }, { status: 'Skipped' }]) {
    const t = changed(20); Object.assign(t.calls[0], patch);
    assert.equal(evaluateFollow(follow(), t, now + 60_000).notice, undefined);
    assert.equal(createFollow(t, 'CHI', now), null);
  }
});
test('expiry prunes preferences even without source reports and never extends on reload', () => {
  const f = follow();
  assert.equal(readFollows(JSON.stringify([f]), f.expires).length, 0);
  assert.equal(evaluateFollow(f, changed(20, f.expires), f.expires).notice, undefined);
  assert.equal(readFollows(JSON.stringify([f]), now + 60_000)[0].expires, f.expires);
  assert.equal(createFollow(train(), 'CHI', now + 10 * 86_400_000), null);
});
test('unsubscribe wins over pending requests, erases preferences and clears consent', () => {
  const f = { ...follow(), browser: true };
  const removed = removeFollow([f], f.id);
  assert.deepEqual(removed, []);
  const late = applyObservation(removed, f.id, changed(20), now + 60_000);
  assert.deepEqual(late.follows, []);
  assert.equal(late.notice, undefined);
  assert.equal(createFollow(train(), 'CHI', now).browser, false);
  const active = applyObservation([f], f.id, changed(20), now + 60_000);
  assert.ok(active.notice);
  assert.equal(applyObservation(active.follows, f.id, changed(20), now + 60_000).notice, undefined);
});
test('corrupted storage is explicit; malformed preferences and unbounded retention are discarded', () => {
  assert.throws(() => readFollows('{broken', now));
  assert.throws(() => readFollows('{}', now));
  assert.deepEqual(readFollows(JSON.stringify([null, {}, {...follow(), browser:'yes'}, {...follow(), expires:now + 9 * 86_400_000}]), now), []);
  assert.equal(evaluateFollow({...follow(), signature:'broken'}, changed(10), now + 60_000).notice, undefined);
});
