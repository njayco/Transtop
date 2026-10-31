import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { publicContentMiddleware } from './middleware.mjs';

const root = path.resolve(fileURLToPath(new URL('../dist/public/', import.meta.url)));
const base = (process.env.BASE_PATH || '/').replace(/\/$/, '');
const template = await readFile(path.join(root, 'index.html'), 'utf8');
const render = publicContentMiddleware({ base, template: async () => template });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  render(req, res, async error => {
    if (error) { res.writeHead(500); res.end('Unable to render page'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://internal').pathname); }
    catch { res.writeHead(400); res.end(); return; }
    if (base && !pathname.startsWith(`${base}/`)) { res.writeHead(404); res.end(); return; }
    const relative = pathname.slice(base.length);
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(404); res.end(); return; }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      // Only known app-only pages receive the SPA shell. Unknown URLs are real 404s.
      const appOnly = ['/favorites', '/ride', '/settings'].includes(relative);
      res.writeHead(appOnly ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : template.replace('<!--public-content-->', ''));
    }
  });
}).listen(Number(process.env.PORT), '0.0.0.0');
