import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as engine from '../src/lib/train-follow.ts';

const start = Date.parse('2026-10-31T14:00:00Z');
function report(at = start, shift = 0) {
  return {
    id: 'observation', tripId: 'amtrak:5', trainNumber: '5', serviceDate: '20261031',
    matched: true, state: 'Active', source: 'Amtraker · upstream Amtrak observation (unofficial)',
    updatedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300_000).toISOString(),
    calls: [
      {code:'CHI', name:'Chicago', sequence:1, scheduledArrival:null, scheduledDeparture:new Date(start + 3600_000).toISOString(),
        estimatedDeparture:new Date(start + 3600_000 + shift * 60_000).toISOString(), actualDeparture:null, status:'Enroute'},
      {code:'DEN', name:'Denver', sequence:2, scheduledArrival:new Date(start + 86_400_000).toISOString(), scheduledDeparture:null},
    ],
  };
}
async function harness({ browser = false, seeded = true, permission = 'default' } = {}) {
  let clock = start, response = report(), cursor = 0, mounted = false, value;
  let requestPermission = async () => permission;
  const state = [], effects = [], events = {}, timers = [], alerts = [];
  const initial = engine.createFollow(report(start - 60_000), 'CHI', start - 60_000);
  const store = new Map(seeded ? [[engine.FOLLOW_KEY, JSON.stringify([{...initial, browser}])]] : []);
  const localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };
  const Notification = class {
    static permission = permission;
    static async requestPermission() { return requestPermission(); }
    constructor(title, options) { alerts.push({title, options}); }
  };
  const context = vm.createContext({
    console, JSON, Promise, AbortSignal, Notification, localStorage,
    Date: class extends Date { static now() { return clock; } },
    navigator: { locks: { request: async (_key, fn) => fn() } },
    window: {
      Notification,
      addEventListener: (name, fn) => { events[name] = fn; },
      removeEventListener: name => { delete events[name]; },
    },
    setInterval: fn => { timers.push(fn); return timers.length; },
    clearInterval() {},
  });
  const react = {
    createContext: () => ({Provider:'provider'}),
    useContext: () => value,
    useEffect: fn => { if (!mounted) effects.push(fn); },
    useState: initial => {
      const key = cursor++;
      if (!(key in state)) state[key] = initial;
      return [state[key], next => { state[key] = typeof next === 'function' ? next(state[key]) : next; }];
    },
  };
  const jsx = { jsx: (_tag, props) => { if (props.value) value = props.value; return props; }, jsxs: (_tag, props) => { if (props.value) value = props.value; return props; } };
  const source = await readFile(new URL('../src/lib/train-follows.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module = new vm.SourceTextModule(compiled, {context});
  await module.link(spec => {
    const exports = spec === 'react' ? react : spec === 'react/jsx-runtime' ? jsx :
      spec === './train-follow' ? engine : spec === 'wouter' ? {Link:'link'} :
      {getTrain:async () => {
        if (response instanceof Error) throw response;
        return typeof response === 'function' ? response() : response;
      }};
    return new vm.SyntheticModule(Object.keys(exports), function() {
      for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
    }, {context});
  });
  await module.evaluate();
  const render = () => {
    cursor = 0; module.namespace.TrainFollowsProvider({children:null});
    effects.splice(0).forEach(fn => fn()); mounted = true;
    return value;
  };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render(); await flush();
  return {
    state, alerts, store, events, Notification, render, flush,
    permission: fn => { requestPermission = fn; },
    response: r => { response = r; },
    async tick(at = clock + 60_000) { clock = at; timers[0](); await flush(); },
  };
}
test('following never requests browser consent; denied consent keeps in-app alerts only', async () => {
  const h = await harness({seeded:false});
  let prompts = 0;
  h.permission(async () => { prompts++; return 'denied'; });
  h.render().follow(report(), 'CHI'); await h.flush();
  assert.equal(prompts, 0);
  assert.equal(h.state[0].length, 1);
  await h.render().browserAlerts(h.state[0][0].id, true); await h.flush();
  assert.equal(prompts, 1);
  assert.equal(h.state[0][0].browser, false);
  h.response(report(start + 60_000, 5)); await h.tick();
  assert.equal(h.state[1].length, 1);
  assert.equal(h.alerts.length, 0);
});
test('granted permission and per-follow consent are both required; revocation stops delivery', async () => {
  const h = await harness({permission:'granted'});
  h.response(report(start + 60_000, 5)); await h.tick();
  assert.equal(h.alerts.length, 0);
  await h.render().browserAlerts(h.state[0][0].id, true); await h.flush();
  h.response(report(start + 120_000, 10)); await h.tick();
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0].options.body, /Unofficial/);
  h.Notification.permission = 'denied';
  h.response(report(start + 180_000, 15)); await h.tick();
  assert.equal(h.alerts.length, 1);
  assert.equal(h.state[1].length, 3);
});
test('unfollow while consent is pending never recreates a subscription', async () => {
  const h = await harness();
  let grant;
  h.permission(() => new Promise(resolve => { grant = resolve; }));
  const id = h.state[0][0].id;
  const pending = h.render().browserAlerts(id, true);
  h.render().unfollow(id); await h.flush();
  grant('granted'); await pending; await h.flush();
  assert.equal(h.state[0].length, 0);
  assert.equal(JSON.parse(h.store.get(engine.FOLLOW_KEY)).length, 0);
});
test('outage creates no notification; unsubscribe while polling prevents late alerts', async () => {
  const h = await harness({browser:true, permission:'granted'});
  h.response(new Error('source outage')); await h.tick();
  assert.equal(h.state[1].length, 0);
  let resolve;
  h.response(() => new Promise(done => { resolve = done; }));
  await h.tick();
  h.render().unfollow(h.state[0][0].id); await h.flush();
  resolve(report(start + 120_000, 15)); await h.flush();
  assert.equal(h.state[0].length, 0);
  assert.equal(h.state[1].length, 0);
  assert.equal(h.alerts.length, 0);
});
test('expired follows are deleted during outages; clearing local data updates in-app state immediately', async () => {
  const h = await harness();
  h.response(report(start + 60_000, 5)); await h.tick();
  assert.equal(h.state[1].length, 1);
  h.store.delete(engine.FOLLOW_KEY);
  h.events['transtop:local-data-cleared'](); h.render();
  assert.equal(h.state[0].length, 0);
  assert.equal(h.state[1].length, 0);
  const other = await harness();
  const expires = other.state[0][0].expires;
  other.response(new Error('offline')); await other.tick(expires);
  assert.equal(other.state[0].length, 0);
  assert.deepEqual(JSON.parse(other.store.get(engine.FOLLOW_KEY)), []);
});
