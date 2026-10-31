import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, copyFile, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Public, CC BY 4.0 snapshot; downloaded at build time, never per visitor.
// Official checksum: https://db-ip.com/db/download/ip-to-city-lite
export const citySnapshot = {
  month: "2026-10",
  url: "https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz",
  sha1: "df17bd24390108ed1d24dcb7718dc60f6b9abd4f",
};
const artifact = fileURLToPath(new URL("../", import.meta.url));
const cache = path.resolve(artifact, "../../node_modules/.cache/transtop-geo");
const archive = path.join(cache, `city-${citySnapshot.month}.mmdb.gz`);
async function checksum(file) {
  const hash = createHash("sha1");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function bounded(max) {
  let length = 0;
  return new Transform({ transform(chunk, _encoding, callback) {
    length += chunk.length;
    callback(length > max ? new Error("size") : null, chunk);
  } });
}
export async function prepareCityDatabase() {
  const destination = path.join(artifact, "dist/geo");
  const output = path.join(destination, "city.mmdb");
  await mkdir(destination, { recursive: true });
  await mkdir(cache, { recursive: true });
  try {
    let cached = false;
    try { cached = (await stat(archive)).size <= 150_000_000; } catch {}
    const input = cached ? archive : `${archive}.part`;
    if (!cached) {
      const response = await fetch(citySnapshot.url, { signal: AbortSignal.timeout(90_000), redirect: "error" });
      if (!response.ok || !response.body) throw new Error(`download HTTP ${response.status}`);
      if(Number(response.headers.get("content-length"))>150_000_000)throw new Error("archive size");
      await pipeline(Readable.fromWeb(response.body), bounded(150_000_000), createWriteStream(`${archive}.part`));
    }
    await pipeline(createReadStream(input), createGunzip(), bounded(350_000_000), createWriteStream(`${output}.part`));
    // DB-IP publishes the hash of the uncompressed MMDB, not the .gz download.
    if((await checksum(`${output}.part`))!==citySnapshot.sha1)throw new Error("database integrity");
    if(!cached)await rename(input,archive);
    await rename(`${output}.part`, output);
    await copyFile(path.join(artifact, "licenses/DB-IP-Lite.txt"), path.join(destination, "DB-IP-Lite.txt"));
    console.info(`Entry styling: packaged DB-IP City Lite ${citySnapshot.month}`);
  } catch (error) {
    await Promise.all([rm(archive,{force:true}),rm(`${archive}.part`, { force: true }), rm(`${output}.part`, { force: true }), rm(output, { force: true })]);
    console.warn(`Entry styling: city database unavailable (${error instanceof Error?error.message.slice(0,100):"unknown"}); default welcome and manual city selection remain available.`);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareCityDatabase();
