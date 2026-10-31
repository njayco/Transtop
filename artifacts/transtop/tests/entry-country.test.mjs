import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const src = ts.transpileModule(readFileSync(new URL('../src/lib/entry-country.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = await import('data:text/javascript,' + encodeURIComponent(src));
test('maps countries', () => {
  assert.equal(m.variantForCountry('GB'), 'london'); assert.equal(m.variantForCountry('FR'), 'paris');
  assert.equal(m.variantForCountry('JP'), 'tokyo'); assert.equal(m.variantForCountry('US'), 'us');
  assert.equal(m.variantForCountry(null), 'us'); assert.equal(m.variantForCountry('DE'), 'us');
  for (const k of ['constructor','__proto__','toString','hasOwnProperty']) assert.equal(m.variantForCountry(k), 'us');
});
test('fetch uses no-store and falls back', async () => {
  let opts; assert.equal(await m.fetchEntryVariant('', async (_u, o) => { opts = o; return { ok: true, json: async () => ({ country: 'JP' }) }; }), 'tokyo');
  assert.equal(opts.cache, 'no-store');
  assert.equal(await m.fetchEntryVariant('', async () => { throw new Error('x'); }), 'us');
  assert.equal(await m.fetchEntryVariant('', (_u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('abort')))), 20), 'us');
  assert.equal(await m.fetchEntryVariant('', () => new Promise(() => {}), 20), 'us');
  assert.equal(await m.fetchEntryVariant('', async () => ({ ok: true, json: () => new Promise(() => {}) }), 20), 'us');
  const ac = new AbortController(); const pr = m.fetchEntryVariant('', () => new Promise(() => {}), 5000, ac.signal); ac.abort();
  assert.equal(await pr, 'us');
});
