import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";

/** Pin a public DNS answer through TLS; catalog URLs must never reach local/private services. */
export async function download(value: string, maxBytes: number, timeout = 20_000): Promise<Buffer> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      [...url.searchParams.keys()].some(k => /key|token|secret|password|auth/i.test(k))) throw new Error("Unsafe or credentialed feed URL");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !ipaddr.isValid(a.address) || ipaddr.process(a.address).range() !== "unicast")) throw new Error("Feed address is not public");
  const first = addresses[0];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => req.destroy(new Error("Feed request timed out")), timeout);
    const req = httpsRequest(url, {
      headers: { "User-Agent": "Transtop transit feed reader", Accept: "application/octet-stream" },
      family: first.family,
      lookup: (_hostname, _options, cb) => cb(null, first.address, first.family),
    }, res => {
      if (res.statusCode !== 200) { res.resume(); req.destroy(new Error("Feed download unavailable")); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error("Feed exceeds download capacity")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      res.on("error", reject);
    });
    req.on("error", error => { clearTimeout(timer); reject(error); });
    req.end();
  });
}
