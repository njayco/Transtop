import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

async function load(file, stubs) {
  const context = vm.createContext({});
  context.React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = new vm.SourceTextModule(outputText, { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(stubs), function () {
    Object.entries(stubs).forEach(([key, value]) => this.setExport(key, value));
  }, { context }));
  await module.evaluate();
  return module.namespace;
}
const nodes = tree => {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.children)];
};

test('unavailable links are disabled, outages stay uncertain and names never change saved data', async () => {
  const noop = () => null;
  const { FavoriteStatus, FavoriteLink } = await load('../src/components/favorite-status.tsx', { Link: noop });
  const result = { id: 's:old', kind: 'stop', status: 'unavailable', message: 'Not in source', checkedAt: '2026-10-31T12:00:00Z' };
  assert.match(JSON.stringify(FavoriteStatus({ result, online: true })), /Unavailable in this source/);
  assert.match(JSON.stringify(FavoriteStatus({ result, online: false })), /not checked while offline/);
  assert.doesNotMatch(JSON.stringify(FavoriteStatus({ result, online: false })), /Unavailable in this source/);
  assert.match(JSON.stringify(FavoriteStatus({ result: { ...result, status: 'unknown' }, online: true })), /could not be verified/);
  assert.match(JSON.stringify(FavoriteStatus({ result: { ...result, status: 'available', currentName: 'New name' }, savedName: 'Old name', online: true })), /Now listed as New name/);
  assert.equal(FavoriteLink({ unavailable: true, href: '/old', children: 'old' }).type, 'div');
  assert.equal(FavoriteLink({ unavailable: false, href: '/old', children: 'old' }).type, noop);
});

test('checks paginate saved identities, never rewrite them, and discard failed refresh results', async () => {
  const noop = () => null;
  const record = i => ({ id: `source:${i}`, name: `Saved ${i}`, type: 'bus', agency: 'Carrier', routes: [] });
  const prefs = { favStops: Array.from({ length: 23 }, (_, i) => record(i)), favRoutes: [], set: () => assert.fail('availability cannot write preferences') };
  const original = JSON.stringify(prefs);
  let page = 0, checked, failed = false;
  const stubs = {
    Link: noop, Heart: noop, X: noop, MobileTop: noop, ModeIcon: noop, RouteBadge: noop, TransitLines: noop,
    FollowedTrains: noop, MODE_NAME: {}, useOnline: () => true, usePrefs: () => prefs, ago: () => 'recently',
    useState: () => [page, value => { page = value; }],
    FavoriteLink: noop, FavoriteStatus: noop,
    useFavoriteAvailability: items => {
      checked = items;
      return { data: items.map(item => ({ ...item, status: 'unavailable' })), isError: failed, isFetching: false };
    },
  };
  const { default: Favorites } = await load('../src/pages/favorites.tsx', stubs);
  let tree = Favorites();
  assert.equal(checked.length, 20);
  assert.equal(nodes(tree).find(n => n.props['data-testid'] === 'link-fav-stop-source:0').props.unavailable, true);
  nodes(tree).find(n => n.type === 'button' && n.children.includes('Next')).props.onClick();
  tree = Favorites();
  assert.equal(checked.length, 3);
  assert.equal(checked[0].id, 'source:20');
  failed = true;
  tree = Favorites();
  assert.equal(nodes(tree).find(n => n.props['data-testid'] === 'link-fav-stop-source:20').props.unavailable, false);
  assert.equal(JSON.stringify(prefs), original);
});
