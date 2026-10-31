import { pool } from "@workspace/db";
import { importGtfs } from "../importer";
import { restoreRegistry, prepareFeed, prepareCachedRegional,licensedCatalog,catalog } from "./registry";
import { agencyId } from "./model";
import { logger } from "../../lib/logger";

try {
  await restoreRegistry();
  const [command, id] = process.argv.slice(2);
  if (["import","import-regional","import-regional-cached"].includes(command) && id) {
    const feed = command==="import-regional-cached"?await prepareCachedRegional(id):await prepareFeed(id,command==="import-regional");
    await importGtfs(agencyId(feed.id));
    logger.info({ feedId: feed.id }, "Mobility Database schedule imported");
  } else if (command === "catalog") {
    const result = await catalog({ country: id });
    logger.info({ feeds: result.feeds.map(f => ({ id:f.id, provider:f.provider, eligible:f.eligible, reason:f.reason })) }, "Mobility Database catalog");
  } else if(command==="licensed-catalog"){
    const feeds=await licensedCatalog();
    logger.info({feeds:feeds.map(f=>({id:f.id,provider:f.provider,reason:f.reason}))},"Licensed catalog candidates; actual capacity still requires measurement");
  } else throw new Error("Usage: mobility import|import-regional|import-regional-cached <feed-id> | catalog <country-code> | licensed-catalog");
} catch (error) {
  const message=error instanceof Error?error.message.replace(/https?:\/\/\S+/g,"[feed URL omitted]").slice(0,300):"Unknown failure";
  logger.error({reason:message},"Mobility Database operation failed or was withheld. Existing services retained.");
  process.exitCode = 1;
} finally { await pool.end(); }
