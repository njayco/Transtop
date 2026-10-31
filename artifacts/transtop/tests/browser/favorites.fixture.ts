import { test as base, expect, type Page } from '@playwright/test';

export const PREFS_KEY = 'transtop.prefs.v1';
type Identity = { id: string; kind: 'stop' | 'route' };
type Status = 'available' | 'unavailable' | 'unknown';
type Source = {
  calls: Identity[][];
  failure?: 'http' | 'network';
  status: Record<string, Status>;
  names: Record<string, string>;
};

export const test = base.extend<{ source: Source }>({
  source: [async ({ context, baseURL }, use) => {
    const source: Source = { calls: [], status: {}, names: {} };
    const unexpected: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      // Fail closed: no maps, analytics, live API or third-party provider access.
      if (url.origin !== baseURL) return route.abort('blockedbyclient');
      if (url.pathname === '/api/transit/favorites/availability' && request.method() === 'POST') {
        const { items } = request.postDataJSON() as { items: Identity[] };
        source.calls.push(items);
        if (source.failure === 'network') return route.abort('failed');
        if (source.failure === 'http') {
          return route.fulfill({ status: 503, json: { error: 'Stubbed provider outage' } });
        }
        return route.fulfill({ json: items.map(item => ({
          ...item,
          status: source.status[item.id] ?? 'available',
          currentName: source.names[item.id],
          message: 'Deterministic source response.',
          checkedAt: '2026-10-31T12:00:00Z',
        })) });
      }
      if (url.pathname === '/api/entry/country' && request.method() === 'GET') {
        return route.fulfill({ json: { country: null } });
      }
      if (url.pathname.startsWith('/api/')) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await use(source);
    expect(unexpected, 'Every API used by this suite must be explicitly stubbed').toEqual([]);
  }, { auto: true }],
});

export { expect };

export function stop(id: string) {
  return { id, name: `Saved stop ${id}`, type: 'bus' as const, agency: 'Saved carrier', routes: [], savedAt: '2026-10-30T12:00:00Z' };
}

export function route(id: string) {
  return { id, name: `Saved route ${id}`, type: 'bus' as const, agency: 'Saved carrier', color: '#123456', savedAt: '2026-10-30T12:00:00Z' };
}

export function preferences(favStops = [stop('tfl:stop:original')], favRoutes = [route('tfl:route:original')]) {
  return { mode: 'live', reduceMotion: true, largeText: false, favStops, favRoutes };
}

export async function openFavorites(page: Page, prefs: ReturnType<typeof preferences>) {
  // Seed once, not in an init script: a reload must read what the app actually saved.
  await page.goto('/favorites');
  await page.evaluate(({ key, prefs }) => {
    localStorage.setItem(key, JSON.stringify(prefs));
    sessionStorage.setItem('transtop.entry.v2', '1');
    localStorage.setItem('favorites-regression-unrelated', 'keep me');
  }, { key: PREFS_KEY, prefs });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Favorites', exact: true })).toBeVisible();
}

export function row(page: Page, kind: Identity['kind'], id: string) {
  // Unavailable rows intentionally have no link, so anchor on the remove control.
  return page.getByTestId(`button-remove-${kind}-${id}`).locator('..');
}

export async function expectSaved(page: Page, prefs: ReturnType<typeof preferences>) {
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PREFS_KEY)).toEqual(prefs);
  expect(await page.evaluate(() => localStorage.getItem('favorites-regression-unrelated'))).toBe('keep me');
}
