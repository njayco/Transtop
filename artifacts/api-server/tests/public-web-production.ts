import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";

test("web production output boots in isolation without API dist or node_modules", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "transtop-web-production-"));
  const root = path.join(fixture, "artifacts/transtop");
  const source = new URL("../../transtop/dist", import.meta.url);
  const portServer = createServer();
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const port = (portServer.address() as AddressInfo).port;
  await new Promise<void>(resolve => portServer.close(() => resolve()));
  await cp(source, path.join(root, "dist"), { recursive: true });
  const child = spawn(process.execPath, [path.join(root, "dist/server/public-web.mjs")], {
    cwd: fixture,
    // Deliberately invalid DB: home/errors/robots/assets must boot without a
    // live catalog connection, and no credential or API output is copied.
    env: { PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/invalid" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error(`Startup timed out: ${output}`)), 15000);
      const ready = (chunk: Buffer) => {
        if (chunk.toString().includes("Transtop web server listening")) { clearTimeout(timeout); resolve(); }
      };
      child.stdout.on("data", ready);
      child.once("exit", code => { clearTimeout(timeout); reject(Error(`Web startup exited ${code}: ${output}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /rel="canonical" href="https:\/\/transtop.app\/"/);
    const asset = /src="([^"]+\/assets\/[^"]+\.js)"/.exec(html) || /src="(\/assets\/[^"]+\.js)"/.exec(html);
    assert.ok(asset, "built document includes the compiled client");
    assert.equal((await fetch(base + asset[1])).status, 200);
    const missing = await fetch(base + "/missing-production-page");
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /End of the line/);
    assert.match(await (await fetch(base + "/robots.txt")).text(), /Sitemap: https:\/\/transtop.app\/sitemap.xml/);
    assert.equal((await fetch(base + "/favorites")).headers.get("x-robots-tag"), "noindex, follow");
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(fixture, { recursive: true, force: true });
  }
});
