import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

async function load(file) {
  const source = await readFile(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const mod = new vm.SourceTextModule(outputText, { context: vm.createContext({ URL }) });
  await mod.link(() => { throw Error('Unexpected runtime dependency'); });
  await mod.evaluate();
  return mod.namespace;
}
const { alertBlocks, blockText, decodeAlertText, formatAlertContent, safeAlertUrl } = await load('alert-content');
const { relevantAlerts } = await load('relevant-alerts');
const texts = blocks => Array.from(blocks, blockText);
const alert = (id, severity, routeIds) => ({ id, severity, routeIds, source: 'Agency', title: id, description: '' });
const route = (id, type = 'bus', serviceClass = 'local') => ({ id, type, serviceClass, agencyId: id.split(':')[0] });

test('only attached, route-matched delays/disruptions qualify; no global, unrelated or notice alerts', () => {
  const delay = alert('delay', 'delay', ['ny:X28']);
  const major = alert('major', 'disruption', ['ny:X38']);
  const stops = [
    { routes: [route('ny:X28'), route('ny:X38')], alerts: [delay, major, alert('notice', 'notice', ['ny:X28']), alert('global', 'disruption', []), alert('other-city', 'delay', ['other:X28'])] },
    { routes: [route('ny:X28')], alerts: [delay] },
  ];
  assert.deepEqual(Array.from(relevantAlerts(stops), a => a.id), ['delay', 'major']);
  assert.equal(relevantAlerts([]).length, 0);
  assert.equal(relevantAlerts([{ routes: [route('ny:X28')], alerts: [alert('routine', 'notice', ['ny:X28'])] }]).length, 0);
});

test('agency, transport and service class filters exclude routes on mixed-service stops', () => {
  const stops = [{ routes: [route('ny:X28'), route('ny:X38', 'bus', 'express'), route('rail:A', 'rail')],
    alerts: [alert('local', 'delay', ['ny:X28']), alert('express', 'delay', ['ny:X38']), alert('rail', 'disruption', ['rail:A'])] }];
  assert.deepEqual(Array.from(relevantAlerts(stops, { type: 'bus', serviceClass: 'express' }), a => a.id), ['express']);
  assert.deepEqual(Array.from(relevantAlerts(stops, { agency: 'rail' }), a => a.id), ['rail']);
  assert.equal(relevantAlerts(stops, { agency: 'missing' }).length, 0);
});

test('X28/X38 entity regression, headings, paragraphs, breaks and lists are readable', () => {
  // The original uploaded fixture is absent from this fork. Reproduce the exact
  // route/entity fragments identified in the task, without claiming verbatim copy.
  const title = 'X28 &#x200c;and &#x200c;X38 &#x200c;stop changes';
  const result = formatAlertContent(title, `<p>${title}</p><p>Use 5th Ave &amp; 42 St.<br>Allow extra time.</p><ul><li>Walk north</li><li>Board here</li></ul>`);
  assert.equal(result.title, 'X28 and X38 stop changes');
  assert.deepEqual(texts(result.blocks), ['Use 5th Ave & 42 St.', 'Allow extra time.', 'Walk north', 'Board here']);
  assert.equal(result.blocks[2].kind, 'list-item');
  assert.deepEqual(texts(formatAlertContent('Delay', 'Delay. Use another stop.').blocks), ['Use another stop.']);
  assert.equal(formatAlertContent('Delay', '<h3>Delay</h3>').blocks.length, 0);
  assert.equal(decodeAlertText('&amp;#x200c;&nbsp;&#8212; &quot;test&quot; &rsquo;'), ' — "test" ’');
});

test('provider scripts, styles, images, frames, event attributes and unsafe URLs never survive', () => {
  const blocks = alertBlocks(`<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test">hidden</iframe><svg onload="alert(1)">hidden</svg><img src="https://evil.test/track" onerror="alert(1)"><p onclick="bad()">Visible <a href="jav&#x61;script:alert(1)">unsafe</a> <a href="https://agency.test/path?a=1&amp;b=2" onmouseover="bad()">Official</a></p>`);
  assert.deepEqual(texts(blocks), ['Visible unsafe Official']);
  const links = blocks.flatMap(b => b.content).filter(p => p.href);
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://agency.test/path?a=1&b=2');
  for (const raw of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', 'https://user:pass@evil.test', 'https://exa\nmple.test']) assert.equal(safeAlertUrl(raw), undefined);
  assert.equal(safeAlertUrl('http://agency.test'), 'http://agency.test/');
  assert.deepEqual(texts(alertBlocks('&lt;script&gt;bad()&lt;/script&gt;<p>Safe</p>')), ['Safe']);
});

test('plain links work, newlines stay separate and long text has bounded processing', () => {
  const blocks = alertBlocks('First\n\nSecond https://agency.test/info.\n' + 'x'.repeat(100_000));
  assert.equal(blockText(blocks[0]), 'First');
  assert.equal(blockText(blocks[1]), 'Second https://agency.test/info.');
  assert.equal(blocks[1].content.find(p => p.href).href, 'https://agency.test/info');
  assert.ok(blockText(blocks[2]).length < 60_000);
  assert.equal(alertBlocks('<p>Paragraph</p>'.repeat(1000)).length, 250);
});
