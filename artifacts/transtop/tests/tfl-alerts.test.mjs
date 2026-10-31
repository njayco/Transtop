import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real server normalizer/service -> real Nearby selector offline.
// Only the TfL transport/cache boundary is replaced; no API keys or DB needed.
const now = Date.parse('2026-10-31T12:00:00Z');
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({ Date: Clock });
let predictions = [], statusPayload = [], failArrivals = false, failStatuses = false;
let discoveredStops = [];
const rawLines = [
  { id: 'victoria', name: 'Victoria', modeName: 'tube' },
  { id: 'mildmay', name: 'Mildmay', modeName: 'overground' },
  { id: '139', name: '139', modeName: 'bus' },
];
const requests = [];
const client = new vm.SyntheticModule(
  ['CREDIT', 'TERMS', 'COVERAGE', 'request', 'health', 'configured', 'safeMessage', 'TflError'],
  function () {
    this.setExport('CREDIT', 'Powered by TfL Open Data');
    this.setExport('TERMS', 'https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service');
    this.setExport('COVERAGE', 'London coverage');
    this.setExport('configured', () => true);
    this.setExport('health', () => ({ status: 'healthy' }));
    this.setExport('safeMessage', () => 'Fixture unavailable');
    this.setExport('TflError', Error);
    this.setExport('request', async (path) => {
      requests.push(path);
      if (path.startsWith('Line/Mode/')) return rawLines;
      if (path === 'StopPoint') return { stopPoints: discoveredStops };
      if (path.endsWith('/Arrivals')) {
        if (failArrivals) throw Error('Arrivals unavailable');
        return predictions;
      }
      if (path.endsWith('/Status')) {
        if (failStatuses) throw Error('Status unavailable');
        return statusPayload;
      }
      throw Error(`Unexpected request: ${path}`);
    });
  }, { context },
);
async function load(path, dependencies = {}, stubExports) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const mod = new vm.SourceTextModule(outputText, { context });
  const imports = ts.createSourceFile(path, outputText, ts.ScriptTarget.ES2022, true).statements
    .filter(ts.isImportDeclaration);
  await mod.link(name => {
    if (dependencies[name]) return dependencies[name];
    if (!stubExports) throw Error(`Unexpected dependency: ${name}`);
    // Fail closed for any unrelated provider accidentally reached by nearby().
    const bindings = imports.find(i => i.moduleSpecifier.text === name).importClause.namedBindings;
    const names = bindings.elements.map(e => e.propertyName?.text ?? e.name.text);
    return new vm.SyntheticModule(names, function () {
      for (const key of names) this.setExport(key, stubExports[key] ?? (() => {
        throw Error(`Unexpected provider access: ${name}.${key}`);
      }));
    }, { context });
  });
  await mod.evaluate();
  return mod;
}
const model = await load('../../api-server/src/transit/tfl/model.ts', { './client': client });
const service = await load('../../api-server/src/transit/tfl/service.ts', { './client': client, './model': model });
const selector = await load('../src/lib/relevant-alerts.ts');
const types = await load('../../api-server/src/transit/types.ts');
const crosswalk = await load('../../api-server/src/transit/tfl/crosswalk.ts', { '../types': types });
const publicService = await load('../../api-server/src/transit/service.ts', {
  './tfl/service': service, './tfl/model': model, './types': types, './tfl/crosswalk': crosswalk,
}, {
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
  stops: { mode: 'mode', agency: 'agency' }, inArray: () => 'fixture query',
  and: () => 'fixture query', ne: () => 'fixture query',
  // Paris has no local SQL matches here. Its realtime transport stays fail-closed.
  findStops: async () => ({ stops: [], total: 0 }),
  isIdfm: id => id.startsWith('idfm:'),
  intercityCatalog: async () => ({ stops: [] }),
  discover: async () => ({ stops: [], routes: [] }),
  isTransitland: id => id.startsWith('tl:'),
  unique: rows => [...new Map(rows.map(row => [row.id, row])).values()],
});
const { line, normalizeStop, notices } = model.namespace;
const { relevantAlerts } = selector.namespace;
const fixtures = JSON.parse(await readFile(new URL('../../api-server/tests/fixtures/tfl-status-severities.json', import.meta.url), 'utf8'));
const routes = [
  line({ id: 'victoria', name: 'Victoria', modeName: 'tube' }),
  line({ id: 'mildmay', name: 'Mildmay', modeName: 'overground' }),
  line({ id: '139', name: '139', modeName: 'bus' }),
];
const stop = normalizeStop({ id: '940GTEST', name: 'Fixture station', lat: 51.5, lon: -.1,
  lines: routes.map(r => ({ id: r.id.slice(9) })) }, routes, now);
const payload = (row, id = 'victoria') => [{ id, name: id, lineStatuses: [{
  id: 100, statusSeverity: row.code, statusSeverityDescription: row.description,
  reason: 'Fixture: severe delays, suspension or closure wording must not override the code.',
}] }];

test('official TfL code fixtures reach Nearby only for explicit route delays/disruptions', () => {
  for (const modeName of ['bus', 'tube', 'dlr', 'elizabeth-line', 'overground']) {
    const route = line({ id: 'fixture', name: 'Fixture', modeName });
    for (const row of fixtures.statuses) {
      const alerts = notices(payload(row, 'fixture'), now);
      const label = `${modeName}: ${row.code} ${row.description}`;
      assert.equal(alerts.length, row.expected === 'omitted' ? 0 : 1, label);
      if (!alerts.length) continue;
      assert.equal(alerts[0].severity, row.expected, label);
      assert.deepEqual(Array.from(alerts[0].routeIds), ['tfl:line:fixture']);
      assert.equal('stopIds' in alerts[0], false);
      assert.match(alerts[0].source, /separate from arrival freshness/);
      assert.equal(relevantAlerts([{ ...stop, routes: [route], alerts }]).length,
        ['delay', 'disruption'].includes(row.expected) ? 1 : 0, label);
    }
  }
  // Missing codes and misleading descriptive text cannot promote a notice.
  const missing = notices(payload({ description: 'Suspended' }), now);
  assert.equal(missing[0].severity, 'info');
  assert.equal(notices(payload({ code: 6, description: 'Information' }), now)[0].severity, 'delay');
});

test('London alerts remain route-wide, deduplicated and subject to Nearby route/agency/mode filters', () => {
  const alerts = [
    ...notices(payload({ code: 6, description: 'Severe Delays' }), now),
    ...notices(payload({ code: 2, description: 'Suspended' }, 'mildmay'), now),
    ...notices(payload({ code: 15, description: 'Diverted' }, '139'), now),
    ...notices(payload({ code: 9, description: 'Minor Delays' }, 'unrelated'), now),
  ];
  const stops = [{ ...stop, alerts }, { ...stop, id: 'tfl:stop:OTHER', alerts }];
  assert.equal(relevantAlerts(stops).length, 3);
  assert.deepEqual(Array.from(relevantAlerts(stops, { type: 'subway' }), a => a.routeIds[0]), ['tfl:line:victoria']);
  assert.deepEqual(Array.from(relevantAlerts(stops, { agency: 'tfl-rail' }), a => a.routeIds[0]), ['tfl:line:mildmay']);
  assert.equal(relevantAlerts(stops, { agency: 'nyct' }).length, 0);
  assert.equal(relevantAlerts(stops, { serviceClass: 'express' }).length, 0);
  assert.equal(relevantAlerts([{ ...stop, routes: [routes[2]], alerts: alerts.slice(0, 1) }]).length, 0);
});

test('expired, future and explicitly inactive TfL statuses do not qualify', () => {
  for (const validity of [
    { fromDate: '2026-10-31T10:00:00Z', toDate: '2026-10-31T11:00:00Z' },
    { fromDate: '2026-10-31T13:00:00Z', toDate: '2026-10-31T14:00:00Z' },
    { fromDate: '2026-10-31T11:00:00Z', toDate: '2026-10-31T13:00:00Z', isNow: false },
  ]) {
    const raw = payload({ code: 6, description: 'Severe Delays' });
    raw[0].lineStatuses[0].validityPeriods = [validity];
    assert.equal(notices(raw, now).length, 0);
  }
  const active = payload({ code: 6, description: 'Severe Delays' });
  active[0].lineStatuses[0].validityPeriods = [{ fromDate: '2026-10-31T11:00:00Z', toDate: '2026-10-31T13:00:00Z' }];
  assert.equal(notices(active, now).length, 1);
});

test('service keeps line alerts independent of missing/stale arrivals and arrival failures', async () => {
  statusPayload = payload({ code: 6, description: 'Severe Delays' });
  const prediction = { id: 'fixture', naptanId: stop.rawId, lineId: 'victoria',
    destinationName: 'Brixton', timestamp: new Date(now - 5000).toISOString(),
    expectedArrival: new Date(now + 300000).toISOString(), timeToLive: new Date(now + 300000).toISOString() };
  for (const state of ['fresh', 'empty', 'stale', 'failed']) {
    requests.length = 0;
    failArrivals = state === 'failed';
    predictions = state === 'empty' ? [] : [{ ...prediction,
      timestamp: new Date(now - (state === 'stale' ? 91000 : 5000)).toISOString() }];
    const result = await service.namespace.enrich(stop);
    assert.equal(result.arrivals.length, state === 'fresh' ? 1 : 0, state);
    assert.equal(relevantAlerts([result]).length, 1, state);
    assert.equal(result.updatedAt, state === 'fresh' ? prediction.timestamp : stop.updatedAt, state);
    if (state === 'fresh') assert.equal(result.arrivals[0].expiresAt, new Date(now + 85000).toISOString());
    assert.deepEqual(requests, ['StopPoint/940GTEST/Arrivals', 'Line/victoria,mildmay,139/Status']);
  }
  failArrivals = false;
  failStatuses = true;
  predictions = [prediction];
  const result = await service.namespace.enrich(stop);
  assert.equal(result.arrivals.length, 1);
  assert.equal(result.arrivals[0].expiresAt, new Date(now + 85000).toISOString());
  assert.equal(result.alerts.length, 0);
  assert.match(result.tfl.message, /Line notices unavailable/);
});

test('public Nearby fetches shared London line notices, never per-stop arrivals', async () => {
  discoveredStops = [
    { id: '940GTEST', name: 'Fixture station', lat: 51.5, lon: -.1, lines: [{ id: 'victoria' }, { id: 'mildmay' }] },
    { id: '940GOTHER', name: 'Second station', lat: 51.501, lon: -.1, lines: [{ id: 'victoria' }] },
    { id: '49000TEST', name: 'Bus stop', lat: 51.502, lon: -.1, lines: [{ id: '139' }] },
  ];
  failStatuses = false;
  failArrivals = true; // A prediction fan-out would fail this test's request assertions.
  statusPayload = [
    ...payload({ code: 6, description: 'Severe Delays' }),
    ...payload({ code: 19, description: 'Information' }, 'mildmay'),
    ...payload({ code: 999, description: 'Suspended' }, '139'),
    ...payload({ code: 2, description: 'Suspended' }, 'unrelated'),
  ];
  requests.length = 0;
  const result = await publicService.namespace.nearby({ mode: 'live', lat: 51.5, lon: -.1 });
  assert.equal(result.stops.length, 3);
  assert.deepEqual(Array.from(relevantAlerts(result.stops), a => a.routeIds[0]), ['tfl:line:victoria']);
  assert.equal(result.stops[1].alerts[0].severity, 'delay');
  assert.ok(result.stops.every(s => !s.alerts.some(a => a.routeIds.includes('tfl:line:unrelated'))));
  assert.ok(result.stops.every(s => s.arrivals.length === 0));
  assert.ok(result.stops.every(s => s.updatedAt === new Date(now).toISOString()));
  assert.deepEqual(requests, ['Line/Mode/bus,tube,dlr,elizabeth-line,overground', 'StopPoint', 'Line/victoria,mildmay,139/Status']);

  requests.length = 0;
  const busOnly = await publicService.namespace.nearby({ mode: 'live', lat: 51.5, lon: -.1, type: 'bus' });
  assert.equal(busOnly.stops.length, 1);
  assert.equal(relevantAlerts(busOnly.stops).length, 0);
  assert.deepEqual(requests.filter(p => p.endsWith('/Status')), ['Line/139/Status']);

  failStatuses = true;
  const failed = await publicService.namespace.nearby({ mode: 'live', lat: 51.5, lon: -.1 });
  assert.equal(failed.stops.length, 3);
  assert.ok(failed.stops.every(s => !s.arrivals.length && !s.alerts.length));
  assert.ok(failed.stops.every(s => s.tfl.message.includes('Line notices unavailable')));
  failStatuses = false;
  statusPayload = payload({ code: 10, description: 'Good Service' });
  const recovered = await publicService.namespace.nearby({ mode: 'live', lat: 51.5, lon: -.1 });
  assert.equal(relevantAlerts(recovered.stops).length, 0);

  requests.length = 0;
  discoveredStops = [];
  const empty = await publicService.namespace.nearby({ mode: 'live', lat: 51.5, lon: -.1 });
  assert.equal(empty.stops.length, 0);
  assert.ok(requests.every(p => !p.endsWith('/Status') && !p.endsWith('/Arrivals')));
});

test('Nearby line notices batch all unique routes without truncating or refreshing predictions', async () => {
  const manyRoutes = Array.from({ length: 31 }, (_, i) => line({ id: `route-${i}`, name: `Route ${i}`, modeName: 'bus' }));
  statusPayload = payload({ code: 15, description: 'Diverted' }, 'route-30');
  const unchangedArrival = { id: 'unchanged', expiresAt: new Date(now - 1).toISOString() };
  const source = { ...stop, routes: manyRoutes, arrivals: [unchangedArrival] };
  requests.length = 0;
  const result = await service.namespace.withLineNotices([source, { ...source, id: 'tfl:stop:SECOND' }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].split('/')[1].split(',').length, 30);
  assert.equal(requests[1], 'Line/route-30/Status');
  assert.equal(relevantAlerts(result).length, 1);
  assert.equal(result[0].arrivals, source.arrivals);
  assert.equal(result[0].updatedAt, source.updatedAt);
});
