import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pageMetadata, detailPath, HOME_DESCRIPTION } from '../src/lib/page-metadata.ts';
import { renderMetadata } from '../server/metadata.mjs';
import { publicPage, renderDocument } from '../server/public-content.mjs';

const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const png = await readFile(new URL('../public/social-card.png', import.meta.url));
const tag = (html, key) => html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1];

test('homepage has concise search copy, verified absolute identity and a real large share image', () => {
  const description = tag(template, 'description');
  assert.equal(description, HOME_DESCRIPTION);
  assert.ok(description.length >= 150 && description.length <= 160, description.length);
  assert.match(description, /selected transit networks/);
  assert.match(description, /vary by provider/);
  assert.match(template, /rel="canonical" href="https:\/\/transtop.app\/"/);
  assert.equal(tag(template, 'og:url'), 'https://transtop.app/');
  assert.equal(tag(template, 'og:site_name'), 'Transtop');
  assert.equal(tag(template, 'twitter:card'), 'summary_large_image');
  for (const key of ['og:image', 'twitter:image']) assert.equal(tag(template, key), 'https://transtop.app/social-card.png');
  for (const key of ['og:image:alt', 'twitter:image:alt']) assert.match(tag(template, key), /Transtop/);
  assert.notEqual(tag(template, 'og:description'), description);
  assert.ok(tag(template, 'og:description').length <= 160);
  assert.ok(tag(template, 'twitter:description').length <= 160);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('stop, route and dated train identities use the real API response shapes', () => {
  const stop = pageMetadata('/stops/mta%3A123?lat=1&lon=2', { id: 'mta:123', name: 'Times Sq', agency: 'MTA' });
  assert.equal(stop.url, 'https://transtop.app/stops/mta%3A123');
  assert.match(stop.title, /Times Sq · MTA/);
  assert.match(stop.description, /departures at Times Sq/);
  const route = pageMetadata('/routes/idfm%3AC0123/', { route: { name: 'RER A', agency: 'Île-de-France Mobilités' } });
  assert.equal(route.url, 'https://transtop.app/routes/idfm%3AC0123');
  assert.match(route.title, /Route RER A/);
  assert.match(route.description, /route RER A/);
  const train = pageMetadata('/trains/amtrak%3A42%3A2026-10-31', { trainNumber: '42', routeName: 'Pennsylvanian', serviceDate: '2026-10-31' });
  assert.match(train.title, /Train 42 · Pennsylvanian · 2026-10-31/);
  assert.match(train.description, /Scheduled times are not live predictions/);
  assert.match(pageMetadata('/routes/tfl%3Acentral').title, /tfl:central/);
  assert.notEqual(pageMetadata('/search').title, pageMetadata('/').title);
  assert.equal(detailPath('/stops/%ZZ'), null);
  assert.equal(detailPath('/stops/%00'), null);
});

test('initial HTML replaces every page identity and escapes provider text without duplicate tags', () => {
  const metadata = pageMetadata('/routes/mta%3Atest', { route: { name: 'A "><script>alert(1)</script> & $&', agency: 'MTA' } });
  const html = renderMetadata(template, metadata);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /\$&amp;/);
  for (const key of ['og:title', 'twitter:title']) assert.match(tag(html, key), /&quot;&gt;&lt;script/);
  for (const key of ['description', 'og:description', 'twitter:description']) assert.match(tag(html, key), /Explore route A/);
  assert.equal(tag(html, 'og:url'), metadata.url);
  assert.match(html, /rel="canonical" href="https:\/\/transtop.app\/routes\/mta%3Atest"/);
  for (const key of ['og:title', 'og:description', 'og:url', 'twitter:title', 'twitter:description']) {
    assert.equal(html.match(new RegExp(`(?:name|property)="${key}"`, 'g')).length, 1);
  }
  assert.equal(tag(html, 'og:image'), tag(template, 'og:image'));
});

test('public content and shared metadata render together in the same initial HTML response', async () => {
  const page = await publicPage('/routes/mta%3AA', { getData: async (path) => {
    assert.equal(path, '/routes/mta%3AA?mode=live');
    return { route: { id: 'mta:A', name: 'A', agency: 'MTA', type: 'subway' }, stops: [], directions: [] };
  } });
  const html = renderDocument(template, page);
  assert.match(html, /<title>Route A · MTA — Transtop<\/title>/);
  assert.equal(tag(html, 'og:url'), 'https://transtop.app/routes/mta%3AA');
  assert.match(html, /rel="canonical" href="https:\/\/transtop.app\/routes\/mta%3AA"/);
  assert.equal(tag(html, 'twitter:card'), 'summary_large_image');
  assert.match(html, /<h1>A<\/h1>/);
  assert.equal(tag(html, 'og:image'), 'https://transtop.app/social-card.png');
  const missing = await publicPage('/routes/missing', { getData: async () => null });
  assert.equal(missing.status, 404);
  assert.match(renderDocument(template, missing), /name="robots" content="noindex"/);
});
