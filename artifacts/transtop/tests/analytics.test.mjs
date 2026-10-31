import test from 'node:test';
import assert from 'node:assert/strict';
import { trackEvent } from '../src/lib/analytics.ts';

test('analytics is safe without a browser or injected tracker', () => {
  delete globalThis.window;
  assert.doesNotThrow(() => trackEvent('entry_completed'));
  globalThis.window = {};
  assert.doesNotThrow(() => trackEvent('search_performed', { has_query: true }));
  delete globalThis.window;
});

test('events deliver only the supplied coarse dimensions and preserve tracker context', () => {
  const calls = [];
  const tracker = { track(name, data) {
    assert.equal(this, tracker);
    calls.push({ name, data });
  } };
  globalThis.window = { umami: tracker };
  trackEvent('entry_completed');
  trackEvent('search_performed', { has_query: true });
  trackEvent('stop_viewed', { mode: 'bus' });
  trackEvent('route_viewed', { mode: 'rail' });
  trackEvent('favorite_changed', { kind: 'stop', action: 'added', mode: 'bus' });
  trackEvent('favorite_changed', { kind: 'route', action: 'removed', mode: 'rail' });
  assert.equal(calls.length, 6);
  assert.deepEqual(calls[1], { name: 'search_performed', data: { has_query: true } });
  assert.deepEqual(calls[5].data, { kind: 'route', action: 'removed', mode: 'rail' });
  assert.ok(calls.every(c => /^[a-z_]{1,49}$/.test(c.name)));
  delete globalThis.window;
});

test('synchronous tracker errors and asynchronous rejections are harmless', async () => {
  globalThis.window = { umami: { track() { throw new Error('unavailable'); } } };
  assert.doesNotThrow(() => trackEvent('entry_completed'));
  globalThis.window = { umami: { track() { return Promise.reject(new Error('offline')); } } };
  assert.doesNotThrow(() => trackEvent('entry_completed'));
  await new Promise(resolve => setImmediate(resolve));
  delete globalThis.window;
});
