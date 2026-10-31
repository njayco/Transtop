import type { RequestHandler } from "express";
import { stopDetail, routeDetail } from "../transit/service";
import { publicTrain } from "./train";
import { logger } from "../lib/logger";
import { sitemapPaths } from "./catalog";
import { catalog } from "../transit/catalog";
// @ts-expect-error Shared server renderer is a plain JavaScript module.
import { publicPage, renderDocument } from "../../../transtop/server/public-content.mjs";
import { absoluteUrl, escapeXml, personalPaths, publicPath, sitemapSize, sitemapXml } from "./urls";

type Template = (url: string) => Promise<string>;

export function publicWebHandler(template: Template): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") { next(); return; }
    const pathname = req.path;
    try {
      if (pathname === "/robots.txt") {
        res.type("text/plain").send(`User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl("/sitemap.xml")}\n`);
        return;
      }
      if (pathname === "/sitemap.xml" || /^\/sitemaps\/\d+\.xml$/.test(pathname)) {
        const paths = await sitemapPaths();
        const count = Math.ceil(paths.length / sitemapSize);
        res.set("Cache-Control", "public, max-age=300").type("application/xml");
        if (pathname === "/sitemap.xml") {
          res.send(sitemapXml(Array.from({ length: count }, (_, i) => `/sitemaps/${i + 1}.xml`), true));
        } else {
          const page = Number(pathname.split("/").pop()!.replace(".xml", ""));
          if (page < 1 || page > count) {
            res.status(404).set("X-Robots-Tag", "noindex").send("Sitemap not found");
          } else res.send(sitemapXml(paths.slice((page - 1) * sitemapSize, page * sitemapSize)));
        }
        return;
      }
      const parsed = publicPath(pathname);
      let status = 200;
      let canonical = parsed?.path;
      let heading = "Transtop";
      let text = "Explore public transit stops, routes and published schedules. Available live information varies by provider.";
      let content = "";
      let publicEntity: unknown;
      if (!parsed) status = 404;
      else if (parsed.id) {
        const entity = parsed.kind === "stops" ? await stopDetail(parsed.id, "live")
          : parsed.kind === "routes" ? await routeDetail(parsed.id, "live")
          : await publicTrain(parsed.id);
        if (!entity) status = 404;
        else {
          publicEntity = entity;
          // Providers may resolve a stop/route alias to an authoritative ID.
          // Keep dated train URLs self-referencing: a temporary observed ID
          // must not permanently replace a reusable scheduled-run identity.
          const identity = "route" in entity ? entity.route : entity;
          canonical = `/${parsed.kind}/${encodeURIComponent(parsed.kind === "trains" ? parsed.id : identity.id)}`;
          if ("trainNumber" in entity) {
            heading = `${entity.routeName} ${entity.trainNumber}`;
            text = `${entity.serviceDate} · ${entity.destination}. ${entity.message}`;
          } else {
            const detail = "route" in entity ? entity.route : entity;
            heading = detail.name;
            text = `${detail.agency} · ${detail.type} · public ${parsed.kind === "stops" ? "stop" : "route"}. Published schedules and available live information are provided separately.`;
            if ("routes" in entity) content = `<p>Routes: ${entity.routes.map(r => escapeXml(r.name)).join(", ")}</p>`;
          }
        }
      } else if (pathname === "/search") {
        heading = "Search transit stops and routes";
        text = "Find public bus, subway, rail and train stops and routes in Transtop's available transit networks.";
      }
      if (status === 404) {
        // Do not boot the SPA on a missing page: its entry gate would replace
        // the useful error with the normal welcome screen for fresh visitors.
        res.status(404).set("X-Robots-Tag", "noindex, follow").type("html")
          .set("Cache-Control", "no-cache").send(`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found — Transtop</title><meta name="robots" content="noindex, follow">
<style>body{margin:0;background:#0c0c0d;color:#fff;font-family:system-ui,sans-serif}main{max-width:40rem;margin:15vh auto;padding:2rem}h1{font-size:clamp(2rem,6vw,4rem);line-height:1.05}p{color:#bbb;line-height:1.6}a{color:#fff;display:inline-block;margin:1rem 1.5rem 0 0}a:focus-visible{outline:3px solid #f3c544;outline-offset:6px}</style>
</head><body><main><p>404</p><h1>End of the line</h1>
<p>This page or transit service could not be found. Search for a stop or route, or return to Transtop.</p>
<a href="/">Transtop home</a><a href="/search">Search transit</a></main></body></html>`);
        return;
      }
      if (status === 200 && parsed && canonical && canonical !== pathname) {
        res.redirect(308, canonical + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""));
        return;
      }
      const noindex = status !== 200 || personalPaths.has(pathname);
      let html = await template(req.originalUrl);
      if (!noindex && html.includes("<!--public-content-->")) {
        const query = new URL(req.originalUrl, "http://internal").searchParams.get("q")?.trim().slice(0, 120) || "";
        const page = await publicPage(parsed!.path, {
          query,
          getData: async () => publicEntity ?? await catalog({ mode: "live", q: query, limit: 12, offset: 0 }),
        });
        html = renderDocument(html, page);
      }
      // The shell must not supply a second canonical/robots declaration.
      html = html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "")
        .replace(/<meta\b[^>]*name=["']robots["'][^>]*>/gi, "");
      const tags = noindex ? '<meta name="robots" content="noindex, follow" />'
        : `<link rel="canonical" href="${escapeXml(absoluteUrl(canonical!))}" />`;
      html = html.replace("</head>", `${tags}\n</head>`);
      // Source-visible fallback; the dedicated public-rendering work owns the
      // full interactive page and entry-gate behavior.
      const fallback = `<main><h1>${escapeXml(heading)}</h1><p>${escapeXml(text)}</p>${content}<a href="/">Transtop home</a> · <a href="/search">Search transit</a></main>`;
      if (!html.includes('id="public-content"')) {
        html = html.replace('<div id="root"></div>', `<div id="root">${fallback}</div>`);
      }
      if (noindex) res.set("X-Robots-Tag", "noindex, follow");
      res.status(status).type("html").set("Cache-Control", "no-cache").send(html);
    } catch (err) {
      logger.warn({ err }, "Public page lookup unavailable");
      // A provider/database outage is not proof that the entity is missing.
      res.status(503).set("Retry-After", "60").set("X-Robots-Tag", "noindex")
        .type("html").send('<!doctype html><html lang="en"><title>Transtop temporarily unavailable</title><body><h1>Temporarily unavailable</h1><p>Please try again shortly.</p><a href="/">Transtop home</a></body></html>');
    }
  };
}
