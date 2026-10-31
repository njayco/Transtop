import settings from "../../../transtop/public-origin.json";

// Verified with the deployment service, not derived from an untrusted Host header.
export const publicOrigin = new URL(settings.origin).origin;
export const personalPaths = new Set(["/favorites", "/ride", "/settings"]);
export const landingPaths = new Set(["/", "/search"]);
export const sitemapSize = 10000;
export const escapeXml = (value: string) => value.replace(/[<>&"']/g, c => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
}[c]!));
export const entityPath = (kind: string, id: string) => `/${kind}/${encodeURIComponent(id)}`;
export const absoluteUrl = (path: string) => new URL(path, publicOrigin).href;

export function publicPath(pathname: string) {
  if (landingPaths.has(pathname) || personalPaths.has(pathname)) return { path: pathname };
  const match = /^\/(stops|routes|trains)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return;
  try {
    const id = decodeURIComponent(match[2]);
    if (!id || id.length > 180 || /[\u0000-\u001f\u007f\\]/.test(id)) return;
    return { kind: match[1], id, path: entityPath(match[1], id) };
  } catch { return; }
}

export function sitemapXml(paths: string[], index = false) {
  const root = index ? "sitemapindex" : "urlset";
  const item = index ? "sitemap" : "url";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map(path => `<${item}><loc>${escapeXml(absoluteUrl(path))}</loc></${item}>`).join("\n") +
    `\n</${root}>`;
}
