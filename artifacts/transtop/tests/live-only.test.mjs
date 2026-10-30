import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual browser modules in isolated stores. No network or geolocation
// permissions are needed, and each restoration test gets a fresh module instance.
function storage(initial = {}) {
  const values = { ...initial };
  return {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
    removeItem: (key) => { delete values[key]; },
    ...Object.fromEntries(Object.keys(initial).map((key) => [key, initial[key]])),
  };
}

async function loadModule(file, { local = {}, session = {}, failEnd = false } = {}) {
  const calls = { watch: 0, clear: 0, end: [], samples: [], reports: [], timers: [], events: {} };
  let state;
  let providerValue;
  const localStorage = storage(local);
  const sessionStorage = storage(session);
  const effects = [];
  const context = vm.createContext({
    console, Date, Set, JSON, Promise, Event, localStorage, sessionStorage,
    document: { visibilityState: 'visible', documentElement: { classList: { toggle() {} } } },
    navigator: { onLine: true, geolocation: {
      watchPosition(callback) { calls.watch++; calls.position = callback; return 42; },
      clearWatch() { calls.clear++; },
    } },
    window: {
      addEventListener(name, callback) { calls.events[name] = callback; },
      dispatchEvent(event) { calls.events[event.type]?.(event); },
      setTimeout(fn, ms) { calls.timers.push({ fn, ms }); return calls.timers.length; },
      clearTimeout() {},
    },
  });
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useContext: () => providerValue,
    useState: (initial) => {
      state ??= typeof initial === 'function' ? initial() : initial;
      return [state, (next) => { state = typeof next === 'function' ? next(state) : next; }];
    },
    useEffect: (effect) => { effects.push(effect); },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    createElement: (_type, props) => { providerValue = props.value; return props; },
  };
  react.default = react;
  context.React = react;
  const api = {
    endRide: async (id, options) => {
      calls.end.push({ id, options });
      if (failEnd) throw new Error('offline');
    },
    submitSample: async (...args) => { calls.samples.push(args); return { status: 'accepted' }; },
    submitReport: async (...args) => { calls.reports.push(args); },
  };
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = new vm.SourceTextModule(outputText, { context });
  await module.link((specifier) => {
    const exports = specifier === 'react' ? react : api;
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return {
    mod: module.namespace, calls, localStorage, sessionStorage,
    renderPrefs() {
      module.namespace.PrefsProvider({ children: null });
      effects.splice(0).forEach((effect) => effect());
      return providerValue;
    },
  };
}

test('fresh, malformed and legacy Demo preferences are Live synchronously', async () => {
  for (const raw of [undefined, '{', JSON.stringify({ mode: 'demo', reduceMotion: true, largeText: true, favStops: [{ id: 'saved-stop' }], favRoutes: [{ id: 'saved-route' }] })]) {
    const env = await loadModule('lib/prefs.tsx', { local: raw ? { 'transtop.prefs.v1': raw } : {} });
    const prefs = env.renderPrefs();
    assert.equal(prefs.mode, 'live');
    assert.equal(JSON.parse(env.localStorage.getItem('transtop.prefs.v1')).mode, 'live');
    if (raw?.startsWith('{"')) {
      assert.equal(prefs.reduceMotion, true);
      assert.equal(prefs.largeText, true);
      assert.equal(prefs.favStops[0].id, 'saved-stop');
      assert.equal(prefs.favRoutes[0].id, 'saved-route');
    }
  }
});

test('preference updates cannot restore Demo, and reset remains Live', async () => {
  const env = await loadModule('lib/prefs.tsx');
  env.renderPrefs().set({ mode: 'demo', largeText: true });
  const updated = env.renderPrefs();
  assert.equal(updated.mode, 'live');
  assert.equal(updated.largeText, true);
  updated.clearAll();
  const reset = env.renderPrefs();
  assert.equal(reset.mode, 'live');
  assert.equal(reset.largeText, false);
  assert.equal(reset.favStops.length, 0);
});

test('contaminated arrivals/vehicles are removed while real source labels remain intact', async () => {
  const { mod } = await loadModule('lib/prefs.tsx');
  const sources = ['demo', 'DEMO', 'Demo vehicle', 'community-demo', 'live', 'community', 'scheduled', 'unavailable'];
  const result = mod.honest(sources.map((source) => ({ source })), 'demo');
  assert.deepEqual(Array.from(result, (r) => r.source), ['live', 'community', 'scheduled', 'unavailable']);
});

const ride = (mode = 'live') => ({
  id: 'test-ride', token: 'test-only-token', expiresAt: new Date(Date.now() + 60_000).toISOString(),
  mode, routeId: 'mta:1', direction: 'Uptown', stopId: 'stop-1',
});

test('restored Demo rides clear synchronously, revoke, and never watch, sample or report', async () => {
  const env = await loadModule('lib/ride.ts', { session: { 'transtop.ride': JSON.stringify(ride('demo')) } });
  assert.equal(env.mod.useActiveRide(), null);
  assert.equal(env.sessionStorage.getItem('transtop.ride'), null);
  assert.equal(env.calls.watch, 0);
  assert.equal(env.calls.timers.length, 0);
  assert.equal(env.calls.end[0].id, 'test-ride');
  env.mod.startWatching();
  await assert.rejects(env.mod.report('arrived'), /No active live ride/);
  assert.equal(env.calls.samples.length, 0);
  assert.equal(env.calls.reports.length, 0);
});

test('offline Demo cleanup queues a revocation instead of resuming the ride', async () => {
  const env = await loadModule('lib/ride.ts', { failEnd: true, session: { 'transtop.ride': JSON.stringify(ride('demo')) } });
  await new Promise(setImmediate);
  assert.equal(env.mod.useActiveRide(), null);
  assert.equal(env.calls.watch, 0);
  assert.equal(env.mod.pendingEndCount(), 1);
  assert.equal(JSON.parse(env.sessionStorage.getItem('transtop.ride.pendingEnd'))[0].id, 'test-ride');
});

test('expired Demo rides are still revoked, and new Demo rides cannot begin', async () => {
  const expired = { ...ride('demo'), expiresAt: '2020-01-01T00:00:00Z' };
  const env = await loadModule('lib/ride.ts', { session: { 'transtop.ride': JSON.stringify(expired) } });
  assert.equal(env.calls.end.length, 1);
  env.mod.beginRide(ride('demo'));
  assert.equal(env.calls.end.length, 2);
  assert.equal(env.calls.watch, 0);
  assert.equal(env.mod.useActiveRide(), null);
});

test('real restored rides continue watching, contributing, reporting and stopping', async () => {
  const env = await loadModule('lib/ride.ts', { session: { 'transtop.ride': JSON.stringify(ride()) } });
  assert.equal(env.mod.useActiveRide().mode, 'live');
  assert.equal(env.calls.watch, 1);
  env.calls.position({ coords: { latitude: 40.7, longitude: -73.9, accuracy: 10 }, timestamp: Date.now() });
  await env.mod.report('arrived');
  assert.equal(env.calls.samples.length, 1);
  assert.equal(env.calls.reports.length, 1);
  assert.equal(await env.mod.stopRide(), 'revoked');
  assert.equal(env.calls.clear, 1);
  assert.equal(env.mod.useActiveRide(), null);
});
