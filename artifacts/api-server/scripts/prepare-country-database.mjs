import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Monthly, redistributable DB-IP Lite snapshot. Never downloaded per visitor.
export const snapshot = {
  month: "2026-10",
  url: "https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz",
  sha256: "4cd44536ddfd40fec7eca94a233f7d19f38d470e6522e653cb8d27001f5fe177",
};
const artifact = fileURLToPath(new URL("../", import.meta.url));
const cache = path.resolve(artifact, "../../node_modules/.cache/transtop-geo");
const archivePath = path.join(cache, `${snapshot.month}.mmdb.gz`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function prepareCountryDatabase() {
  const destination = path.join(artifact, "dist/geo");
  await mkdir(destination, { recursive: true });
  try {
    let bytes;
    try { bytes = await readFile(archivePath); } catch { /* first clean build */ }
    if (!bytes || hash(bytes) !== snapshot.sha256) {
      const response = await fetch(snapshot.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok || Number(response.headers.get("content-length")) > 8_000_000) throw new Error("download");
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 8_000_000) throw new Error("size");
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
      if (hash(bytes) !== snapshot.sha256) throw new Error("integrity");
      await mkdir(cache, { recursive: true });
      await writeFile(archivePath, bytes);
    }
    const database = gunzipSync(bytes, { maxOutputLength: 32_000_000 });
    await writeFile(path.join(destination, "country.mmdb"), database);
    await writeFile(path.join(destination, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
    await copyFile(path.join(artifact, "licenses/DB-IP-Lite.txt"), path.join(destination, "DB-IP-Lite.txt"));
    console.info(`Entry styling: packaged DB-IP Lite ${snapshot.month}`);
  } catch {
    await rm(path.join(destination, "country.mmdb"), { force: true });
    // Do not make an optional visual feature a build/startup availability dependency.
    console.warn("Entry styling: country database unavailable; default US entry will be used.");
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareCountryDatabase();
