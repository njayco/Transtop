import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real component's event handlers with a controlled SDK and clock.
// No credentials, external requests or Google usage charges are needed.
async function mountMap() {
  const effects = [], refs = [], states = [], timeouts = new Map(), events = new Map();
  let now = 0, nextTimer = 0, instance, viewportCount = 0;
  const window = {
    location: { origin: 'https://transtop.invalid' },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
    dispatchEvent: (event) => events.get(event.type)?.(),
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timeouts.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
  };
  class FakeMap {
    handlers = new Map();
    constructor() { instance = this; }
    addListener(name, fn) {
      this.handlers.set(name, fn);
      return { remove: () => this.handlers.delete(name) };
    }
    emit(name) { this.handlers.get(name)?.(); }
    getRenderingType() { return 'RASTER'; }
    getCenter() { return { lat: () => 40.75, lng: () => -73.98 }; }
    getZoom() { return 14; }
    getBounds() {
      return {
        getSouthWest: () => ({ lat: () => 40.7, lng: () => -74 }),
        getNorthEast: () => ({ lat: () => 40.8, lng: () => -73.9 }),
      };
    }
  }
  const react = {
    useRef(value) { const ref = { current: value }; refs.push(ref); return ref; },
    useState(initial) {
      const slot = { value: typeof initial === 'function' ? initial() : initial };
      states.push(slot);
      return [slot.value, (v) => { slot.value = typeof v === 'function' ? v(slot.value) : v; }];
    },
    useEffect: (effect) => effects.push(effect),
    useMemo: (fn) => fn(),
  };
  const context = vm.createContext({
    console, Date, window, navigator: { onLine: true },
    Event: class { constructor(type) { this.type = type; } },
    ResizeObserver: class { observe() {} disconnect() {} },
    google: { maps: { event: { trigger() {}, clearInstanceListeners() {} } } },
  });
  const mocks = {
    react,
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'fragment' },
    '@/lib/google-maps': { loadGoogleMaps: async () => [{ Map: FakeMap, RenderingType: { RASTER: 'RASTER' } }, {}] },
    './schematic-map': { SchematicMap: () => null },
    './transit': { MODE_COLOR: {} },
    '@/lib/map-style': { DARK_ROADMAP: [] },
  };
  const source = await readFile(new URL('../src/components/transit-map.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = new vm.SourceTextModule(outputText, { context });
  await module.link((name) => {
    const exports = mocks[name];
    assert.ok(exports, `Unexpected import ${name}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  module.namespace.TransitMap({ center: { lat: 40.75, lon: -73.98 }, onViewport: () => viewportCount++ });
  refs[0].current = { dataset: {} };
  const cleanup = effects.map((effect) => effect());
  await Promise.resolve();
  assert.ok(instance, 'SDK constructed the map');
  return {
    map: instance, window, states,
    get viewportCount() { return viewportCount; },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timeouts]) {
        if (timer.at <= now) { timeouts.delete(id); timer.fn(); }
      }
    },
    unmount() { cleanup.forEach((fn) => fn?.()); },
  };
}

test('cached pans, zooms and resizes do not replace a loaded Google map after 20 seconds', async () => {
  const env = await mountMap();
  env.map.emit('tilesloaded');
  assert.equal(env.states[1].value, true);
  for (let i = 0; i < 5; i++) {
    env.map.emit('bounds_changed');
    env.map.emit('idle');
    env.advance(25000);
    assert.equal(env.states[1].value, true, 'keep the verified map visible without another tile event');
    assert.equal(env.states[2].value, null, 'panning does not trigger a false failure');
  }
  assert.equal(env.viewportCount, 5, 'map movement still updates regional data requests');
  env.unmount();
});

test('a genuinely stalled first tile load times out and can recover when tiles arrive', async () => {
  const env = await mountMap();
  env.map.emit('bounds_changed');
  env.advance(20000);
  assert.match(env.states[2].value, /tiles have not arrived/);
  env.map.emit('tilesloaded');
  assert.equal(env.states[1].value, true);
  assert.equal(env.states[2].value, null);
  env.unmount();
});

test('authorization failures are not hidden by subsequent tile events', async () => {
  const env = await mountMap();
  env.map.emit('tilesloaded');
  env.window.gm_authFailure();
  env.map.emit('tilesloaded');
  assert.match(env.states[2].value, /rejected map authorization/);
  env.unmount();
});

test('unmount clears the initial watchdog and all map listeners', async () => {
  const env = await mountMap();
  env.unmount();
  env.advance(30000);
  assert.equal(env.states[2].value, null);
  assert.equal(env.map.handlers.size, 0);
});
