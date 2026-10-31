import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { publicPage, renderDocument } from '../server/public-content.mjs';
import { publicContentMiddleware } from '../server/middleware.mjs';

const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const stop = { id: 'agency:42/A', name: 'Central & Main', agency: 'Public Transit', type: 'rail',
  routes: [{ id: 'agency:R', name: 'R', longName: 'Central line' }] };
const route = { route: { ...stop.routes[0], agency: stop.agency, type: 'rail' },
  stops: [stop], directions: ['Northbound', 'Southbound'] };
const train = { trainNumber: '42', routeName: 'Central line', destination: 'Central', serviceDate: '20261031',
  routeId: 'agency:R', source: 'Published schedule', message: 'Not a live prediction', matched: false,
  calls: [{ code: 'CEN', name: 'Central', scheduledDeparture: '2026-10-31T15:00:00Z' }] };
const catalog = { stops: [stop], routes: [route.route] };

test('home and search have server-rendered headings, catalog links and a working GET form', async () => {
  for (const path of ['/', '/search']) {
    const page = await publicPage(path, { base: '/transit', query: 'Central', getData: async url => {
      assert.match(url, /mode=live/);
      if (path === '/search') assert.match(url, /q=Central/);
      return catalog;
    } });
    const html = renderDocument(template, page);
    assert.equal(page.status, 200);
    assert.match(html, /<h1>/);
    assert.match(html, /href="\/transit\/stops\/agency%3A42%2FA"/);
    assert.match(html, /href="\/transit\/routes\/agency%3AR"/);
    assert.match(html, /action="\/transit\/search" method="get"/);
    assert.doesNotMatch(html, /<!--public-content-->/);
  }
});

test('all detail pages contain the requested identity and crawlable related content', async () => {
  for (const [kind, data, name] of [['stops', stop, 'Central &amp; Main'], ['routes', route, 'Central line'], ['trains', train, 'Train 42']]) {
    const page = await publicPage(`/${kind}/agency%3AR`, { getData: async url => {
      assert.ok(url.startsWith(`/${kind}/agency%3AR`));
      if (kind !== 'trains') assert.match(url, /mode=live/);
      return data;
    } });
    assert.equal(page.status, 200);
    const html = renderDocument(template, page);
    assert.ok(html.includes(name));
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.equal((html.match(/name="description"/g) || []).length, 1);
    assert.ok(html.includes('property="og:title"'));
    assert.ok(html.includes('name="twitter:title"'));
    assert.match(page.html, /href="\/(stops|routes|search)/);
  }
});

test('provider strings, markup, URLs and replacement tokens cannot inject document HTML', async () => {
  const malicious = { ...stop, name: '</title><script>bad()</script>$&',
    idfm: { attribution: '<img onerror="bad()">', url: 'javascript:bad()', license: 'License' } };
  const page = await publicPage('/stops/x', { getData: async () => malicious });
  const html = renderDocument(template, page);
  assert.doesNotMatch(html, /<script>bad|<img onerror|href="javascript:/);
  assert.match(html, /&lt;script&gt;bad/);
  assert.match(html, /\$&amp;/);
});

test('missing entities produce not-found documents, not invented transit data', async () => {
  for (const kind of ['stops', 'routes', 'trains']) {
    const page = await publicPage(`/${kind}/missing`, { getData: async () => null });
    assert.equal(page.status, 404);
    assert.match(renderDocument(template, page), /name="robots" content="noindex"/);
    assert.match(page.html, /<h1>Transit page not found/);
  }
});

test('malformed and oversized IDs never call providers', async () => {
  for (const id of ['%ZZ', 'x'.repeat(181)]) {
    const page = await publicPage(`/stops/${id}`, { getData: () => { throw Error('must not fetch'); } });
    assert.equal(page.status, 404);
  }
});

test('HTTP serves identical useful HTML for riders and crawlers, true 404, HEAD, and retryable outages', async t => {
  const handler = publicContentMiddleware({
    template: async () => template,
    fetchData: async url => {
      if (url.includes('/missing')) return new Response('{}', { status: 404 });
      if (url.includes('/outage')) return new Response('{}', { status: 503 });
      return Response.json(url.includes('/catalog?') ? catalog : stop);
    },
  });
  const server = http.createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rider = await fetch(`${origin}/stops/agency%3A42`);
  const crawler = await fetch(`${origin}/stops/agency%3A42`, { headers: { 'User-Agent': 'Googlebot' } });
  assert.equal(rider.status, 200);
  assert.equal(await rider.text(), await crawler.text());
  const head = await fetch(`${origin}/stops/agency%3A42`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const missing = await fetch(`${origin}/trains/missing`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Transit page not found/);
  const outage = await fetch(`${origin}/routes/outage`);
  assert.equal(outage.status, 503);
  assert.equal(outage.headers.get('retry-after'), '60');
  assert.match(await outage.text(), /temporarily unavailable/);
});

test('entry artwork remains separate from public information and only explicit entry hides it', async () => {
  const intro = await readFile(new URL('../src/components/intro.tsx', import.meta.url), 'utf8');
  assert.match(template, /href="#public-content"/);
  assert.ok(template.indexOf('id="root"') < template.indexOf('<!--public-content-->'));
  assert.match(intro, /element.hidden = entered \|\| !hasPublicContent/);
  assert.match(intro, /sessionStorage.setItem\(KEY, '1'\)/);
});
