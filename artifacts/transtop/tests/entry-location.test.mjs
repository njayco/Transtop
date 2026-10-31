import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const src = ts.transpileModule(readFileSync(new URL('../src/lib/entry-location.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = await import('data:text/javascript,' + encodeURIComponent(src));

test('parses valid and rejects bad themes', () => {
  const l = m.parseLocation({ country: 'US', city: 'Chicago', region: 'Illinois', theme: 'chicago', operator: 'CTA', accuracy: 'approximate', matchedBy: 'city', ip: '1.2.3.4' });
  assert.equal(l.theme, 'chicago'); assert.equal(l.city, 'Chicago'); assert.equal(l.ip, undefined);
  assert.equal(m.parseLocation({ theme: 'connecticut' }).theme, 'connecticut');
  for (const t of ['__proto__', 'constructor', 'mars', 'london', 5]) assert.equal(m.parseLocation({ theme: t }).theme, 'default');
  assert.deepEqual(m.parseLocation(null), m.UNKNOWN_LOCATION);
  assert.equal(m.isDesign('london'), true); assert.equal(m.isDesign('toString'), false);
});

test('lookup uses location endpoint, no-store and falls back', async () => {
  let url, opts;
  const r = await m.fetchEntryLocation('/b', async (u, o) => { url = u; opts = o; return { ok: true, json: async () => ({ theme: 'miami', city: 'Miami' }) }; });
  assert.equal(url, '/b/api/entry/location'); assert.equal(opts.cache, 'no-store'); assert.equal(r.theme, 'miami');
  assert.equal((await m.fetchEntryLocation('', async () => { throw new Error('x'); })).theme, 'default');
  assert.equal((await m.fetchEntryLocation('', async () => ({ ok: false }))).theme, 'default');
  assert.equal((await m.fetchEntryLocation('', () => new Promise(() => {}), 20)).theme, 'default');
  const ac = new AbortController(); const pr = m.fetchEntryLocation('', () => new Promise(() => {}), 5000, ac.signal); ac.abort();
  assert.equal((await pr).city, null);
});
