import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { DateTime } from 'luxon';

test('availability distinguishes exact removals from source failures and stale coverage', async () => {
  let snapshots = [], rows = [], metadata = {}, health = 'healthy', tflRecord;
  const tables = { stops: {}, routes: {}, feedSnapshots: {} };
  let permitted = true;
  const stubs = {
    ...tables, DateTime,
    db: { select: () => ({ from: table => ({ where: async () => table === tables.feedSnapshots ? snapshots : rows }) }) },
    and: () => null, eq: () => null,
    availabilityCache: fn => fn, uncertain: { status: 'unknown', message: 'Not verified' },
    isTransitland: id => id.startsWith('tl:'),
    parseIdentity: id => id.split(':').slice(1),
    identity: (feed, raw) => `tl:${feed}:${raw}`,
    sourceId: raw => raw.feed_version?.feed?.onestop_id,
    feedInfo: async () => { if (!permitted) throw Error('Source unavailable'); },
    request: async () => metadata,
    stop: async (_id, strict) => { assert.equal(strict, true); return tflRecord; },
    lines: async strict => { assert.equal(strict, true); return tflRecord ? [tflRecord] : []; },
    health: () => ({ status: health }), isTfl: id => id.startsWith('tfl:'),
    intercityCatalog: async () => ({ stops: [], routes: [] }),
    isDocumentId: () => false, documentStops: [], documentRoutes: [],
    isRetiredResearchId: () => false,
  };
  const context = vm.createContext({});
  const source = await readFile(new URL('../src/transit/favorite-availability.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const module = new vm.SourceTextModule(outputText, { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(stubs), function () {
    for (const [key, value] of Object.entries(stubs)) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const lookup = (id, kind = 'stop') => module.namespace.lookupFavorite({ id, kind });
  metadata = { stops: [] };
  assert.equal((await lookup('tl:feed:old')).status, 'unavailable');
  metadata = {};
  assert.equal((await lookup('tl:feed:old')).status, 'unknown', 'malformed payload is not a removal');
  metadata = { stops: [{ stop_id: 'sibling', stop_name: 'Same name', feed_version: { feed: { onestop_id: 'feed' } } }] };
  assert.equal((await lookup('tl:feed:old')).status, 'unknown', 'a different boarding point cannot replace the saved one');
  metadata.stops[0].stop_id = 'old';
  assert.equal((await lookup('tl:feed:old')).currentName, 'Same name');
  permitted = false;
  await assert.rejects(lookup('tl:feed:old'), /unavailable/); // cache layer converts thrown failures to unknown
  health = 'stale';
  assert.equal((await lookup('tfl:stop:old')).status, 'unavailable', 'unrelated global health does not invalidate current metadata');
  health = 'healthy';
  assert.equal((await lookup('tfl:route:old', 'route')).status, 'unavailable');
  tflRecord = { id: 'tfl:route:old', name: 'New name' };
  assert.equal((await lookup('tfl:route:old', 'route')).currentName, 'New name');
  assert.equal((await lookup('martz:stop:old')).status, 'unknown', 'withheld documents do not prove removal');
  assert.equal((await lookup('agency:old')).status, 'unknown', 'unimported coverage is not a removal');
  snapshots = [{ id: 'agency:static', data: { serviceStart: '20000101', serviceEnd: '29991231', importedAt: '2026-01-01' } }];
  assert.equal((await lookup('agency:old')).status, 'unavailable');
  rows = [{ data: { name: 'Renamed stop' } }];
  assert.equal((await lookup('agency:old')).currentName, 'Renamed stop');
  snapshots[0].data.serviceEnd = '20000101';
  assert.equal((await lookup('agency:old')).status, 'unknown', 'expired schedules are not permanent removals');
  snapshots[0].data.serviceEnd = '29991231';
  snapshots.push({ id: 'agency:import-error', data: { at: '2026-02-01' } });
  assert.equal((await lookup('agency:old', 'route')).status, 'unknown', 'failed imports must not retire favorites');
});
