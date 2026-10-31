// Server-rendered read-only content. Live predictions remain in the client app.
import { pageMetadata, SITE_ORIGIN } from '../src/lib/page-metadata.ts';
import { renderMetadata } from './metadata.mjs';
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const e = escapeHtml;
const link = (base, kind, item) => `<a href="${base}/${kind}/${encodeURIComponent(item.id)}">${e(item.name)}</a>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const note = '<p>Coverage varies by operator. Published schedules are not live predictions. Enter the interactive app for available arrivals, service alerts and vehicle observations.</p>';
const credits = `<footer><p>Paris schedules contain information from <a href="https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/">Île-de-France Mobilités</a> under <a href="https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm/download">Licence Mobilités</a>. <a href="/api/transit/idfm/method">Transformation method / reuse notice</a>.</p><p>Worldwide feeds: <a href="https://www.transit.land/terms">Transitland</a> and credited operators. Unofficial Amtrak observations: <a href="https://amtraker.com">Amtraker</a>, <a href="https://opendatacommons.org/licenses/by/1-0/">ODC-By 1.0</a>.</p></footer>`;

function attribution(entity) {
  const providers = ['transitland', 'tfl', 'odpt', 'idfm', 'wmata'].map(k => entity[k]).filter(Boolean);
  return providers.map(p => {
    let url;
    try { const u = new URL(p.url); if (['http:', 'https:'].includes(u.protocol)) url = u.href; } catch {}
    let license;
    try { const u = new URL(p.license); if (['http:', 'https:'].includes(u.protocol)) license = u.href; } catch {}
    return `<p>${e(p.attribution || '')}${url ? ` · <a href="${e(url)}" rel="noopener noreferrer">Data source</a>` : ''}${license ? ` · <a href="${e(license)}">License</a>` : p.license ? ` · ${e(p.license)}` : ''}</p>`;
  }).join('');
}

export async function publicPage(pathname, { base = '', query = '', getData }) {
  const nav = `<nav aria-label="Public transit information"><a href="${base}/">Transtop</a> · <a href="${base}/search">Search stops and routes</a></nav>`;
  let title, description, content, metadata, status = 200;
  if (pathname === '/' || pathname === '/search') {
    const search = pathname === '/search';
    metadata = pageMetadata(pathname);
    title = search ? 'Search transit stops and routes | Transtop' : 'Transtop — transit stops, routes and train information';
    description = search ? 'Find transit stops and routes by name or operator. Browse public station and route information before opening live arrivals.' :
      'Browse transit stops, routes and train information. Explore published transit coverage and open available live arrivals in the Transtop app.';
    const data = await getData(`/catalog?mode=live&limit=20${search && query ? `&q=${encodeURIComponent(query.slice(0, 120))}` : ''}`);
    content = `<h1>${search ? 'Search transit stops and routes' : 'Transit stops, routes and trains'}</h1>
      <p>Transtop brings together bus, subway, commuter rail, intercity train and tram information. Coverage includes New York and Long Island, Connecticut, selected New Jersey and Pennsylvania services, Amtrak, Washington-area Metro, London, Paris / Île-de-France, selected Japanese networks and worldwide feeds.</p>
      <form action="${base}/search" method="get"><label for="public-query">Stop, route or operator</label> <input id="public-query" name="q" maxlength="120" value="${e(query)}"> <button type="submit">Search</button></form>
      <h2>${query ? `Results for ${e(query)}` : 'Browse stops'}</h2>${list(data.stops.map(s => `${link(base, 'stops', s)} · ${e(s.agency)}${attribution(s)}`))}
      <h2>Routes</h2>${list(data.routes.map(r => `${link(base, 'routes', r)} · ${e(r.longName || r.agency)}${attribution(r)}`))}
      ${!data.stops.length && !data.routes.length ? '<p>No matching stops or routes in the current catalog. Try a different name.</p>' : ''}${data.message ? `<p>${e(data.message)}</p>` : ''}${note}`;
  } else {
    const match = /^\/(stops|routes|trains)\/([^/]+)$/.exec(pathname);
    if (!match) return null;
    const [, kind, encoded] = match;
    let id;
    try { id = decodeURIComponent(encoded); } catch { id = ''; }
    if (!id || id.length > 180) {
      status = 404;
    } else {
      const data = await getData(`/${kind}/${encodeURIComponent(id)}${kind === 'trains' ? '' : '?mode=live'}`);
      if (data) metadata = pageMetadata(pathname, data);
      if (!data) status = 404;
      else if (kind === 'stops') {
        title = `${data.name} — stop information | Transtop`;
        description = `${data.name}: ${data.agency} ${data.type} stop. Browse serving routes and station information; open the app for available arrivals.`;
        content = `<h1>${e(data.name)}</h1><p>${e(data.agency)} · ${e(data.type)} stop${data.neighborhood ? ` · ${e(data.neighborhood)}` : ''}</p>
          <h2>Routes serving this stop</h2>${list(data.routes.map(r => `${link(base, 'routes', r)}${r.longName ? ` — ${e(r.longName)}` : ''}`))}
          ${attribution(data)}${note}`;
      } else if (kind === 'routes') {
        const r = data.route;
        title = `${r.name}${r.longName ? ` — ${r.longName}` : ''} | Transtop`;
        description = `${r.name}: ${r.longName || r.agency}. Browse ${r.type} route information and stops. Available arrivals and alerts are in the interactive app.`;
        content = `<h1>${e(r.name)}${r.longName ? ` — ${e(r.longName)}` : ''}</h1><p>${e(r.agency)} · ${e(r.type)} route</p>
          ${data.directions?.length ? `<h2>Service directions</h2>${list(data.directions.map(e))}` : ''}
          <h2>Route stops</h2>${list(data.stops.map(s => link(base, 'stops', s)))}
          ${r.scheduleNotes?.length ? `<h2>Schedule information</h2>${list(r.scheduleNotes.map(e))}` : ''}${attribution(r)}${note}`;
      } else {
        title = `Train ${data.trainNumber} — ${data.routeName} | Transtop`;
        description = `Train ${data.trainNumber} on ${data.routeName} toward ${data.destination}. View service date, published station calls and schedule information.`;
        content = `<h1>Train ${e(data.trainNumber)} — ${e(data.routeName)}</h1><p>Destination: ${e(data.destination)} · Service date: ${e(data.serviceDate)}</p>
          <p>${e(data.source)}. ${e(data.message)}</p>
          ${data.routeId ? `<p>${link(base, 'routes', { id: data.routeId, name: data.routeName })}</p>` : ''}
          <h2>Published station calls</h2><ol>${data.calls.map(c => `<li>${data.matched ? link(base, 'stops', { id: `amtrak:${c.code}`, name: c.name }) : e(c.name)}
            ${c.scheduledArrival ? ` · Scheduled arrival: ${e(c.scheduledArrival)}` : ''}
            ${c.scheduledDeparture ? ` · Scheduled departure: ${e(c.scheduledDeparture)}` : ''}</li>`).join('')}</ol>${note}`;
      }
    }
    if (status === 404) {
      title = 'Transit page not found | Transtop';
      description = 'This stop, route or dated train run is not available. Search the public transit catalog for current information.';
      content = `<h1>Transit page not found</h1><p>This stop, route or dated train run is not available.</p><p><a href="${base}/search">Search current stops and routes</a></p>`;
    }
  }
  return { status, title: metadata?.title ?? title, description: metadata?.description ?? description,
    url: `${SITE_ORIGIN}${base}${metadata ? metadata.url.slice(SITE_ORIGIN.length) : pathname}`,
    html: `<section id="public-content" aria-label="Public transit information">${nav}<main>${content}</main>${credits}</section>` };
}

export function renderDocument(template, page) {
  // Replace, rather than duplicate, the shell's generic metadata.
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${e(page.title)}</title>`);
  for (const [attribute, key, value] of [
    ['name', 'description', page.description], ['property', 'og:title', page.title],
    ['property', 'og:description', page.description], ['name', 'twitter:title', page.title],
    ['name', 'twitter:description', page.description],
  ]) {
    const tag = `<meta ${attribute}="${key}" content="${e(value)}" />`;
    const pattern = new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`, 'i');
    html = pattern.test(html) ? html.replace(pattern, () => tag) : html.replace('</head>', `${tag}</head>`);
  }
  if (page.status !== 200) html = html.replace('</head>', '<meta name="robots" content="noindex" /></head>');
  // Use the same API result for content and metadata: no second provider lookup
  // and no middleware that can swallow the public informational page.
  if (page.url) html = renderMetadata(html, page);
  return html.replace('<!--public-content-->', () => page.html);
}
