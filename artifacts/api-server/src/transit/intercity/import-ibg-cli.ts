import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { ensureIbg } from "./ibg-store";
import { logger } from "../../lib/logger";
try{await ensureIbg(process.argv[2]?await readFile(process.argv[2]):undefined);}
catch(error){logger.error({err:error},"IBG import failed; previous complete reference snapshot retained");process.exitCode=1;}
finally{await pool.end();}
