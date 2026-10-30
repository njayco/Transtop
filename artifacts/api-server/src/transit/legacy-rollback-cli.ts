import { restoreLegacyStopTimes } from "./legacy-rollback";
import { pool } from "@workspace/db";
import { adapter } from "./adapters";
import { logger } from "../lib/logger";

try {
  const agencies = process.argv.slice(2);
  if (!agencies.length) throw new Error("Specify agencies to prepare for legacy readers");
  for (const agency of agencies) {
    adapter(agency);
    await restoreLegacyStopTimes(agency);
    logger.info({ agency }, "Legacy stop-time compatibility ready");
  }
} catch (err) {
  logger.error({ err }, "Legacy compatibility preparation failed; active generation retained");
  process.exitCode = 1;
} finally { await pool.end(); }
