import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { logger } from "./lib/logger";
import { publicWebHandler } from "./public-web/handler";

const root = path.resolve(process.cwd(), process.env.TRANSTOP_ROOT || "artifacts/transtop");
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("A valid PORT is required");
const app = express();
app.disable("x-powered-by");
app.get("/index.html", (_req, res) => { res.redirect(308, "/"); });

if (process.argv.includes("--dev")) {
  // Resolve Vite from its owning package; keep the API runtime independent of it.
  const require = createRequire(path.join(root, "package.json"));
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const vite = await createServer({
    root, configFile: path.join(root, "vite.config.ts"),
    server: { middlewareMode: true }, appType: "custom",
  });
  // Let Vite serve source modules, HMR and public assets before page handling.
  app.use(vite.middlewares);
  app.use(publicWebHandler(async url => vite.transformIndexHtml(url, await readFile(path.join(root, "index.html"), "utf8"))));
} else {
  const publicDir = path.join(root, "dist/public");
  const html = await readFile(path.join(publicDir, "index.html"), "utf8");
  // Dynamic discovery always wins over any old robots/sitemap files.
  app.use((req, res, next) => {
    if (req.path === "/robots.txt" || req.path === "/sitemap.xml" || req.path.startsWith("/sitemaps/")) next();
    else express.static(publicDir, { index: false, redirect: false })(req, res, next);
  });
  app.use(publicWebHandler(async () => html));
}

app.listen(port, "0.0.0.0", () => logger.info({ port }, "Transtop web server listening"));
