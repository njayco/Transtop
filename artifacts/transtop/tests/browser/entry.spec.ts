import { test, expect, type Page } from '@playwright/test';

const cases = [
  { country: 'US', variant: 'us', card: 'MetroCard', badges: 5 },
  { country: 'GB', variant: 'london', card: 'Oyster', badges: 5 },
  { country: 'FR', variant: 'paris', card: 'Navigo', badges: 5 },
  { country: 'JP', variant: 'tokyo', card: 'Suica', badges: 6 },
];

async function fixture(page: Page, country: unknown, delay = 0) {
  let countryCalls = 0, transitCalls = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/entry/country') {
      countryCalls++;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await route.fulfill({ json: { country } }).catch(() => {});
      return;
    }
    transitCalls++;
    await route.fulfill({ json: path === '/api/healthz' ? { status: 'ok' } : [] });
  });
  await page.addInitScript(() => {
    localStorage.setItem('transtop.prefs.v1', JSON.stringify({ mode: 'live', reduceMotion: true, largeText: false, favStops: [], favRoutes: [] }));
  });
  return { countries: () => countryCalls, transit: () => transitCalls };
}
async function completeKeyboard(page: Page) {
  const slider = page.getByRole('slider');
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('screen-entry')).toHaveCount(0);
}
async function slide(page: Page, fraction: number) {
  const slider = page.getByRole('slider'), track = page.getByTestId('track-swipe');
  const box = (await slider.boundingBox())!, lane = (await track.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - (lane.width - box.width - 16) * fraction, y, { steps: 12 });
}

for (const c of cases) {
  test(`${c.variant}: country selection, keyboard, deep link, session and replay`, async ({ page }) => {
    const calls = await fixture(page, c.country);
    await page.goto('/settings?entry-test=1#keep-destination');
    const screen = page.getByTestId('screen-entry'), slider = page.getByRole('slider');
    await expect(screen).toHaveAttribute('data-entry-variant', c.variant);
    await expect(slider).toHaveAccessibleName(new RegExp(c.card, 'i'));
    expect(calls.transit()).toBe(0);
    await expect(page.getByRole('button', { name: /skip/i })).toHaveCount(0);
    await expect(page.getByTestId('text-unaffiliated')).toContainText(/independent|indépendant|独立/i);
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '10');
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await completeKeyboard(page);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe('/settings?entry-test=1#keep-destination');
    expect(await page.evaluate(() => sessionStorage.getItem('transtop.entry.v2'))).toBe('1');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect(calls.countries()).toBe(1);
    await page.getByTestId('button-play-intro').click();
    await expect(screen).toHaveAttribute('data-entry-variant', c.variant);
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    expect(calls.countries()).toBe(1);
    await completeKeyboard(page);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });

  test(`${c.variant}: pointer partial/cancel/resize and leftward completion`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page, c.country);
    await page.goto('/settings');
    const slider = page.getByRole('slider');
    await expect(slider).toBeVisible();
    await slide(page, 0.4);
    const partial = Number(await slider.getAttribute('aria-valuenow'));
    expect(partial).toBeGreaterThan(20);
    expect(partial).toBeLessThan(70);
    await page.mouse.up();
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await slide(page, 0.4);
    await slider.dispatchEvent('pointercancel', { pointerId: 1, isPrimary: true });
    await page.mouse.up();
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await slide(page, 0.98);
    await page.mouse.up();
    await expect(page.getByTestId('screen-entry')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });

  for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    test(`${c.variant}: responsive reduced-motion screenshot ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fixture(page, c.country);
      await page.goto('/settings');
      await expect(page.getByTestId('screen-entry')).toHaveAttribute('data-entry-variant', c.variant);
      await page.getByRole('slider').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bounds = (await page.getByRole('slider').boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      // Essential content stays in the document and can scroll on short screens.
      await expect(page.getByRole('heading', { name: 'Transtop', exact: true })).toBeAttached();
      const animated = await page.locator('[data-testid="screen-entry"] *').evaluateAll(nodes =>
        nodes.filter(node => getComputedStyle(node).animationName !== 'none').length);
      expect(animated).toBe(0);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`${c.variant}-${viewport.width}.png`), fullPage: true });
      // App larger text setting can be enabled before entry without clipping the slider.
      await page.evaluate(() => document.documentElement.classList.add('large-text'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

for (const country of [null, 'DE', 'UK', 'constructor', '__proto__']) {
  test(`unsupported country ${country} falls back without auto-entry`, async ({ page }) => {
    await fixture(page, country);
    await page.goto('/settings');
    await expect(page.getByTestId('screen-entry')).toHaveAttribute('data-entry-variant', 'us');
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '0');
    expect(await page.evaluate(() => sessionStorage.getItem('transtop.entry.v2'))).toBeNull();
  });
}

test('timeout fallback is stable through a gesture, late response and entry', async ({ page }) => {
  const calls = await fixture(page, 'JP', 1800);
  await page.goto('/settings');
  await expect(page.getByTestId('screen-entry')).toHaveAttribute('data-entry-variant', 'us', { timeout: 2500 });
  expect(calls.transit()).toBe(0);
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('screen-entry')).toHaveAttribute('data-entry-variant', 'us');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '10');
  await page.keyboard.press('Home');
  await completeKeyboard(page);
  await page.getByTestId('button-play-intro').click();
  await expect(page.getByTestId('screen-entry')).toHaveAttribute('data-entry-variant', 'us');
  expect(calls.countries()).toBe(1);
});

test('network failure and invalid JSON fall back promptly', async ({ page }) => {
  await page.route('**/api/entry/country', route => route.abort());
  await page.goto('/settings');
  await expect(page.getByTestId('screen-entry')).toHaveAttribute('data-entry-variant', 'us');
  await page.evaluate(() => sessionStorage.clear());
  await page.unroute('**/api/entry/country');
  await page.route('**/api/entry/country', route => route.fulfill({ body: '{invalid', contentType: 'application/json' }));
  await page.reload();
  await expect(page.getByTestId('screen-entry')).toHaveAttribute('data-entry-variant', 'us');
});

test('touch pointer completion and single entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, 'JP');
  await page.goto('/settings');
  const slider = page.getByRole('slider');
  await expect(slider).toBeVisible();
  const box = (await slider.boundingBox())!, track = (await page.getByTestId('track-swipe').boundingBox())!;
  const start = box.x + box.width / 2, end = start - (track.width - box.width - 16) * 0.98;
  // Browser-generated touch events, not a synthetic slider value change.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y: box.y + box.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end, y: box.y + box.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('screen-entry')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('transtop.entry.v2'))).toBe('1');
  await page.waitForTimeout(750);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
