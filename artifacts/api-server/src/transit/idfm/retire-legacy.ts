import { pool } from "@workspace/db";
import { IMPORT_LOCK } from "../generations";
import { logger } from "../../lib/logger";
import { editionTable } from "./storage";

/** Operator-only compatibility cleanup. Never touches the new reader or other agencies. */
export async function retireLegacyIdfmCalls(vacuum=false,wait=false,startBlock=0){
  const client=await pool.connect();let locked=false,deleted=0;
  const deadline=Date.now()+30*60_000;
  try{
    if(wait){
      await client.query("SET statement_timeout='10min'");
      await client.query("SELECT pg_advisory_lock($1)",[IMPORT_LOCK]);locked=true;
    }else locked=(await client.query("SELECT pg_try_advisory_lock($1) AS locked",[IMPORT_LOCK])).rows[0].locked;
    if(!locked)throw new Error("Another GTFS import or cleanup is already running");
    const active=(await client.query(`SELECT g.data->>'storage' AS storage,s.data->>'stopTimesMode' AS stage FROM transit_feed_snapshots s
      JOIN transit_feed_snapshots g ON g.mode='live' AND g.id='idfm:generation:'||(s.data->>'stopTimesMode')
      WHERE s.mode='live' AND s.id='idfm:static'`)).rows[0];
    if(active?.storage!=="idfm-edition")throw new Error("Refusing cleanup: the active IDFM edition must use isolated storage");
    const attached=(await client.query(`SELECT EXISTS(SELECT 1 FROM pg_inherits
      WHERE inhparent='transit_idfm_stop_times'::regclass AND inhrelid=$1::regclass) AS attached`,
      [editionTable(active.stage)])).rows[0].attached;
    if(!attached)throw new Error("Refusing cleanup: the active IDFM edition is not attached to its reader");
    await client.query("SET statement_timeout='3s'; SET lock_timeout='250ms'");
    const blocks=Math.ceil(Number((await client.query("SELECT pg_relation_size('transit_stop_times') AS bytes")).rows[0].bytes)/8192);
    if(!Number.isSafeInteger(startBlock)||startBlock<0||startBlock>blocks)throw new Error("Invalid cleanup resume block");
    // Physical ranges avoid random heap I/O and repeated scans of dead index keys.
    // Each independently committed slice visits at most 512 pages (4 MiB).
    for(let block=startBlock;block<blocks;block+=512){
      if(Date.now()>=deadline)throw new Error("Legacy cleanup time budget reached; rerun safely to continue");
      let result;
      for(let attempt=0;;attempt++){
        try{
          result=await client.query(`DELETE FROM transit_stop_times
            WHERE ctid >= $1::tid AND ctid < $2::tid AND agency='idfm'`,
            [`(${block},0)`,`(${Math.min(block+512,blocks)},0)`]);break;
        }catch(error:any){
          if(attempt>=2||!["57014","55P03"].includes(error.code)||Date.now()+3500>=deadline)throw error;
          await new Promise(resolve=>setTimeout(resolve,250));
        }
      }
      deleted+=result.rowCount||0;
      if(block%32768===0)logger.info({block,blocks,deleted},"Retiring invisible legacy Paris calls");
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    let vacuumDone=false;
    if(vacuum){
      const remaining=Math.min(15*60_000,deadline-Date.now());
      if(remaining<=0)throw new Error("Legacy cleanup time budget reached before online vacuum");
      await client.query(`SET statement_timeout=${remaining}; SET maintenance_work_mem='64MB'`);
      // Ordinary online VACUUM, never FULL/CLUSTER/TRUNCATE or a blocking rewrite.
      try{
        await client.query("VACUUM (ANALYZE, INDEX_CLEANUP ON, TRUNCATE ON) transit_stop_times");vacuumDone=true;
      }catch(error:any){
        if(!["55P03","57014"].includes(error.code))throw error;
        logger.warn("Legacy Paris rows retired; online vacuum deferred to managed maintenance");
      }
    }
    return {deleted,blocks,vacuum:vacuumDone,vacuumDeferred:vacuum&&!vacuumDone};
  }finally{
    try{
      await client.query("RESET statement_timeout; RESET lock_timeout; RESET maintenance_work_mem");
      if(locked)await client.query("SELECT pg_advisory_unlock($1)",[IMPORT_LOCK]);
    }finally{client.release();}
  }
}
