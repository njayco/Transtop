import { test, expect, stop, route, preferences, openFavorites, row, expectSaved } from './favorites.fixture';

test('source results and reloads preserve exact saved identities, names and hidden retired records', async ({ page, source }) => {
  const prefs = preferences(
    [stop('tfl:stop:available'), stop('tfl:stop:missing'), stop('tfl:stop:uncertain'), stop('ibg:retired:stop')],
    [route('tfl:route:missing'), route('ibg:retired:route')],
  );
  source.status['tfl:stop:missing'] = 'unavailable';
  source.status['tfl:stop:uncertain'] = 'unknown';
  source.status['tfl:route:missing'] = 'unavailable';
  source.names['tfl:stop:available'] = 'Renamed by source';
  await openFavorites(page, prefs);

  for (let load = 0; load < 2; load++) {
    await expect(row(page, 'stop', 'tfl:stop:available')).toContainText('Now listed as Renamed by source');
    await expect(row(page, 'stop', 'tfl:stop:available')).toContainText('Saved stop tfl:stop:available');
    await expect(row(page, 'stop', 'tfl:stop:available').getByRole('link')).toHaveAttribute('href', '/stops/tfl%3Astop%3Aavailable');
    for (const [kind, id] of [['stop', 'tfl:stop:missing'], ['route', 'tfl:route:missing']] as const) {
      await expect(row(page, kind, id)).toContainText('Unavailable in this source');
      await expect(row(page, kind, id).getByRole('link')).toHaveCount(0);
      await expect(row(page, kind, id)).toContainText('Checked');
    }
    await expect(row(page, 'stop', 'tfl:stop:uncertain')).toContainText('Availability could not be verified');
    await expect(row(page, 'stop', 'tfl:stop:uncertain').getByRole('link')).toHaveCount(1);
    await expect(page.getByTestId('button-remove-stop-ibg:retired:stop')).toHaveCount(0);
    await expect(page.getByTestId('button-remove-route-ibg:retired:route')).toHaveCount(0);
    await expectSaved(page, prefs);
    if (load === 0) await page.reload();
  }
  expect(source.calls).toHaveLength(2);
  for (const call of source.calls) {
    expect(call).toEqual([
      { id: 'tfl:stop:available', kind: 'stop' },
      { id: 'tfl:stop:missing', kind: 'stop' },
      { id: 'tfl:stop:uncertain', kind: 'stop' },
      { id: 'tfl:route:missing', kind: 'route' },
    ]);
  }
});

test('going offline keeps favorites, hides stale unavailable claims and recovers online', async ({ page, context, source }) => {
  const prefs = preferences();
  const id = prefs.favStops[0].id;
  source.status[id] = 'unavailable';
  await openFavorites(page, prefs);
  await expect(row(page, 'stop', id)).toContainText('Unavailable in this source');
  const callsBeforeOffline = source.calls.length;
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByTestId('status-offline')).toBeVisible();
  for (const [kind, savedId] of [['stop', id], ['route', prefs.favRoutes[0].id]] as const) {
    await expect(row(page, kind, savedId)).toContainText('Availability not checked while offline');
    await expect(row(page, kind, savedId)).not.toContainText('Unavailable in this source');
    await expect(row(page, kind, savedId)).not.toContainText('Checked');
    await expect(row(page, kind, savedId).getByRole('link')).toHaveCount(1);
  }
  await expect(page.getByRole('button', { name: 'Check availability again' })).toHaveCount(0);
  await expectSaved(page, prefs);
  expect(source.calls).toHaveLength(callsBeforeOffline);

  await context.setOffline(false);
  await expect(page.getByTestId('status-offline')).toHaveCount(0);
  source.status[id] = 'available';
  await page.getByRole('button', { name: 'Check availability again' }).click();
  await expect(row(page, 'stop', id)).toContainText('Listed in source');
  await expectSaved(page, prefs);
  await page.reload();
  await expect(row(page, 'stop', id)).toContainText('Listed in source');
  await expectSaved(page, prefs);
});

for (const failure of ['http', 'network'] as const) {
  test(`a failed ${failure} refresh discards a previous unavailable claim without deleting favorites`, async ({ page, source }) => {
    const prefs = preferences();
    const id = prefs.favStops[0].id;
    source.status[id] = 'unavailable';
    await openFavorites(page, prefs);
    await expect(row(page, 'stop', id)).toContainText('Unavailable in this source');
    source.failure = failure;
    await page.getByRole('button', { name: 'Check availability again' }).click();
    await expect(row(page, 'stop', id)).toContainText('Could not check availability');
    await expect(row(page, 'stop', id)).not.toContainText('Unavailable in this source');
    await expect(row(page, 'stop', id)).not.toContainText('Checked');
    await expect(row(page, 'stop', id).getByRole('link')).toHaveAttribute('href', '/stops/tfl%3Astop%3Aoriginal');
    await expectSaved(page, prefs);
    await page.reload();
    await expect(row(page, 'stop', id)).toContainText('Could not check availability');
    await expectSaved(page, prefs);
    source.failure = undefined;
    source.status[id] = 'available';
    await page.getByRole('button', { name: 'Check availability again' }).click();
    await expect(row(page, 'stop', id)).toContainText('Listed in source');
    await expectSaved(page, prefs);
    expect(source.calls).toHaveLength(4);
  });
}

test('pagination checks only the visible twenty identities and covers mixed stop/route boundaries', async ({ page, source }) => {
  const stops = Array.from({ length: 18 }, (_, i) => stop(`tfl:stop:${i}`));
  const routes = Array.from({ length: 6 }, (_, i) => route(`tfl:route:${i}`));
  const prefs = preferences([stop('ibg:hidden:stop'), ...stops], [...routes, route('ibg:hidden:route')]);
  await openFavorites(page, prefs);
  const nav = page.getByRole('navigation', { name: 'Favorites pages' });
  await expect(nav).toContainText('1–20 of 24 saved items');
  await expect(nav.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await expect(page.getByTestId(/^button-remove-/)).toHaveCount(20);
  await expect(row(page, 'route', routes[1].id)).toContainText('Listed in source');
  expect(source.calls).toEqual([[
    ...stops.map(s => ({ id: s.id, kind: 'stop' })),
    ...routes.slice(0, 2).map(r => ({ id: r.id, kind: 'route' })),
  ]]);
  await nav.getByRole('button', { name: 'Next' }).click();
  await expect(nav).toContainText('21–24 of 24 saved items');
  await expect(nav.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(page.getByTestId(/^button-remove-/)).toHaveCount(4);
  for (const r of routes.slice(2)) await expect(row(page, 'route', r.id)).toContainText('Listed in source');
  expect(source.calls[1]).toEqual(routes.slice(2).map(r => ({ id: r.id, kind: 'route' })));
  await expectSaved(page, prefs);
  await nav.getByRole('button', { name: 'Previous' }).click();
  await expect(nav).toContainText('1–20 of 24 saved items');
  await expect(row(page, 'stop', stops[0].id)).toContainText('Listed in source');
  expect(source.calls).toHaveLength(2); // Still-valid metadata is reused, not queried again.
  await page.reload();
  await expect(nav).toContainText('1–20 of 24 saved items');
  await expect(row(page, 'stop', stops[0].id)).toContainText('Listed in source');
  await expectSaved(page, prefs);
});

test('explicit stop and route removals persist without touching peers or hidden retired items', async ({ page, source }) => {
  const prefs = preferences(
    [stop('tfl:stop:remove'), stop('tfl:stop:keep'), stop('ibg:retired:stop')],
    [route('tfl:route:remove'), route('tfl:route:keep'), route('ibg:retired:route')],
  );
  source.status['tfl:stop:remove'] = 'unavailable';
  source.status['tfl:route:remove'] = 'unavailable';
  await openFavorites(page, prefs);
  await expect(row(page, 'stop', 'tfl:stop:remove')).toContainText('Unavailable in this source');
  await page.getByRole('button', { name: 'Remove Saved stop tfl:stop:remove', exact: true }).click();
  const afterStop = { ...prefs, favStops: prefs.favStops.filter(s => s.id !== 'tfl:stop:remove') };
  await expectSaved(page, afterStop);
  await page.getByRole('button', { name: 'Remove route Saved route tfl:route:remove', exact: true }).click();
  const afterBoth = { ...afterStop, favRoutes: prefs.favRoutes.filter(r => r.id !== 'tfl:route:remove') };
  await expectSaved(page, afterBoth);
  await page.reload();
  await expect(page.getByTestId('button-remove-stop-tfl:stop:remove')).toHaveCount(0);
  await expect(page.getByTestId('button-remove-route-tfl:route:remove')).toHaveCount(0);
  await expect(row(page, 'stop', 'tfl:stop:keep')).toContainText('Listed in source');
  await expect(row(page, 'route', 'tfl:route:keep')).toContainText('Listed in source');
  await expect(page.getByTestId(/^button-remove-/)).toHaveCount(2);
  await expectSaved(page, afterBoth);

  await page.getByTestId('button-remove-stop-tfl:stop:keep').click();
  await page.getByTestId('button-remove-route-tfl:route:keep').click();
  const hiddenOnly = { ...prefs, favStops: [prefs.favStops[2]], favRoutes: [prefs.favRoutes[2]] };
  await expect(page.getByText('Nothing saved yet')).toBeVisible();
  await expectSaved(page, hiddenOnly);
  await page.reload();
  await expect(page.getByText('Nothing saved yet')).toBeVisible();
  await expectSaved(page, hiddenOnly);
});
