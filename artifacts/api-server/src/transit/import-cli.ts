import { importGtfs } from "./importer";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
const ids=process.argv.slice(2);
try {
  for(const agency of ids.length?ids:["mta-subway"])await importGtfs(agency);
}catch(err){logger.error({err},"GTFS import failed");process.exitCode=1;}
finally{await pool.end();}
