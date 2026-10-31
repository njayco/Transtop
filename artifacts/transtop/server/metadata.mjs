const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Replace existing tags, rather than appending conflicting page identities. */
export function renderMetadata(html, metadata) {
  const { title, description, url } = metadata;
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escape(title)}</title>`)
    .replace(/(<meta\s+(?:name|property)="(?:description|og:description|twitter:description)"\s+content=")[^"]*(")/gi,
      (_, before, after) => `${before}${escape(description)}${after}`)
    .replace(/(<meta\s+(?:name|property)="(?:og:title|twitter:title)"\s+content=")[^"]*(")/gi,
      (_, before, after) => `${before}${escape(title)}${after}`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i,
      (_, before, after) => `${before}${escape(url)}${after}`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/i,
      (_, before, after) => `${before}${escape(url)}${after}`);
}
