import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Reader, type CountryResponse } from "mmdb-lib";
import ipaddr from "ipaddr.js";

export type EntryCountry = "US" | "GB" | "FR" | "JP" | null;
export function stylingCountry(value: unknown): EntryCountry {
  return value === "US" || value === "GB" || value === "FR" || value === "JP" ? value : null;
}

// Strict parsing: no port, zone, abbreviated IPv4, octal, or client-supplied URL.
export function normalizedAddress(value: string | undefined): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (!value || value.length > 45 || /[%\s[\]]/.test(value)) return null;
  try {
    if (!value.includes(":") && !ipaddr.IPv4.isValidFourPartDecimal(value)) return null;
    const parsed = ipaddr.parse(value);
    return parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address() : parsed;
  } catch { return null; }
}

export function publicAddress(value: string | undefined): string | null {
  const parsed = normalizedAddress(value);
  // ipaddr also excludes CGNAT, documentation, multicast, unspecified,
  // link-local, reserved, mapped private, Teredo and 6to4 transition space.
  if (!parsed || parsed.range() !== "unicast") return null;
  if (parsed.kind() === "ipv6" && !parsed.match(ipaddr.parse("2000::"), 3)) return null;
  return parsed.toString();
}

type IngressRequest = { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> };

/** Verified Replit path: loopback socket, XFF = client, private ingress, loopback proxy.
 * The public edge overwrites incoming XFF. Do NOT reuse Express's unrelated trust proxy=1.
 * A different chain/hosting setup deliberately falls back, never guesses a leftmost IP.
 */
export function ingressClientAddress(req: IngressRequest): string | null {
  const peer = normalizedAddress(req.socket.remoteAddress);
  if (!peer) return null;
  if (peer.range() !== "loopback") {
    // No forwarded metadata is trusted on direct connections.
    return publicAddress(req.socket.remoteAddress);
  }
  const raw = req.headers["x-forwarded-for"];
  if (typeof raw !== "string" || raw.length > 180) return null;
  const chain = raw.split(",").map(value => value.trim());
  if (chain.length !== 3) return null;
  const middle = normalizedAddress(chain[1]);
  const last = normalizedAddress(chain[2]);
  if (middle?.range() !== "private" || last?.range() !== "loopback") return null;
  return publicAddress(chain[0]);
}

type CountryReader = { get(address: string): { country?: { iso_code?: string } } | null };
export const databasePath = fileURLToPath(new URL("../../dist/geo/country.mmdb", import.meta.url));
// Build bundles this module into dist/index.mjs, so use the dist-relative path
// without import.meta.url assumptions about the source module's original location.
export function packagedDatabasePath(): string {
  return fileURLToPath(new URL("./geo/country.mmdb", import.meta.url));
}

export async function loadCountryReader(path: string): Promise<CountryReader | null> {
  try { return new Reader<CountryResponse>(await readFile(path)); }
  catch { return null; } // Never log an exception that could contain a visitor IP.
}

/** No network, no IP cache, no IP persistence. Reader loads once, off the request path. */
export function createCountryLookup(reader: Promise<CountryReader | null>) {
  return async (address: string | null): Promise<EntryCountry> => {
    if (!address) return null;
    try { return stylingCountry((await reader)?.get(address)?.country?.iso_code); }
    catch { return null; }
  };
}

export const lookupEntryCountry = createCountryLookup(loadCountryReader(
  import.meta.url.endsWith("/dist/index.mjs") ? packagedDatabasePath() : databasePath,
));
