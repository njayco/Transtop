import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('retired research favorites stay hidden without deleting saved data or affecting independent carriers', async () => {
  const record = (id) => ({ id, name: id, agency: 'Carrier', type: 'intercity', color: '#123456', routes: [], savedAt: '2026-10-30' });
  const prefs = {
    favStops: [record('ibg:peter-pan:stop:s1'), record('transbridge:stop:s1')],
    favRoutes: [record('ibg:martz:route:r1'), record('martz:trip:r1')],
    set(patch) { Object.assign(prefs, patch); },
  };
  const original = JSON.stringify(prefs);
  const context = vm.createContext({});
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
  context.React = React;
  const noop = () => null;
  const stubs = {
    Link: noop, Heart: noop, X: noop, MobileTop: noop, ModeIcon: noop, RouteBadge: noop,
    TransitLines: noop, FollowedTrains: noop, MODE_NAME: { intercity: 'Intercity' },
    useOnline: () => true, usePrefs: () => prefs, ago: () => 'recently',
    useState: value => [value, () => {}],
    useFavoriteAvailability: () => ({ isFetching: false }),
    FavoriteLink: noop, FavoriteStatus: noop,
  };
  const source = await readFile(new URL('../src/pages/favorites.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = new vm.SourceTextModule(outputText, { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(stubs), function () {
    Object.entries(stubs).forEach(([key, value]) => this.setExport(key, value));
  }, { context }));
  await module.evaluate();
  const tree = module.namespace.default();
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    walk(node.children);
  }
  walk(tree);
  assert.doesNotMatch(JSON.stringify(tree), /ibg:/);
  assert.match(JSON.stringify(tree), /transbridge:stop:s1/);
  assert.match(JSON.stringify(tree), /martz:trip:r1/);
  assert.equal(JSON.stringify(prefs), original);
  nodes.find(n => n.props?.['data-testid'] === 'button-remove-stop-transbridge:stop:s1').props.onClick();
  nodes.find(n => n.props?.['data-testid'] === 'button-remove-route-martz:trip:r1').props.onClick();
  assert.deepEqual(prefs.favStops.map(s => s.id), ['ibg:peter-pan:stop:s1']);
  assert.deepEqual(prefs.favRoutes.map(r => r.id), ['ibg:martz:route:r1']);
  assert.match(JSON.stringify(module.namespace.default()), /Nothing saved yet/);
});
