import { importGtfs } from "./importer";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
const ids=process.argv.slice(2);
const lock=await pool.connect();
try {
  await lock.query("SELECT pg_advisory_lock(735102)");
  for(const agency of ids.length?ids:["mta-subway"])await importGtfs(agency);
}catch(err){logger.error({err},"GTFS import failed");process.exitCode=1;}
finally{await lock.query("SELECT pg_advisory_unlock(735102)");lock.release();await pool.end();}
