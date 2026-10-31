import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const start = Date.parse('2026-10-31T12:00:00Z');
const statusPath = 'Line/victoria,mildmay/Status';
const arrivalPath = 'StopPoint/940GTEST/Arrivals';
const statusRow = (code, description, id = 'victoria') => ({
  id, name: id, lineStatuses: [{ id: 100, statusSeverity: code, statusSeverityDescription: description }],
});

// Load production modules without importing the DB package or reading credentials.
// Only external I/O is substituted: request(), its cache and normalization stay real.
async function fixture() {
  let now = start;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, URL, Buffer, AbortSignal, process: { env: {} },
    fetch: () => { throw Error('Unexpected default-client fetch'); },
  });
  function bindings(values) {
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  }
  async function load(path, dependencies = {}) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    const mod = new vm.SourceTextModule(outputText, { context });
    await mod.link(name => {
      assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
      return dependencies[name];
    });
    await mod.evaluate();
    return mod;
  }
  const clientModule = await load('../../api-server/src/transit/tfl/client.ts', {
    'node:crypto': bindings({ createHash, randomUUID }),
    '@workspace/db': bindings({ pool: { query() { throw Error('Unexpected database access'); } } }),
  });
  const cache = new Map(), calls = [], blocks = [];
  const state = {
    statuses: [statusRow(6, 'Severe Delays')],
    predictions: [{
      id: 'fixture', naptanId: '940GTEST', lineId: 'victoria', destinationName: 'Brixton',
      timestamp: new Date(start - 5000).toISOString(),
      expectedArrival: new Date(start + 300000).toISOString(),
      timeToLive: new Date(start + 300000).toISOString(),
    }],
    failure: undefined, gate: undefined,
  };
  const client = clientModule.namespace.createClient({
    store: {
      async get(key) { return cache.get(key); },
      async put(key, entry) { cache.set(key, entry); },
      async reserve() { return true; }, // Rate-limit scheduling is tested separately.
      async block(until) { blocks.push(until); },
    },
    key: () => 'offline-fixture-key',
    enabled: () => true,
    now: () => now,
    sleep: async () => { throw Error('Unexpected wait in cache lifecycle test'); },
    fetch: async url => {
      assert.equal(url.origin, 'https://api.tfl.gov.uk');
      const path = url.pathname.slice(1);
      assert.ok([statusPath, arrivalPath].includes(path), `Unexpected fixture fetch: ${path}`);
      calls.push(path);
      if (path === statusPath) {
        if (state.gate) {
          state.gate.started();
          await state.gate.pending;
        }
        if (state.failure === 'network') throw Error('Offline fixture connection failure');
        if (state.failure === 'http') return new Response('{}', { status: 503 });
        return Response.json(state.statuses);
      }
      return Response.json(state.predictions);
    },
  });
  const boundary = bindings({
    ...Object.fromEntries(Object.entries(clientModule.namespace)),
    request: client.request, health: client.health, configured: () => true,
  });
  const model = await load('../../api-server/src/transit/tfl/model.ts', { './client': boundary });
  const types = await load('../../api-server/src/transit/types.ts');
  const service = await load('../../api-server/src/transit/tfl/service.ts', {
    './client': boundary, './model': model, '../types': types,
  });
  const selector = await load('../src/lib/relevant-alerts.ts');
  const routes = [
    model.namespace.line({ id: 'victoria', name: 'Victoria', modeName: 'tube' }),
    model.namespace.line({ id: 'mildmay', name: 'Mildmay', modeName: 'overground' }),
  ];
  const stop = model.namespace.normalizeStop({
    id: '940GTEST', name: 'Fixture station', lat: 51.5, lon: -.1,
    lines: routes.map(r => ({ id: r.id.slice(9) })),
  }, routes);
  const stops = [stop, { ...stop, id: 'tfl:stop:OTHER', routes: [routes[0]] }];
  return {
    ...service.namespace, state, calls, blocks, client, stop, stops,
    relevantAlerts: selector.namespace.relevantAlerts,
    at(time) { assert.ok(time >= now, 'Clock must not go backwards'); now = time; },
    entry(path) {
      const key = 'tfl:cache:' + createHash('sha256').update(`https://api.tfl.gov.uk/${path}`).digest('hex');
      return cache.get(key);
    },
    holdStatus() {
      let release, started;
      const pending = new Promise(resolve => { release = resolve; });
      const fetched = new Promise(resolve => { started = resolve; });
      state.gate = { pending, started };
      return { fetched, release() { state.gate = undefined; release(); } };
    },
  };
}

for (const [code, description, retained] of [[10, 'Good Service', 0], [19, 'Information', 1]]) {
  test(`cached delay becomes ${description} at the status TTL, not before`, async () => {
    const f = await fixture();
    const initial = await f.withLineNotices(f.stops);
    assert.equal(f.relevantAlerts(initial).length, 1);
    assert.equal(initial[0].alerts[0].severity, 'delay');
    const cached = f.entry(statusPath);
    assert.equal(cached.expires, start + 60000, 'use the production service status TTL');
    f.state.statuses = [statusRow(code, description)];

    f.at(start + 59999);
    const before = await f.withLineNotices(initial);
    assert.equal(f.relevantAlerts(before).length, 1, 'current cached delay remains until expiry');
    assert.equal(f.calls.length, 1);
    assert.equal(f.entry(statusPath), cached, 'cache hits must not slide the expiry');

    f.at(start + 60000);
    const after = await f.withLineNotices(before);
    assert.equal(f.relevantAlerts(after).length, 0, 'replace, do not merge, obsolete delays');
    assert.ok(after.every(s => s.alerts.length === retained));
    if (retained) assert.equal(after[0].alerts[0].severity, 'info', 'Information stays out of Nearby');
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(path => path === statusPath), 'Nearby must never fetch arrivals');
    assert.equal(after[0].arrivals, f.stop.arrivals);
    assert.equal(after[0].updatedAt, f.stop.updatedAt);
  });
}

test('concurrent Nearby refreshes coalesce on cold and expired caches, then reuse the response', async () => {
  const f = await fixture();
  for (const time of [start, start + 60000]) {
    f.at(time);
    const before = f.calls.length;
    const gate = f.holdStatus();
    const requests = Array.from({ length: 8 }, () => f.withLineNotices(f.stops));
    await gate.fetched;
    // All eight calls have reached request(); keep fetch pending while checking coalescing.
    assert.equal(f.calls.length, before + 1);
    gate.release();
    const results = await Promise.all(requests);
    for (const result of results) {
      assert.equal(f.relevantAlerts(result).length, 1, 'deduplicate the shared route across stops');
      assert.equal(result[0].alerts[0].severity, 'delay');
    }
    const cached = f.entry(statusPath);
    assert.equal(cached.expires, time + 60000);
    await Promise.all(Array.from({ length: 8 }, () => f.withLineNotices(f.stops)));
    assert.equal(f.calls.length, before + 1, 'settled concurrent repeats use the cache');
    f.at(time + 59999);
    await f.withLineNotices(f.stops);
    assert.equal(f.entry(statusPath), cached);
    assert.equal(f.calls.length, before + 1);
  }
});

for (const [failure, cooldown] of [['network', 30000], ['http', 60000]]) {
  test(`${failure} failure discards expired alerts; recovery is route-scoped and cannot renew arrivals`, async () => {
    const f = await fixture();
    const enriched = await f.enrich(f.stop);
    assert.equal(enriched.arrivals.length, 1);
    const arrival = enriched.arrivals[0];
    assert.equal(arrival.expiresAt, new Date(start + 85000).toISOString());
    const sources = [enriched, f.stops[1]];
    const cached = f.entry(statusPath);

    f.at(start + 59999);
    const stillCached = await f.withLineNotices(sources);
    assert.equal(f.relevantAlerts(stillCached).length, 1);
    assert.equal(stillCached[0].arrivals[0].expiresAt, arrival.expiresAt);

    f.state.failure = failure;
    f.at(start + 60000);
    const failed = await f.withLineNotices(stillCached);
    assert.equal(f.relevantAlerts(failed).length, 0);
    assert.ok(failed.every(s => s.alerts.length === 0), 'no expired status fallback or retained input alerts');
    assert.ok(failed.every(s => /Line notices unavailable/.test(s.tfl.message)));
    assert.equal(failed[0].arrivals, enriched.arrivals);
    assert.equal(failed[0].updatedAt, enriched.updatedAt);
    assert.equal(f.entry(statusPath), cached, 'failure must not rewrite or extend the expired cache');
    assert.deepEqual(f.blocks, [start + 60000 + cooldown]);
    assert.equal(f.client.health().status, 'unavailable');
    const count = f.calls.length;
    await assert.rejects(f.statuses(f.stop.routes), /TfL/);
    const blocked = await f.withLineNotices(sources);
    assert.equal(f.relevantAlerts(blocked).length, 0);
    assert.equal(f.calls.length, count, 'cooldown must not retry the provider');

    f.state.failure = undefined;
    f.state.statuses = [
      statusRow(10, 'Good Service'),
      statusRow(2, 'Suspended', 'mildmay'),
      statusRow(6, 'Severe Delays', 'unrelated'),
    ];
    f.at(start + 60000 + cooldown);
    const recovered = await f.withLineNotices(failed);
    const alerts = f.relevantAlerts(recovered);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'disruption');
    assert.deepEqual(Array.from(alerts[0].routeIds), ['tfl:line:mildmay']);
    assert.equal('stopIds' in alerts[0], false, 'association does not claim an affected stop');
    assert.equal(recovered[1].alerts.length, 0, 'Victoria-only stop must not inherit Mildmay alert');
    assert.equal(f.relevantAlerts(recovered, { type: 'subway' }).length, 0);
    assert.equal(f.relevantAlerts(recovered, { agency: 'tfl-rail' }).length, 1);
    assert.equal(recovered[0].arrivals, enriched.arrivals);
    assert.equal(recovered[0].arrivals[0].expiresAt, arrival.expiresAt);
    assert.equal(recovered[0].updatedAt, enriched.updatedAt);
    assert.ok(Date.parse(arrival.expiresAt) < start + 60000 + cooldown);
    assert.equal(f.client.health().status, 'healthy');
    assert.equal(f.calls.length, count + 1, 'notice recovery makes only a status request');
    assert.equal(f.entry(statusPath).expires, start + 120000 + cooldown);
    assert.equal(enriched.alerts[0].severity, 'delay', 'input snapshots are not mutated');

    // The fixture still supplies the old observation. Even fetching it again must
    // not manufacture a newer prediction expiry from the successful status refresh.
    const current = await f.enrich(f.stop);
    assert.equal(current.arrivals.length, 0);
    assert.equal(current.updatedAt, f.stop.updatedAt);
    assert.equal(f.relevantAlerts([current]).length, 1);
    assert.equal(f.calls.filter(path => path === statusPath).length, 3);
    assert.equal(f.calls.filter(path => path === arrivalPath).length, 2);
  });
}
