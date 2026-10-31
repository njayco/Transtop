import assert from 'node:assert/strict';
import { providerName } from '../src/lib/provider-name.ts';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Render the real Nearby and Intercity components with controlled hooks/API data,
// following map-lifecycle.test.mjs. No live feeds, DOM or Maps credentials.
async function mountNearby(isMobile) {
  const instances = new Map(), timers = new Map(), requests = {};
  let current, tree, nextTimer = 0;
  const modes = ['subway', 'bus', 'rail', 'intercity'];
  const providers = [
    { id: 'martz', name: 'Martz', status: 'imported' },
    { id: 'other', name: 'Other provider', status: 'link-only' },
  ];
  const data = {
    providers, radiusMeters: 3000, updatedAt: new Date().toISOString(),
    message: 'Controlled coverage notice',
    departures: Array.from({ length: 6 }, (_, i) => ({
      id: `departure-${i}`, providerId: 'martz', providerName: 'Martz',
      destination: 'Test destination', stopName: 'Port Authority',
      time: `2026-10-30T${15 + i}:00:00-04:00`, serviceDate: '2026-10-30', stops: [],
    })),
  };
  let intercity = { data, isLoading: false, isError: false, refetch() {} };
  let ready = true, stopError = false, stopPlaceholder = false, stopAlerts = {};
  function slot(initial) {
    const i = current.cursor++;
    return current.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
  }
  const react = {
    useState(initial) {
      const s = slot(initial);
      return [s.value, (value) => { s.value = typeof value === 'function' ? value(s.value) : value; }];
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useEffect(fn, deps) {
      const s = slot({});
      if (!s.deps || !deps || deps.some((d, i) => d !== s.deps[i])) {
        s.cleanup?.();
        s.cleanup = fn();
        s.deps = deps;
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const stub = (name) => (props) => jsx(name, props);
  const icons = Object.fromEntries(['LocateFixed', 'Search', 'List', 'Map', 'X', 'MapPin', 'Globe2', 'ChevronDown', 'ExternalLink', 'CalendarClock', 'Route'].map((name) => [name, stub(name)]));
  const api = {
    getGetStopsQueryKey: (p) => ['stops', p],
    getGetNetworkQueryKey: (p) => ['network', p],
    getGetMapVehiclesQueryKey: (p) => ['vehicles', p],
    getGetIntercityDeparturesQueryKey: (p) => ['intercity', p],
    useGetSources: () => ({ data: modes.map((type) => ({ id: type, agency: type, type })) }),
    useGetAlerts: () => { throw new Error('Nearby must not request network-wide alerts'); },
    useGetMapVehicles: () => ({ data: [] }),
    useGetStops(params) {
      requests.stops = params;
      return {
        isLoading: !ready,
        isError: stopError,
        isPlaceholderData: stopPlaceholder,
        data: ready ? {
          centerLat: 40.756, centerLon: -73.991, updatedAt: new Date().toISOString(),
          stops: modes.filter((type) => !params.type || params.type === type).map((type) => ({
            id: `${type}-stop`, name: `${type} stop`, type,
            routes: [{ id: `${type}:route`, type, agencyId: type, agency: type, serviceClass: 'local' }],
            alerts: stopAlerts[type] ?? [], lat: 40.756, lon: -73.991,
          })),
        } : undefined,
      };
    },
    useGetNetwork(params) {
      requests.network = params;
      return { data: { stops: [], lines: [], missingGeometry: [] } };
    },
    useGetIntercityDepartures: () => intercity,
  };
  const context = vm.createContext({
    console, Date, Intl,
    setInterval(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearInterval: (id) => timers.delete(id),
  });
  const mocks = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'lucide-react': icons, '@workspace/api-client-react': api,
    wouter: { useLocation: () => ['/', () => {}] },
    '@/components/regional-map': { RegionalMap: stub('RegionalMap') },
    '@/components/global-coverage': { GlobalCoverageNotice: stub('GlobalCoverageNotice') },
    '@/components/tfl-details': { TflDetails: stub('TflDetails') },
    '@/components/shell': { MobileTop: stub('MobileTop') },
     '@/components/transit': Object.fromEntries(['ServiceAlerts', 'AlertRow', 'ErrorState', 'SkeletonCards', 'StopCard', 'TransitLines', 'RouteBadge'].map((name) => [name, stub(name)])),
    '@/components/transit-map': { TransitMap: stub('TransitMap'), vehicleKind: () => 'live' },
    '@/lib/prefs': { TIMES_SQUARE: { lat: 40.756, lon: -73.991, label: 'Port Authority' }, usePrefs: () => ({ mode: 'live' }) },
    '@/lib/format': { ago: () => 'just now', clock: (v) => v },
    '@/lib/provider-name': { providerName },
    '@/lib/vehicle-visibility': { trackedVehicleVisible: () => true },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/hooks/use-mobile': { useIsMobile: () => isMobile },
  };
  async function load(path) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    });
    const module = new vm.SourceTextModule(outputText, { context });
    await module.link((name) => {
      assert.ok(mocks[name], `Unexpected import ${name}`);
      return new vm.SyntheticModule(Object.keys(mocks[name]), function () {
        for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value);
      }, { context });
    });
    await module.evaluate();
    return module.namespace;
  }
  mocks['@/components/intercity'] = await load('../src/components/intercity.tsx');
  mocks['@/lib/relevant-alerts'] = await load('../src/lib/relevant-alerts.ts');
  const { default: Nearby } = await load('../src/pages/nearby.tsx');
  function renderNode(node, path, visited) {
    if (Array.isArray(node)) return node.map((child, i) => renderNode(child, `${path}.${child?.key ?? i}`, visited));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const id = `${path}:${node.type.name}:${node.key ?? ''}`;
      const instance = instances.get(id) ?? { slots: [] };
      instances.set(id, instance);
      visited.add(id);
      current = instance;
      current.cursor = 0;
      const rendered = renderNode(node.type(node.props), `${id}.render`, visited);
      return rendered && !Array.isArray(rendered) && typeof rendered === 'object'
        ? { ...rendered, key: node.key ?? rendered.key } : rendered;
    }
    return { ...node, props: { ...node.props, children: renderNode(node.props.children, `${path}.children`, visited) } };
  }
  function render() {
    const visited = new Set();
    tree = renderNode(jsx(Nearby, {}), 'root', visited);
    for (const [id, instance] of instances) {
      if (!visited.has(id)) {
        instance.slots.forEach((s) => s.cleanup?.());
        instances.delete(id);
      }
    }
  }
  function find(predicate, node) {
    if (Array.isArray(node)) return node.flatMap((child) => find(predicate, child));
    if (!node || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...find(predicate, node.props.children ?? null)];
  }
  const byId = (id) => find((n) => n.props['data-testid'] === id, tree);
  render();
  return {
    render, requests, timers, byId,
    find: (predicate) => find(predicate, tree),
    setReady(value) { ready = value; render(); },
    setStopAlerts(value) { stopAlerts = value; render(); },
    setStopError(value) { stopError = value; render(); },
    setStopPlaceholder(value) { stopPlaceholder = value; render(); },
    setIntercity(value) { intercity = { ...intercity, ...value }; render(); },
    choose(mode) { byId(`filter-${mode}`)[0].props.onClick(); render(); },
    change(id, value) { byId(id)[0].props.onChange({ target: { value } }); render(); },
    text() {
      function content(node) {
        if (Array.isArray(node)) return node.map(content).join('');
        if (node && typeof node === 'object') return content(node.props.children);
        return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
      }
      return content(tree);
    },
  };
}

for (const mobile of [false, true]) {
  test(`Nearby ${mobile ? 'mobile' : 'desktop'}: scoped alert candidates, identity resets and unavailable results`, async () => {
    const env = await mountNearby(mobile);
    const disclosure = () => env.find(n => n.type === 'ServiceAlerts')[0];
    const delay = { id: 'bus-delay', severity: 'delay', routeIds: ['bus:route'], source: 'Agency' };
    env.setStopAlerts({
      bus: [delay, delay, { ...delay, id: 'global', routeIds: [] }, { ...delay, id: 'notice', severity: 'notice' }],
      subway: [{ ...delay, id: 'subway-delay', routeIds: ['subway:route'] }],
    });
    assert.deepEqual(Array.from(disclosure().props.alerts, a => a.id), ['subway-delay', 'bus-delay']);
    let key = disclosure().key;
    env.choose('bus');
    assert.notEqual(disclosure().key, key, 'native details remount closed when filters change');
    assert.deepEqual(Array.from(disclosure().props.alerts, a => a.id), ['bus-delay']);
    key = disclosure().key;
    env.change('select-nearby-class', 'express');
    assert.notEqual(disclosure().key, key);
    assert.equal(disclosure().props.alerts.length, 0, 'mixed stop routes cannot leak unmatched service classes');
    env.change('select-nearby-class', 'all');
    key = disclosure().key;
    env.change('input-nearby-search', 'New place');
    env.find(n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    env.render();
    assert.notEqual(disclosure().key, key, 'new search resets disclosure even with cached data');
    env.setStopError(true);
    assert.equal(disclosure().props.alerts.length, 0);
    env.setStopError(false);
    env.setReady(false);
    assert.equal(disclosure().props.alerts.length, 0);
    env.setReady(true);
    env.setStopPlaceholder(true);
    assert.equal(disclosure().props.alerts.length, 0);
    env.setStopPlaceholder(false);
    assert.equal(disclosure().props.alerts.length, 1);
    env.choose('rail');
    assert.equal(disclosure().props.alerts.length, 0, 'previous results do not remain after filtering');
  });
}

function assertExcluded(env) {
  assert.equal(env.byId('section-intercity').length, 0);
  assert.equal(env.find((n) => /intercity/.test(n.props['data-testid'] ?? '') && n.props['data-testid'] !== 'filter-intercity').length, 0);
  assert.doesNotMatch(env.text(), /Controlled coverage notice|Intercity departures unavailable|No imported intercity departures/);
  assert.equal(env.timers.size, 0, 'unmount clears the real intercity clock refresh interval');
}

for (const mobile of [false, true]) {
  test(`Nearby ${mobile ? 'mobile list' : 'desktop panel'}: all five filters, cached results and restoration`, async () => {
    const env = await mountNearby(mobile);
    const count = env.byId('section-intercity').length;
    assert.ok(count > 0);
    assert.equal(env.byId('card-intercity-departure-4').length, 0, 'All is compact (four departures)');
    assert.match(env.text(), /2 more. Choose/);
    for (const mode of ['subway', 'bus', 'rail', 'intercity', 'all']) {
      env.choose(mode);
      assert.equal(env.requests.stops.type, mode === 'all' ? undefined : mode);
      assert.equal(env.requests.network.type, mode === 'all' ? undefined : mode);
      const stops = env.find((n) => n.type === 'StopCard');
      assert.deepEqual([...new Set(stops.map((n) => n.props.stop.type))].sort(),
        mode === 'all' ? ['bus', 'intercity', 'rail', 'subway'] : [mode]);
      if (['subway', 'bus', 'rail'].includes(mode)) assertExcluded(env);
      else {
        assert.equal(env.byId('section-intercity').length, count);
        assert.equal(env.byId('select-intercity-provider').length, count);
        assert.equal(env.byId('input-intercity-date').length, count);
        assert.equal(env.byId('input-intercity-from').length, count);
        assert.equal(env.byId('details-intercity-gaps').length, count);
        assert.equal(env.byId('card-intercity-departure-5').length, mode === 'intercity' ? count : 0);
      }
    }
    env.choose('intercity');
    env.change('select-intercity-provider', 'martz');
    assert.equal(env.requests.stops.agency, 'martz');
    assert.equal(env.requests.network.agency, 'martz');
    env.choose('bus');
    assertExcluded(env);
    env.choose('intercity');
    assert.equal(env.byId('select-intercity-provider')[0].props.value, '', 'mode change resets provider');
    env.change('select-intercity-provider', 'martz');
    env.change('input-nearby-search', 'Penn Station');
    env.find((n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    env.render();
    assert.equal(env.requests.stops.q, 'Penn Station');
    assert.equal(env.requests.stops.agency, undefined, 'location change resets provider');
  });

  test(`Nearby ${mobile ? 'mobile list' : 'desktop panel'}: readiness, pending requests, errors and empty messages`, async () => {
    const env = await mountNearby(mobile);
    env.setReady(false);
    assertExcluded(env);
    env.setIntercity({ data: undefined, isLoading: true });
    env.setReady(true);
    assert.ok(env.byId('section-intercity').length);
    assert.ok(env.find((n) => n.props.className === 'skel h-20').length);
    for (const mode of ['subway', 'bus', 'rail']) {
      env.choose(mode);
      assertExcluded(env);
      env.setIntercity({ isLoading: false, data: { providers: [], departures: [], message: 'Controlled coverage notice', radiusMeters: 3000 } });
      assertExcluded(env); // a pending request resolving cannot restore the section
      env.choose('intercity');
      assert.ok(env.byId('text-intercity-empty').length);
      env.setIntercity({ data: undefined, isError: true });
      assert.ok(env.byId('button-intercity-retry').length);
      env.choose(mode);
      assertExcluded(env);
      env.choose('all');
      assert.ok(env.byId('button-intercity-retry').length);
      env.setIntercity({ isError: false, isLoading: true });
    }
  });
}
