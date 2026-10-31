import { useEffect } from 'react';
import { useLocation } from 'wouter';
import settings from '../../public-origin.json';

/** Keep URL signals in sync after SPA navigation. First-response metadata and
 * HTTP status are owned by the web server, not this client effect. */
export function PublicUrlMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const controller = new AbortController();
    const update = (path?: string) => {
      let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
      let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!path) {
        canonical?.remove();
        if (!robots) {
          robots = document.createElement('meta');
          robots.name = 'robots';
          document.head.append(robots);
        }
        robots.content = 'noindex, follow';
        return;
      }
      robots?.remove();
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.append(canonical);
      }
      canonical.href = new URL(path, settings.origin).href;
    };
    const path = location.split('?')[0];
    if (path === '/' || path === '/search') update(path);
    else {
      update();
      const match = /^\/(stops|routes|trains)\/([^/]+)$/.exec(path);
      if (match) {
        const base = import.meta.env.BASE_URL.replace(/\/$/, '');
        void fetch(`${base}/api/transit/${match[1]}/${match[2]}?mode=live`, { signal: controller.signal })
          .then(async response => {
            if (!response.ok) return;
            const entity = await response.json();
            const identity = entity.route || entity;
            if (!controller.signal.aborted && typeof identity.id === 'string') {
              const id = match[1] === 'trains' ? decodeURIComponent(match[2]) : identity.id;
              update(`/${match[1]}/${encodeURIComponent(id)}`);
            }
          }).catch(() => { /* No canonical claim when existence cannot be verified. */ });
      }
    }
    return () => controller.abort();
  }, [location]);
  return null;
}
