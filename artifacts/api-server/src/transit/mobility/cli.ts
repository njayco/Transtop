import { pool } from "@workspace/db";
import { importGtfs } from "../importer";
import { restoreRegistry, prepareFeed, catalog } from "./registry";
import { agencyId } from "./model";
import { logger } from "../../lib/logger";

try {
  await restoreRegistry();
  const [command, id] = process.argv.slice(2);
  if (command === "import" && id) {
    const feed = await prepareFeed(id);
    await importGtfs(agencyId(feed.id));
    logger.info({ feedId: feed.id }, "Mobility Database schedule imported");
  } else if (command === "catalog") {
    const result = await catalog({ country: id });
    logger.info({ feeds: result.feeds.map(f => ({ id:f.id, provider:f.provider, eligible:f.eligible, reason:f.reason })) }, "Mobility Database catalog");
  } else throw new Error("Usage: mobility import <feed-id> | mobility catalog <country-code>");
} catch (error) {
  const message=error instanceof Error?error.message.replace(/https?:\/\/\S+/g,"[feed URL omitted]").slice(0,300):"Unknown failure";
  logger.error({reason:message},"Mobility Database operation failed or was withheld. Existing services retained.");
  process.exitCode = 1;
} finally { await pool.end(); }
