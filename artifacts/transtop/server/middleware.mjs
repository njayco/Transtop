import { publicPage, renderDocument } from './public-content.mjs';

// Only this trusted, internal upstream is used; never build it from request headers.
const API = 'http://127.0.0.1:8080/api/transit';

export function publicContentMiddleware({ template, base = '', api = API, fetchData = fetch }) {
  return async (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const url = new URL(req.url, 'http://internal');
    if (base && !url.pathname.startsWith(`${base}/`)) return next();
    const pathname = url.pathname.slice(base.length) || '/';
    if (!['/', '/search'].includes(pathname) && !/^\/(stops|routes|trains)\/[^/]+$/.test(pathname)) return next();
    let page;
    try {
      page = await publicPage(pathname, {
        base, query: url.searchParams.get('q')?.trim().slice(0, 120) || '',
        getData: async path => {
          const response = await fetchData(`${api}${path}`, { signal: AbortSignal.timeout(12_000) });
          if (response.status === 404) return null;
          if (!response.ok) throw new Error('Transit source unavailable');
          return response.json();
        },
      });
    } catch {
      // A source outage must not become an indexable empty page or a false 404.
      page = {
        status: 503, title: 'Transit information temporarily unavailable | Transtop',
        description: 'Transit information is temporarily unavailable. Please try again shortly.',
        html: '<section id="public-content"><main><h1>Transit information temporarily unavailable</h1><p>Please try again shortly. The interactive app is still available below.</p></main></section>',
      };
    }
    try {
      const html = renderDocument(await template(req.url), page);
      res.statusCode = page.status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (page.status === 503) res.setHeader('Retry-After', '60');
      res.end(req.method === 'HEAD' ? undefined : html);
    } catch (error) { next(error); }
  };
}
