import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('shared error fill meets 4.5:1 against white in every white-on-red use', () => {
  const css = src('index.css');
  const match = css.match(/--bad-fill:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  assert.ok(match, 'Shared error fill must be defined');
  const [, hue, sat, light] = match.map(Number);
  const s = sat / 100, l = light / 100;
  const a = s * Math.min(l, 1 - l);
  const rgb = [0, 8, 4].map(n => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
  const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = linear.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = 1.05 / (luminance + 0.05);
  assert.ok(contrast >= 4.5, `White/error-fill contrast: ${contrast.toFixed(2)}:1`);
  for (const path of ['components/shell.tsx', 'pages/ride.tsx', 'pages/settings.tsx']) {
    const content = src(path);
    assert.ok(content.includes('bg-[hsl(var(--bad-fill))]'), `${path} must use the accessible fill`);
    assert.ok(!content.includes('bg-[hsl(var(--bad))]'), `${path} must not use the text color as a fill`);
  }
});
