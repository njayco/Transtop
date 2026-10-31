import { test, expect } from '@playwright/test';

const updatedAt = new Date().toISOString();
const bus = { id: 'test:X28', name: 'X28', type: 'bus', agency: 'Test agency', agencyId: 'test', serviceClass: 'express', color: '#1267aa' };
const title = 'X28 &#x200c;and &#x200c;X38 &#x200c;stop changes';
const delay = {
  id: 'delay', title, severity: 'delay', routeIds: [bus.id], source: 'Test agency',
  description: `<p>${title}</p><p>Use 5th Ave &amp; 42 St.<br>Allow extra time.</p><ul><li>Walk north</li><li>Board here</li></ul><p><a href="https://agency.test/info" onclick="alert(1)">Official details</a> <a href="javascript:alert(1)">Unsafe link</a></p><script>window.alertInjected=true</script><img src="https://evil.test/tracker"><p>${'LongText'.repeat(90)}</p>`,
};
const notice = { ...delay, id: 'notice', title: 'Routine notice', severity: 'notice', description: 'Routine details remain available.' };
const stop = {
  id: 'test:stop', name: 'Test stop', lat: 40.75, lon: -73.99, type: 'bus', agency: 'Test agency',
  routes: [bus], alerts: [delay, delay, notice, { ...delay, id: 'unrelated', title: 'Other city delay', routeIds: ['other:route'] }],
  arrivals: [], distance: 100, walkingMinutes: 2, updatedAt,
};

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`alerts: Nearby and contextual details at ${viewport.width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize(viewport);
    const unexpected: string[] = [], injectedRequests: string[] = [];
    let globalRequests = 0;
    await context.addInitScript(() => {
      sessionStorage.setItem('transtop.entry.v2', '1');
      localStorage.setItem('transtop.prefs.v1', JSON.stringify({ mode: 'live', reduceMotion: true, largeText: false, favStops: [], favRoutes: [] }));
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'evil.test') injectedRequests.push(url.href);
      if (url.origin !== baseURL) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = decodeURIComponent(url.pathname);
      let json: unknown;
      switch (path) {
        case '/api/healthz': json = { status: 'ok' }; break;
        case '/api/transit/sources': json = [{ id: 'test', agency: 'Test agency', type: 'bus' }]; break;
        case '/api/transit/map-vehicles': json = []; break;
        case '/api/transit/network': json = { stops: [], lines: [], missingGeometry: [] }; break;
        case '/api/transit/intercity/departures': json = { providers: [], departures: [], updatedAt, radiusMeters: 3000 }; break;
        case '/api/transit/alerts': globalRequests++; json = [{ ...delay, id: 'global' }]; break;
        case '/api/transit/stops': {
          const type = url.searchParams.get('type'), q = url.searchParams.get('q');
          const classFilter = url.searchParams.get('serviceClass');
          json = { stops: type === 'rail' || classFilter === 'local' || q === 'Empty place' ? []
            : q === 'Notice place' ? [{ ...stop, alerts: [notice] }] : [stop],
          updatedAt, centerLat: stop.lat, centerLon: stop.lon };
          break;
        }
        case '/api/transit/stops/test:stop': json = stop; break;
        case '/api/transit/routes/test:X28': json = { route: bus, stops: [stop], alerts: [delay, notice], shape: [], vehicles: [], directions: [] }; break;
        case '/api/transit/timetable': json = { departures: [], serviceDate: '2026-10-31', timezone: 'America/New_York', providers: [], message: 'Test timetable' }; break;
        default: unexpected.push(path); return route.abort();
      }
      return route.fulfill({ json });
    });

    await page.goto('/');
    const section = () => page.getByTestId('nearby-service-alerts').filter({ visible: true });
    await expect(section()).toBeVisible();
    await expect(section()).not.toHaveAttribute('open', '');
    await expect(section().locator('summary').first()).toHaveText('1 service alert on routes at these stops');
    await expect(page.getByText('Other city delay')).toHaveCount(0);
    await expect(page.getByText('Routine notice')).toHaveCount(0);
    const summary = section().locator('summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(section()).toHaveAttribute('open', '');
    await expect(section().getByText('Route-wide alerts; they may not affect every stop shown.')).toBeVisible();
    await section().locator('summary').nth(1).focus();
    await page.keyboard.press('Space');
    await expect(section().getByText('Use 5th Ave & 42 St.')).toBeVisible();
    await expect(section().getByRole('link', { name: /Official details/ })).toHaveAttribute('href', 'https://agency.test/info');
    await expect(section().getByRole('link', { name: 'Unsafe link', exact: true })).toHaveCount(0);
    await expect(section()).not.toContainText('&#x200c;');
    await expect(section()).not.toContainText('<p>');
    await expect(section().locator('script,img,iframe,style')).toHaveCount(0);
    await expect(section().getByText('Source: Test agency')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByTestId('filter-bus').click();
    await expect(section()).not.toHaveAttribute('open', '');
    await section().locator('summary').first().click();
    await page.getByTestId('select-nearby-class').selectOption('local');
    await expect(section()).toHaveCount(0);
    await page.getByTestId('select-nearby-class').selectOption('all');
    await expect(section()).not.toHaveAttribute('open', '');
    await page.getByTestId('filter-rail').click();
    await expect(section()).toHaveCount(0);
    await page.getByTestId('filter-bus').click();
    await expect(section()).not.toHaveAttribute('open', '');
    await section().locator('summary').first().click();
    await page.getByTestId('input-nearby-search').fill('Notice place');
    await page.getByTestId('button-nearby-go').click();
    await expect(section()).toHaveCount(0);
    await page.getByTestId('input-nearby-search').fill('Next place');
    await page.getByTestId('button-nearby-go').click();
    await expect(section()).not.toHaveAttribute('open', '');
    await page.getByTestId('input-nearby-search').fill('Empty place');
    await page.getByTestId('button-nearby-go').click();
    await expect(section()).toHaveCount(0);

    for (const path of ['/stops/test%3Astop', '/routes/test%3AX28']) {
      await page.goto(path);
      const routine = page.getByTestId('alert-notice');
      await expect(routine.getByText('Routine notice')).toBeVisible();
      await expect(routine.locator('details')).not.toHaveAttribute('open', '');
      await routine.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(routine.getByText('Routine details remain available.')).toBeVisible();
      const contextual = page.getByTestId('alert-delay').first();
      await expect(contextual.locator('details')).not.toHaveAttribute('open', '');
      await contextual.locator('summary').click();
      await expect(contextual.getByRole('link', { name: /Official details/ })).toBeVisible();
      await expect(contextual.locator('p').filter({ hasText: /^X28 and X38 stop changes$/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(await page.evaluate(() => (window as unknown as { alertInjected?: boolean }).alertInjected)).toBeUndefined();
    expect(injectedRequests).toEqual([]);
    expect(globalRequests).toBe(0);
    expect(unexpected).toEqual([]);
  });
}
