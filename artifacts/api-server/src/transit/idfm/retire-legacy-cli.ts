import { pool } from "@workspace/db";
import { retireLegacyIdfmCalls } from "./retire-legacy";
import { logger } from "../../lib/logger";

try{
  if(process.env.IDFM_RETIRE_LEGACY!=="true")
    throw new Error("Set IDFM_RETIRE_LEGACY=true to confirm retirement of obsolete Paris trial calls only");
  const start=process.argv.find(a=>a.startsWith("--start-block="))?.split("=")[1];
  logger.info(await retireLegacyIdfmCalls(process.argv.includes("--vacuum"),process.argv.includes("--wait"),start===undefined?0:Number(start)),"Legacy Paris retirement complete");
}catch(err){logger.error({err},"Legacy Paris retirement stopped safely");process.exitCode=1;}
finally{await pool.end();}
