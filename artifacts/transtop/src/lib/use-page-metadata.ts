import { useEffect } from 'react';
import { pageMetadata, type PageMetadata } from './page-metadata';

function apply(metadata: PageMetadata) {
  document.title = metadata.title;
  for (const key of ['description', 'og:description', 'twitter:description', 'og:title', 'twitter:title', 'og:url']) {
    const value = key.endsWith('title') ? metadata.title : key === 'og:url' ? metadata.url : metadata.description;
    document.querySelector<HTMLMetaElement>(`meta[name="${key}"], meta[property="${key}"]`)?.setAttribute('content', value);
  }
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', metadata.url);
}

/** Update existing head tags after client navigation; sharing crawlers use the server response. */
export function usePageMetadata(path: string, data?: unknown) {
  useEffect(() => { apply(pageMetadata(path, data)); }, [path, data]);
}
