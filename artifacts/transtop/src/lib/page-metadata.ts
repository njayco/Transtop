// Verified production origin; never derive canonical URLs from request headers.
export const SITE_ORIGIN = 'https://transtop.app';
export const HOME_DESCRIPTION = 'Find transit stops, routes and schedules with Transtop. Explore NYC and selected transit networks worldwide. Live arrivals and coverage vary by provider.';
export const HOME_TITLE = 'Transtop — when is my bus or train coming?';

export type PageMetadata = { title: string; description: string; url: string };
export type DetailKind = 'stops' | 'routes' | 'trains';

export function detailPath(path: string): { kind: DetailKind; id: string; path: string } | null {
  const match = /^\/(stops|routes|trains)\/([^/]+)\/?$/.exec(path.split(/[?#]/)[0]);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]);
    if (!id || id.length > 180 || /[\u0000-\u001f\u007f]/.test(id)) return null;
    return { kind: match[1] as DetailKind, id, path: `/${match[1]}/${encodeURIComponent(id)}` };
  } catch { return null; }
}

const label = (value: unknown, limit = 75): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

export function pageMetadata(path: string, data?: unknown): PageMetadata {
  const detail = detailPath(path);
  if (!detail) {
    const cleanPath = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    const pages: Record<string, [string, string]> = {
      '/search': ['Find transit stops and routes — Transtop', 'Search transit stops and routes on Transtop. Explore schedules and available arrivals in supported networks. Coverage varies by provider.'],
      '/favorites': ['Saved stops and routes — Transtop', 'Return to your saved transit stops and routes on this device with Transtop. Schedules and live data depend on provider coverage.'],
      '/ride': ['Your transit ride — Transtop', 'Follow your transit ride with Transtop and optionally contribute rider observations. Available schedules and live data vary by provider.'],
      '/settings': ['Transit coverage and settings — Transtop', 'Check Transtop data sources, coverage and settings. Learn which supported networks offer schedules, live arrivals and vehicle observations.'],
    };
    const [title, description] = pages[cleanPath] ?? [HOME_TITLE, HOME_DESCRIPTION];
    return { title, description, url: `${SITE_ORIGIN}${cleanPath}` };
  }
  const d = record(data);
  const stop = d, route = record(d.route);
  let title: string, description: string;
  if (detail.kind === 'stops') {
    const name = label(stop.name) || `Stop ${label(detail.id)}`;
    const agency = label(stop.agency, 40);
    title = `${name}${agency ? ` · ${agency}` : ''} — Transtop`;
    description = `Explore serving routes and available departures at ${name} on Transtop. Schedules and live arrivals depend on provider coverage.`;
  } else if (detail.kind === 'routes') {
    const name = label(route.name) || label(detail.id);
    const agency = label(route.agency, 40);
    title = `Route ${name}${agency ? ` · ${agency}` : ''} — Transtop`;
    description = `Explore route ${name}, its stops and available schedules on Transtop. Live arrivals and vehicle data vary by provider.`;
  } else {
    const number = label(d.trainNumber, 30) || label(detail.id);
    const name = label(d.routeName, 50);
    const date = label(d.serviceDate, 10);
    title = `Train ${number}${name ? ` · ${name}` : ''}${date ? ` · ${date}` : ''} — Transtop`;
    description = `View train ${number}${name ? ` on ${name}` : ''}, its station calls and available times on Transtop. Scheduled times are not live predictions.`;
  }
  return { title, description, url: `${SITE_ORIGIN}${detail.path}` };
}
