import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code=ts.transpile(await readFile(new URL('../src/lib/provider-name.ts',import.meta.url),'utf8'),{module:ts.ModuleKind.CommonJS});
const context={exports:{}};vm.runInNewContext(code,context);
test('Paris provider filters stay feed-labelled across different carrier results',()=>{
  for(const carrier of ['RATP','SNCF','Transdev Ourcq','Île-de-France Mobilités'])
    assert.equal(context.exports.providerName('idfm',carrier),'Île-de-France Mobilités');
  assert.equal(context.exports.providerName('mta-bus','MTA'),'MTA');
  assert.equal(context.exports.providerName('transitland:operator','Transdev Ourcq'),'Transdev Ourcq');
});
