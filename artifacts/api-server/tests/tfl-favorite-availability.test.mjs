import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('strict saved-stop checks recognize only exact StopPoint 404 responses as missing', async () => {
  class TflError extends Error {
    constructor(status) { super('Source failure'); this.httpStatus = status; }
  }
  let status = 200, lineStatus = 200;
  const calls = [];
  const record = { id: 'tfl:stop:940GZZLUOXC', name: 'Oxford Circus' };
  const noop = () => null;
  const stubs = {
    TflError, health: noop, configured: noop, safeMessage: noop, CREDIT: '', COVERAGE: '', TERMS: '',
    MODES: ['tube'], line: value => value, normalizeStop: () => record,
    rawStop: () => '940GZZLUOXC', rawLine: noop, prediction: noop, notices: noop,
    suppliedShapes: noop, boardingPoints: noop, findStopRecord: value => value, distance: noop,
    request: async (path, _params, _ttl, freshOnly) => {
      calls.push({ path, freshOnly });
      const code = path.startsWith('Line/') ? lineStatus : status;
      if (code !== 200) throw new TflError(code);
      return path.startsWith('Line/') ? [{ id: 'line' }] : { id: '940GZZLUOXC' };
    },
  };
  const context = vm.createContext({});
  const source = await readFile(new URL('../src/transit/tfl/service.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const module = new vm.SourceTextModule(outputText, { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(stubs), function () {
    for (const [key, value] of Object.entries(stubs)) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const stop = () => module.namespace.stop(record.id, true);
  assert.equal((await stop()).name, 'Oxford Circus');
  assert.ok(calls.every(call => call.freshOnly === true), 'both metadata dependencies must reject stale fallback');
  status = 404;
  assert.equal(await stop(), undefined, 'exact missing boarding point is unavailable');
  for (const code of [401, 403, 429, 500]) {
    status = code;
    await assert.rejects(stop(), error => error.httpStatus === code, 'access or outage is not missing');
  }
  status = 200; lineStatus = 404;
  await assert.rejects(stop(), error => error.httpStatus === 404, 'line catalog failure is not missing boarding point');
});
