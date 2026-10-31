import { test, expect } from '@playwright/test';

// These use the managed preview (and its real catalog) rather than the isolated
// fixture server in playwright.config.ts. Run with public-content.config.ts.
test('public information is readable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  try {
    const response = await page.goto('/search');
    expect(response?.status()).toBe(200);
    await expect(page.locator('#public-content h1')).toHaveText('Search transit stops and routes');
    const stop = page.locator('#public-content a[href*="/stops/"]').first();
    await expect(stop).toBeVisible();
    const name = await stop.textContent();
    await stop.click();
    await expect(page.locator('#public-content h1')).toHaveText(name!);
    expect((await page.request.get('/trains/not-a-real-train')).status()).toBe(404);
  } finally { await context.close(); }
});

test('fresh sessions can read public content without swiping, then enter the existing app', async ({ page }) => {
  await page.route('**/api/entry/country', route => route.fulfill({ json: { country: 'US' } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/search');
  await expect(page.getByRole('slider')).toBeVisible();
  await expect(page.locator('#public-content')).toBeVisible();
  await page.locator('#public-info-link').click();
  await expect(page.locator('#public-content h1')).toBeInViewport();
  expect(await page.evaluate(() => sessionStorage.getItem('transtop.entry.v2'))).toBeNull();
  const firstStop = page.locator('#public-content a[href*="/stops/"]').first();
  const name = await firstStop.textContent();
  await firstStop.click();
  await expect(page.locator('#public-content h1')).toHaveText(name!);
  const slider = page.getByRole('slider');
  await slider.focus();
  for (let i = 0; i < 10; i++) await slider.press('ArrowLeft');
  await expect(slider).toHaveCount(0);
  await expect(page.locator('#public-content')).toBeHidden();
  await expect(page.locator('#public-info-link')).toBeHidden();
  await expect(page.getByTestId('text-stop-name')).toHaveText(name!);
});
