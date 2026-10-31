import { pool } from "@workspace/db";
import { intercityCatalog } from "../transit/intercity/service";
import { isRetiredResearchId } from "../transit/intercity/retired";
import { odptEnabled } from "../transit/odpt/registry";
import { idfmEnabled } from "../transit/idfm/model";
import { boarding } from "../transit/wmata/model";
import type { TransitStop, TransitRoute } from "../transit/types";
import { entityPath } from "./urls";

let cached: { at: number; paths: string[] } | undefined;
let pending: Promise<string[]> | undefined;

/** Only installed, public, live-mode identities; never enumerate external APIs,
 * research archives, demo rows, personal state or dated train runs. */
export async function sitemapPaths(): Promise<string[]> {
  if (cached && Date.now() - cached.at < 300000) return cached.paths;
  if (pending) return pending;
  pending = (async () => {
    const { rows } = await pool.query<{ kind: string; data: TransitStop | TransitRoute }>(
      `SELECT 'stops' AS kind, data FROM transit_stops WHERE mode='live'
       UNION ALL SELECT 'routes' AS kind, data FROM transit_routes WHERE mode='live'`);
    const extra = await intercityCatalog();
    const records = [
      ...rows,
      ...extra.stops.map(data => ({ kind: "stops", data })),
      ...extra.routes.map(data => ({ kind: "routes", data })),
    ];
    const paths = new Set<string>(["/", "/search"]);
    for (const { kind, data } of records) {
      if (!data.id || !data.name || isRetiredResearchId(data.id)) continue;
      if (data.odpt && !odptEnabled() || data.id.startsWith("idfm:") && !idfmEnabled()) continue;
      if (kind === "stops") {
        const stop = data as TransitStop;
        if (!stop.routes?.length || !boarding(stop)) continue;
        if (stop.parent && !stop.id.startsWith("wmata:") && !stop.id.startsWith("idfm:")) continue;
        if (stop.id.startsWith("idfm:") && !["", "0", "1"].includes(String((stop as TransitStop & { location_type?: string }).location_type || ""))) continue;
      }
      paths.add(entityPath(kind, data.id));
    }
    const result = [...paths].sort();
    cached = { at: Date.now(), paths: result };
    return result;
  })();
  try { return await pending; } finally { pending = undefined; }
}
